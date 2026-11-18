// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the turn specs never call it for real.
jest.mock('../../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// The idle deadline of a streamed agent turn (workflows R43; agents.md 1.6):
// Analyse, the one-step Answer and Explain report fail with ModelTimeoutError
// when the model sends nothing for five minutes while no tool executes; a
// Stop and a
// clarifying question are never a timeout. A retry of a step's call is a
// reasoning line of the running step. Fake timers: no test waits for real.
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    private readonly values = new Map<string, unknown>();
    set = jest.fn((key: string, value: unknown) => {
      this.values.set(key, value);
    });
    get = jest.fn((key: string) => this.values.get(key));
  },
}));
jest.mock('../../../mastra/mastra.service', () => ({
  MastraService: class {},
}));
jest.mock('../../../mastra/model-resolver', () => ({
  isCustomAnthropicConfig: (c: unknown) =>
    typeof c === 'object' && c !== null && 'kind' in c,
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  resolveAgentModelConfig: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));
jest.mock('../../../mastra/tool-services', () => ({
  setDatasetToolServices: jest.fn(),
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        [
          {
            name: 'World Cup',
            datasourceId: 'ds-pg',
            datasourceKind: 'postgres',
            tables: ['wc.public.matches'],
          },
        ].filter((d) => names.includes(d.name)),
      ),
  }),
}));
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../../mastra/testing/workflows.stub')>(
    '../../../mastra/testing/workflows.stub',
  ),
);
jest.mock('../../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual-id',
  SESSION_ID_CONTEXT_KEY: 'session-id',
  TURN_QUESTION_CONTEXT_KEY: 'turn-question',
  TURN_RECORDS_CONTEXT_KEY: 'turn-data-records',
}));
jest.mock('../../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));
jest.mock('../../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../../verified-queries/verified-queries.service', () => ({
  VerifiedQueriesService: class {},
}));
jest.mock('../../metrics/metrics.service', () => ({
  MetricsService: class {},
}));
jest.mock('../../ontology/ontology.service', () => ({
  OntologyService: class {},
}));
jest.mock('../../../mastra/agents/sql-fixer.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlFixOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('../../../mastra/agents/sql-verifier.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlVerifyOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('../repositories/sessions.repository', () => ({
  SessionsRepository: class {},
}));
jest.mock('../visualization.service', () => ({
  VisualizationService: class {},
}));
jest.mock('../../../common/markdown-pdf', () => ({ renderPdf: jest.fn() }));
jest.mock('../visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));

import { SessionsService, type StreamEvent } from '../sessions.service';
import { streamStored } from '../testing/stream-stored';
import type { SessionDoc } from '../entities/session.entity';
import { answerBusinessQuestionWorkflow } from '../../../mastra/workflows/answer-business-question.workflow';
import { planOf } from '../../../mastra/workflows/answer-business-question.steps';
import { dataReadinessAssessmentWorkflow } from '../../../mastra/workflows/data-readiness-assessment.workflow';
import { ModelTimeoutError } from '../../../mastra/workflows/model-call';
import { streamTurnWorkflow } from '../../../mastra/testing/turn-workflow.stub';

const MINUTE = 60_000;

type StubRun = {
  stream(args: { inputData: unknown; requestContext: unknown }): unknown;
};
const v2Workflow = answerBusinessQuestionWorkflow as unknown as {
  createRun(): Promise<StubRun>;
};
const readinessWorkflow = dataReadinessAssessmentWorkflow as unknown as {
  createRun(): Promise<StubRun>;
};
/** The code workflow a turn streams, by its key. */
const codeWorkflowOf = (key: string) =>
  key === 'data-readiness-assessment' ? readinessWorkflow : v2Workflow;

/** One chunk of a stream, sent after `after` ms (fake time). */
interface Timed {
  after: number;
  chunk: unknown;
}

async function* timed(steps: Timed[]): AsyncGenerator<unknown> {
  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, step.after));
    yield step.chunk;
  }
}

