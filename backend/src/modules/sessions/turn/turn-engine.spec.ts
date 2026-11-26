// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the turn specs never call it for real.
jest.mock('../../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// The idle deadline of a streamed agent turn (workflows R43; agents.md 1.6):
// Michael's analysis for Avery (Avery + Michael), the one-step Answer and
// Explain report fail with ModelTimeoutError
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
import { orchestratedMichaelWorkflow } from '../../../mastra/workflows/orchestrated-answer-michael.workflow';
import { dataReadinessAssessmentWorkflow } from '../../../mastra/workflows/data-readiness-assessment.workflow';
import { ModelTimeoutError } from '../../../mastra/workflows/model-call';
import { streamTurnWorkflow } from '../../../mastra/testing/turn-workflow.stub';

const MINUTE = 60_000;

type StubRun = {
  stream(args: { inputData: unknown; requestContext: unknown }): unknown;
};
const averyWorkflow = orchestratedMichaelWorkflow as unknown as {
  createRun(): Promise<StubRun>;
};
const readinessWorkflow = dataReadinessAssessmentWorkflow as unknown as {
  createRun(): Promise<StubRun>;
};
/** The code workflow a turn streams, by its key. */
const codeWorkflowOf = (key: string) =>
  key === 'data-readiness-assessment' ? readinessWorkflow : averyWorkflow;

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
/** Avery's closing words, after every brief of hers. */
const CLOSING = 'That is the count.';

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
  avery: 'insights-analyst',
  assistant: 'assistant',
  readiness: 'data-readiness',
} as const;

/**
 * A turn of an Answer a Business Question (Avery + Michael) host (Avery
 * calls answer_from_data once per brief of `briefs`, then closes; Michael's
 * analysis streams), of an assistant session (the one-step Answer streams)
 * or of an Assess Data Readiness session (Explain report streams); each
 * agent stream sends `steps` (a function of the call, to give a second call
 * its own). What Michael's calls told Avery is in `told`.
 */