const now = (chunk: unknown): Timed => ({ after: 0, chunk });
const text = (value: string) => ({
  type: 'text-delta',
  payload: { text: value },
});
const SQL_CALL = {
  type: 'tool-call',
  payload: {
    toolCallId: 't1',
    toolName: 'run_readonly_sql',
    args: { sql: 'SELECT 1 AS n', rationale: 'Count.' },
  },
};
const SQL_RESULT = {
  type: 'tool-result',
  payload: {
    toolCallId: 't1',
    toolName: 'run_readonly_sql',
    result: { columns: ['n'], rows: [{ n: 1 }], rowCount: 1 },
  },
};
const WRITTEN = 'The written answer.';

/** The report the fake readiness engine scores: no finding, so no SQL. */
const READINESS_REPORT = {
  id: 'r-wc',
  datasourceId: 'ds-pg',
  datasourceName: 'World Cup DB',
  datasourceKind: 'postgres',
  generatedAt: '2026-11-13T10:00:00.000Z',
  entityCount: 1,
  overallScore: 84,
  maturity: 'Managed',
  dimensionScores: [],
  findings: [],
};

/** The data-readiness service of an Assess Data Readiness run. */
function readinessService() {
  return {
    prepare: jest.fn().mockResolvedValue({
      datasource: { id: 'ds-pg', name: 'World Cup DB' },
      kind: 'postgres',
    }),
    profileSource: jest.fn().mockResolvedValue({
      sourceId: 'ds-pg',
      sourceType: 'postgres',
      entities: [{ namespace: 'public', name: 'matches' }],
      relationships: [],
    }),
    scoreProfile: jest.fn(() => ({ ...READINESS_REPORT })),
    saveReport: jest.fn((report: unknown) => Promise.resolve(report)),
    get: jest.fn().mockResolvedValue(READINESS_REPORT),
    list: jest.fn().mockResolvedValue({ reports: [] }),
    assess: jest.fn(),
  };
}

/** The registry key of the agent each kind of turn streams. */
const AGENT_KEYS = {
  v2: 'insights-analyst',
  assistant: 'assistant',
  readiness: 'data-readiness',
} as const;

/**
 * A turn of an Insights Analyst session (v2: Analyse streams), of an
 * assistant session (the one-step Answer streams) or of an Assess Data
 * Readiness session (Explain report streams); each agent stream sends
 * `steps` (a function of the call, to give a retry its own).
 */
function build(
  kind: 'v2' | 'assistant' | 'readiness',
  steps: (call: number) => Timed[],
) {
  const session: SessionDoc = {
    id: 's-1',
    name: 'Goals',
    datasets: ['World Cup'],
    messages: [],
    visualizations: [],
    ...(kind === 'v2'
      ? { agentKey: 'insights-analyst', agentName: 'Insights Analyst' }
      : kind === 'readiness'
        ? {
            workflowId: 'data-readiness-assessment',
            agentKey: 'data-readiness',
            agentName: 'Data Readiness Agent',
          }
        : {}),
  };
  const repository = {
    get: jest.fn().mockResolvedValue(session),
    update: jest.fn().mockImplementation((_id: string, patch: object) => {
      Object.assign(session, patch);
      return Promise.resolve(session);
    }),
    // Read once at start-up (onModuleInit), to restore workspaces.
    listAll: jest.fn().mockResolvedValue([]),
  };
  const signals: AbortSignal[] = [];
  let calls = 0;
  const agentFor = (name: string) => ({
    id: name,
    name,
    getDescription: () => name,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest.fn((_input: unknown, opts: { abortSignal: AbortSignal }) => {
      signals.push(opts.abortSignal);
      return Promise.resolve({
        fullStream: timed(steps(++calls)),
        text: Promise.resolve(''),
      });
    }),
    generate: jest.fn().mockResolvedValue({ text: 'Synthesized.' }),
  });
  const agent = agentFor(AGENT_KEYS[kind]);
  const registry: Record<string, unknown> = { [AGENT_KEYS[kind]]: agent };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: jest.fn(
      async (key: string, inputData: unknown, requestContext: unknown) =>
        key === 'agent-turn'
          ? streamTurnWorkflow(key, inputData, requestContext)
          : (await codeWorkflowOf(key).createRun()).stream({
              inputData,
              requestContext,
            }),
    ),
    // Read images' model call: no reference image, so no note.
    readImages: jest
      .fn()
      .mockResolvedValue({ imageNotes: '', imageCount: 0, stopped: false }),
    planAnalysis: jest.fn(({ question }: { question: string }) =>
      Promise.resolve({ plan: planOf({}, question), stopped: false }),
    ),
    writeAnswer: jest.fn(
      (_input: unknown, opts: { onText?: (delta: string) => void }) => {
        opts.onText?.(WRITTEN);
        return Promise.resolve({
          answer: { headline: WRITTEN, answer: WRITTEN },
          stopped: false,
        });
      },
    ),
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const service = new SessionsService(
    repository as never,
    mastra as never,
    {
      getByNames: jest.fn().mockResolvedValue([
        {
          name: 'World Cup',
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches'],
        },
      ]),
    } as never,
    { get: jest.fn().mockResolvedValue({ id: 'ds-pg', name: 'DS' }) } as never,
    {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
    } as never,
    {} as never,
    {
      referenceBlock: jest.fn().mockResolvedValue(undefined),
      isVerifiedSql: jest.fn().mockResolvedValue(false),
    } as never,
    { definitionBlock: jest.fn().mockResolvedValue('') } as never,
    {
      contextFor: jest.fn().mockResolvedValue({ block: '', used: [] }),
    } as never,
    {
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
      skillsFor: jest.fn().mockResolvedValue([]),
      datasetNames: jest.fn().mockResolvedValue(new Set(['World Cup'])),
    } as never,
    (kind === 'readiness' ? readinessService() : undefined) as never,
  );
  return { service, session, mastra, agent, signals };
}

/** Start a turn; its outcome is the error it failed with, or 'done'. */
function startTurn(
  ctx: ReturnType<typeof build>,
  events: StreamEvent[],
  abortSignal?: AbortSignal,
): Promise<unknown> {
  return streamStored(
    ctx.service,
    's-1',
    'How many matches?',
    (event) => events.push(event),
    abortSignal,
  ).then(
    () => 'done',
    (error: unknown) => error,
  );
}

/** The last `workflow` event of a turn, as `current`, `done` and `failed`. */
function lastMove(events: StreamEvent[]) {
  const moves = events.filter((event) => event.type === 'workflow');
  const view = JSON.parse(moves.at(-1)?.content ?? '{}') as {
    current: number | null;
    done: number[];
    failed?: number;
  };
  return view;
}

describe('the idle deadline of a streamed agent turn (workflows R43)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fails Analyse with ModelTimeoutError when no chunk comes for five minutes', async () => {
    const ctx = build('v2', () => [{ after: 6 * MINUTE, chunk: text('late') }]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    const error = await outcome;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toBe(
      'Analyse failed: the model sent nothing for 5 minutes. The model may be busy or rate limited: run again later.',
    );
    expect(lastMove(events)).toMatchObject({ current: 7, failed: 7 });
    expect(ctx.signals[0].aborted).toBe(true);
    expect(ctx.agent.stream).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.writeAnswer).not.toHaveBeenCalled();
  });

  it('does not time out while chunks come every four minutes for twenty minutes', async () => {
    const ctx = build('v2', () => [
      now(SQL_CALL),
      now(SQL_RESULT),
      ...Array.from({ length: 5 }, () => ({
        after: 4 * MINUTE,
        chunk: text('Still working. '),
      })),
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(21 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.mastra.writeAnswer).toHaveBeenCalledTimes(1);
    expect(ctx.session.messages.at(-1)?.content).toBe(WRITTEN);
  });

  it('does not count a tool call that executes for six minutes', async () => {
    const ctx = build('v2', () => [
      { after: MINUTE, chunk: SQL_CALL },
      { after: 6 * MINUTE, chunk: SQL_RESULT },
      { after: 4 * MINUTE, chunk: text('Done.') },
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(12 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.mastra.writeAnswer).toHaveBeenCalledTimes(1);
  });

  it('a Stop during the wait is a Stop, never a timeout', async () => {
    const ctx = build('v2', () => [{ after: 6 * MINUTE, chunk: text('late') }]);
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events, controller.signal);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    controller.abort();
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(await outcome).toBe('done');
    const move = lastMove(events);
    expect(move).toMatchObject({ current: 7, done: [2, 3, 4, 5] });
    expect(move.failed).toBeUndefined();
    expect(ctx.mastra.writeAnswer).not.toHaveBeenCalled();
  });

  it('a clarifying question still stops only the attempt, and is no timeout', async () => {
    const ctx = build('v2', () => [
      {
        after: MINUTE,
        chunk: {
          type: 'tool-call',
          payload: {
            toolCallId: 'c1',
            toolName: 'ask_clarification',
            args: {
              question: 'Which measure?',
              options: 'Most wins\nMost goals',
            },
          },
        },
      },
      { after: 6 * MINUTE, chunk: text('never streamed') },
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Which measure?',
      clarification: { question: 'Which measure?' },
    });
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });

  it('fails the one-step Answer with ModelTimeoutError when no chunk comes for five minutes', async () => {
    const ctx = build('assistant', () => [
      { after: 6 * MINUTE, chunk: text('late') },
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    const error = await outcome;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toContain(
      'Answer failed: the model sent nothing for 5 minutes',
    );
    expect(ctx.signals[0].aborted).toBe(true);
  });

  it('answers the one-step Answer as before when chunks keep coming', async () => {
    const ctx = build('assistant', () => [
      now({
        type: 'tool-call',
        payload: { toolCallId: 'c0', toolName: 'list_entities', args: {} },
      }),
      now({
        type: 'tool-result',
        payload: {
          toolCallId: 'c0',
          toolName: 'list_entities',
          result: { entities: [] },
        },
      }),
      { after: 4 * MINUTE, chunk: text('Hello') },
      { after: 4 * MINUTE, chunk: text(' there.') },
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(9 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.session.messages.at(-1)?.content).toBe('Hello there.');
  });

  it('fails Explain report with ModelTimeoutError when no chunk comes for five minutes', async () => {
    const ctx = build('readiness', () => [
      { after: 6 * MINUTE, chunk: text('late') },
    ]);
    await ctx.service.onModuleInit();
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    const error = await outcome;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toBe(
      'Explain report failed: the model sent nothing for 5 minutes. The model may be busy or rate limited: run again later.',
    );
    // The steps before it ran (the report was saved and shown); Explain
    // report's one stream was aborted, never retried, and wrote no answer.
    expect(events.map((event) => event.type)).toEqual(['readiness-report']);
    expect(ctx.signals[0].aborted).toBe(true);
    expect(ctx.agent.stream).toHaveBeenCalledTimes(1);
    expect(
      ctx.session.messages.filter((message) => message.role === 'assistant'),
    ).toEqual([]);
  });

  it('explains the report as before while chunks come every four minutes', async () => {
    const ctx = build('readiness', () => [
      { after: 4 * MINUTE, chunk: text('World Cup ') },
      { after: 4 * MINUTE, chunk: text('is Managed.') },
    ]);
    await ctx.service.onModuleInit();
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(9 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.signals[0].aborted).toBe(false);
    expect(ctx.session.messages.at(-1)?.content).toBe('World Cup is Managed.');
  });
});

describe('the retry of Analyse carries attempt 1 forward (agents.md 5.11; workflows R27)', () => {
  /** Attempt 1's query: a LIMIT with no sort, so the sample check fails. */
  const SAMPLE_SQL = 'SELECT id FROM wc.public.matches LIMIT 1';
  const sampleCall = {
    type: 'tool-call',
    payload: {
      toolCallId: 's1',
      toolName: 'run_readonly_sql',
      args: { sql: SAMPLE_SQL, rationale: 'I look at one match.' },
    },
  };
  const sampleResult = {
    type: 'tool-result',
    payload: {
      toolCallId: 's1',
      toolName: 'run_readonly_sql',
      result: { columns: ['id'], rows: [{ id: 7 }], rowCount: 1 },
    },
  };
  const ATTEMPT_1 = [now(sampleCall), now(sampleResult), now(text('Notes.'))];
  type WrittenInput = {
    queries: { sql: string }[];
    findings: { check: string; passed: boolean }[];
  };
  const written = (ctx: ReturnType<typeof build>) =>
    (ctx.mastra.writeAnswer.mock.calls[0] as unknown[])[0] as WrittenInput;
  const streamOptions = (ctx: ReturnType<typeof build>, call: number) =>
    (ctx.agent.stream.mock.calls[call] as unknown[])[1] as {
      maxSteps?: number;
      context: { role: string; content: string }[];
    };

  it('answers from attempt 1 when the retry ends on a model error: the stream error is cleared, the records kept, the retry check a warning', async () => {
    const ctx = build('v2', (call) =>
      call === 1
        ? ATTEMPT_1
        : [now({ type: 'error', payload: { error: new Error('Overloaded') } })],
    );
    const events: StreamEvent[] = [];
    expect(await startTurn(ctx, events)).toBe('done');
    expect(ctx.agent.stream).toHaveBeenCalledTimes(2);
    // The retry runs with its own step budget; attempt 1 keeps the agent's.
    expect(streamOptions(ctx, 0).maxSteps).toBe(15);
    expect(streamOptions(ctx, 1).maxSteps).toBe(8);
    // It is shown attempt 1's query after the plan block.
    const system = streamOptions(ctx, 1).context.map((c) => c.content);
    const plan = system.findIndex((c) =>
      c.startsWith('Analysis plan for this turn:'),
    );
    expect(system[plan + 1]).toContain(
      `1. [flagged: No answer from a sample] I look at one match. | SQL: ${SAMPLE_SQL}`,
    );
    expect(
      streamOptions(ctx, 0).context.some((c) =>
        c.content.startsWith('Queries an earlier attempt'),
      ),
    ).toBe(false);
    const input = written(ctx);
    expect(input.queries.map((q) => q.sql)).toEqual([SAMPLE_SQL]);
    expect(input.findings.at(-1)).toMatchObject({
      check: 'Retry completed (warning only)',
      passed: false,
    });
    const answer = ctx.session.messages.at(-1)!;
    expect(answer.content).toBe(WRITTEN);
    // The answer's sources: attempt 1's one record, indexed once.
    expect(answer.data?.map((record) => record.input)).toEqual([SAMPLE_SQL]);
    expect(answer.evidence?.map((entry) => entry.index)).toEqual([0]);
    expect(lastMove(events).failed).toBeUndefined();
  });

  it("keeps every record of both attempts once, in run order, while Write answer reads the merged set, attempt 2's first", async () => {
    const ctx = build('v2', (call) =>
      call === 1
        ? ATTEMPT_1
        : [now(SQL_CALL), now(SQL_RESULT), now(text('Ok.'))],
    );
    expect(await startTurn(ctx, [])).toBe('done');
    // The flagged sample is left out of the merged set.
    expect(written(ctx).queries.map((q) => q.sql)).toEqual(['SELECT 1 AS n']);
    const answer = ctx.session.messages.at(-1)!;
    expect(answer.data?.map((record) => record.input)).toEqual([
      SAMPLE_SQL,
      'SELECT 1 AS n',
    ]);
    expect(answer.evidence?.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it('still fails the run on a model error in attempt 1', async () => {
    const ctx = build('v2', () => [
      now({ type: 'error', payload: { error: new Error('Overloaded') } }),
    ]);
    const outcome = await startTurn(ctx, []);
    expect(outcome).toBeInstanceOf(Error);
    expect(ctx.agent.stream).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.writeAnswer).not.toHaveBeenCalled();
  });

  it('still ends the run on a Stop during the retry, writing no answer', async () => {
    const controller = new AbortController();
    const ctx = build('v2', (call) => {
      if (call === 1) return ATTEMPT_1;
      controller.abort();
      return [now(text('stopped'))];
    });
    expect(await startTurn(ctx, [], controller.signal)).toBe('done');
    expect(ctx.agent.stream).toHaveBeenCalledTimes(2);
    expect(ctx.mastra.writeAnswer).not.toHaveBeenCalled();
  });
});

describe("a retry of a step's model call (workflows R43)", () => {
  it('is shown as a reasoning line of the running step', async () => {
    const ctx = build('v2', () => [
      now(SQL_CALL),
      now(SQL_RESULT),
      now(text('Done.')),
    ]);
    ctx.mastra.planAnalysis.mockImplementation(
      ({ question }: { question: string }, opts?: unknown) => {
        (opts as { onRetry: (line: string) => void }).onRetry(
          'Plan: the model call failed (fetch failed). Trying once more in 2 seconds.',
        );
        return Promise.resolve({ plan: planOf({}, question), stopped: false });
      },
    );
    const events: StreamEvent[] = [];
    expect(await startTurn(ctx, events)).toBe('done');
    expect(events).toContainEqual({
      type: 'reasoning',
      content:
        'Plan: the model call failed (fetch failed). Trying once more in 2 seconds.\n',
    });
  });
});