function build(
  kind: 'avery' | 'assistant' | 'readiness',
  steps: (call: number) => Timed[],
  briefs: string[] = ['Count every match.'],
) {
  const session: SessionDoc = {
    id: 's-1',
    name: 'Goals',
    datasets: ['World Cup'],
    messages: [],
    visualizations: [],
    ...(kind === 'avery'
      ? {
          workflowId: 'orchestrated-answer-michael',
          agentKey: 'insights-analyst',
          agentName: 'Insights Analyst',
        }
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
  // Avery: each brief through her answer_from_data, then her closing words.
  const told: string[] = [];
  registry['chief-of-staff'] = {
    id: 'chief-of-staff',
    name: 'Chief of Staff',
    stream: jest.fn(
      (
        _messages: unknown,
        opts: { requestContext: { get(key: string): unknown } },
      ) => {
        const tools = opts.requestContext.get('orchestrator-tools-runtime') as {
          answerFromData(brief: string): Promise<string>;
        };
        return Promise.resolve({
          fullStream: (async function* () {
            for (const brief of briefs) {
              told.push(await tools.answerFromData(brief));
            }
            yield text(CLOSING);
          })(),
        });
      },
    ),
  };
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
    recordAgentExchange: jest.fn().mockResolvedValue(undefined),
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
  return { service, session, mastra, agent, signals, told };
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

describe('the idle deadline of a streamed agent turn (workflows R43)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fails Michael's analysis with ModelTimeoutError when no chunk comes for five minutes", async () => {
    const ctx = build('avery', () => [
      { after: 6 * MINUTE, chunk: text('late') },
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    const error = await outcome;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toBe(
      'Analyse failed: the model sent nothing for 5 minutes. The model may be busy or rate limited: run again later.',
    );
    expect(ctx.signals[0].aborted).toBe(true);
    expect(ctx.agent.stream).toHaveBeenCalledTimes(1);
  });

  it('does not time out while chunks come every four minutes for twenty minutes', async () => {
    const ctx = build('avery', () => [
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
    // Michael's reply is the answer, then Avery's closing words.
    expect(ctx.session.messages.at(-1)?.content).toBe(
      `${'Still working. '.repeat(5).trim()}\n\n${CLOSING}`,
    );
  });

  it('does not count a tool call that executes for six minutes', async () => {
    const ctx = build('avery', () => [
      { after: MINUTE, chunk: SQL_CALL },
      { after: 6 * MINUTE, chunk: SQL_RESULT },
      { after: 4 * MINUTE, chunk: text('Done.') },
    ]);
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events);
    await jest.advanceTimersByTimeAsync(12 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.session.messages.at(-1)?.content).toBe(`Done.\n\n${CLOSING}`);
  });

  it('a Stop during the wait is a Stop, never a timeout', async () => {
    const ctx = build('avery', () => [
      { after: 6 * MINUTE, chunk: text('late') },
    ]);
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    const outcome = startTurn(ctx, events, controller.signal);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    controller.abort();
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(await outcome).toBe('done');
    expect(ctx.agent.stream).toHaveBeenCalledTimes(1);
  });

  it("a clarifying question still stops only Michael's attempt, and is no timeout: Avery is told it", async () => {
    const ctx = build('avery', () => [
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
    expect(ctx.told).toEqual([
      'Michael needs an answer before he can go on: Which measure?\n- Most wins\n- Most goals',
    ]);
    expect(ctx.session.messages.at(-1)?.content).toBe(CLOSING);
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

describe("Avery's second answer_from_data call (agents.md 5.11, 5.23; workflows R27)", () => {
  /** Michael's first answer: one query and his reply. */
  const FIRST = [now(SQL_CALL), now(SQL_RESULT), now(text('One match.'))];
  const streamOptions = (ctx: ReturnType<typeof build>, call: number) =>
    (ctx.agent.stream.mock.calls[call] as unknown[])[1] as {
      maxSteps?: number;
      memory?: unknown;
      context: { role: string; content: string }[];
    };

  it("runs with the retry's step budget, and keeps his first answer when it ends on a model error", async () => {
    const ctx = build(
      'avery',
      (call) =>
        call === 1
          ? FIRST
          : [
              now({
                type: 'error',
                payload: { error: new Error('Overloaded') },
              }),
            ],
      ['Count every match.', 'Count them by stage.'],
    );
    expect(await startTurn(ctx, [])).toBe('done');
    expect(ctx.agent.stream).toHaveBeenCalledTimes(2);
    // The second call runs with its own step budget and no memory thread.
    expect(streamOptions(ctx, 0).maxSteps).toBe(15);
    expect(streamOptions(ctx, 1).maxSteps).toBe(8);
    expect(streamOptions(ctx, 1).memory).toBeUndefined();
    // Each call carries her brief and the alone line.
    for (const [call, brief] of [
      [0, 'Count every match.'],
      [1, 'Count them by stage.'],
    ] as const) {
      const system = streamOptions(ctx, call).context.map((c) => c.content);
      expect(system).toContainEqual(
        expect.stringContaining(
          `Brief from Avery, the Chief of Staff: ${brief}\n\nYou work alone with Avery in this run`,
        ),
      );
    }
    const answer = ctx.session.messages.at(-1)!;
    expect(answer.content).toBe(`One match.\n\n${CLOSING}`);
    // The answer's sources: the first call's one record.
    expect(answer.data?.map((record) => record.input)).toEqual([
      'SELECT 1 AS n',
    ]);
  });

  it('still fails the run on a model error in his first call', async () => {
    const ctx = build('avery', () => [
      now({ type: 'error', payload: { error: new Error('Overloaded') } }),
    ]);
    const outcome = await startTurn(ctx, []);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('Overloaded');
    expect(ctx.agent.stream).toHaveBeenCalledTimes(1);
  });

  it('still ends the run on a Stop during the second call', async () => {
    const controller = new AbortController();
    const ctx = build(
      'avery',
      (call) => {
        if (call === 1) return FIRST;
        controller.abort();
        return [now(text('stopped'))];
      },
      ['one', 'two'],
    );
    expect(await startTurn(ctx, [], controller.signal)).toBe('done');
    expect(ctx.agent.stream).toHaveBeenCalledTimes(2);
  });
});
