// A run of an agent workflow is one agent turn on a run host, through
// today's turn path (ADR-0041; agents.md 5.14; plan 5.1): these specs run the
// real SessionsService and WorkflowRunsService against stubbed agents, and
// check the run's model request equals a chat turn's for the same input.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    readonly values = new Map<string, unknown>();
    set = (key: string, value: unknown) => {
      this.values.set(key, value);
    };
    get = (key: string) => this.values.get(key);
  },
}));
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/model-resolver', () => ({
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  isCustomAnthropicConfig: (c: unknown) =>
    typeof c === 'object' && c !== null && 'kind' in c,
  resolveAgentModelConfig: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));
jest.mock('../../mastra/tool-services', () => ({
  setDatasetToolServices: jest.fn(),
  // v2's Load catalog step reads the datasets as the dataset tools do.
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
jest.mock('../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual-id',
  SESSION_ID_CONTEXT_KEY: 'session-id',
  TURN_QUESTION_CONTEXT_KEY: 'turn-question',
  TURN_RECORDS_CONTEXT_KEY: 'turn-data-records',
}));
jest.mock('../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
  listSessionWorkspaceIds: jest.fn(() => []),
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../verified-queries/verified-queries.service', () => ({
  VerifiedQueriesService: class {},
}));
jest.mock('../metrics/metrics.service', () => ({ MetricsService: class {} }));
jest.mock('../ontology/ontology.service', () => ({
  OntologyService: class {},
}));
jest.mock('../../mastra/agents/sql-fixer.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlFixOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('../../mastra/agents/sql-verifier.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlVerifyOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('./repositories/sessions.repository', () => ({
  SessionsRepository: class {},
}));
jest.mock('./visualization.service', () => ({
  VisualizationService: class {},
}));
jest.mock('../../common/markdown-pdf', () => ({ renderPdf: jest.fn() }));
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));
// The catalogue service reads the agent catalogue; a fake answers
// `definition`.
jest.mock('../workflows/workflows.service', () => ({
  WorkflowsService: class {},
}));

import { streamTurnWorkflow } from '../../mastra/testing/turn-workflow.stub';
import { QTI_V2_TURN_STEPS } from '../../mastra/workflows/qti-v2-turn.steps';
import { qtiV2TurnWorkflow } from '../../mastra/workflows/qti-v2-turn.workflow';
import { CODE_WORKFLOWS } from '../../mastra/workflows/workflow-catalog';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { listSessionWorkspaceIds } from '../../mastra/session-workspaces';
import { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import type { WorkflowRun } from '../workflows/workflow-run-steps';
import {
  WorkflowRunsService,
  type RunStreamEvent,
} from '../workflows/workflow-runs.service';
import type { WorkflowsService } from '../workflows/workflows.service';
import type { SessionDoc } from './entities/session.entity';
import { SessionsService, type StreamEvent } from './sessions.service';
import { streamStored } from './testing/stream-stored';

async function* streamOf(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

const DATASETS = [
  {
    name: 'World Cup',
    datasourceId: 'ds-pg',
    datasourceKind: 'postgres',
    tables: ['wc.public.matches'],
  },
  {
    name: 'Orders API',
    datasourceId: 'ds-rest',
    datasourceKind: 'rest',
    tables: ['orders'],
  },
];

/**
 * What a turn runs on: the one catalogue workflow (`v2`, a run), or a
 * built-in agent's direct host (`assistant`, `readiness`: the eval runner's,
 * 1.23.35).
 */
type Workflow = 'assistant' | 'v2' | 'readiness';

/** The workflow detail the fake catalogue answers for `qti-v2-turn`. */
const V2_WORKFLOW = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  input: CODE_WORKFLOWS[0].input,
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
  steps: QTI_V2_TURN_STEPS,
};

/** The registry key of the agent each turn calls. */
const AGENT_KEYS: Record<Workflow, string> = {
  assistant: 'assistant',
  v2: 'assistant-v2',
  readiness: 'data-readiness',
};

/** The chat session that takes the same input as each turn. */
const SESSIONS: Record<Workflow, Partial<SessionDoc>> = {
  assistant: { datasets: ['World Cup'] },
  v2: {
    datasets: ['World Cup'],
    agentKey: 'assistant-v2',
    agentName: 'Questions to Insights v2',
  },
  readiness: {
    datasets: ['World Cup'],
    agentKey: 'data-readiness',
    agentName: 'Data Readiness Agent',
  },
};

/** The v2 run input that asks what the chat message asks. */
const V2_INPUT = { question: 'Who won?', datasets: ['World Cup'] };

interface StreamCall {
  input: unknown;
  options: {
    maxSteps?: number;
    providerOptions?: unknown;
    context: { role: string; content: string }[];
    memory?: { thread: string; resource: string };
    requestContext: { values: Map<string, unknown> };
    abortSignal?: AbortSignal;
  };
}

interface BuildOptions {
  chunks?: unknown[];
  /** Hold the agent's stream open until the test aborts it. */
  holdUntilAbort?: boolean;
  /** The chat session's earlier transcript and stored fields. */
  session?: Partial<SessionDoc>;
}

function build(options: BuildOptions = {}) {
  const sessionStore = new Map<string, SessionDoc>();
  const repository = {
    get: jest.fn((id: string) => Promise.resolve(sessionStore.get(id) ?? null)),
    update: jest.fn((id: string, patch: object) => {
      const doc = sessionStore.get(id);
      if (doc) Object.assign(doc, patch);
      return Promise.resolve(doc ?? null);
    }),
    listAll: jest.fn().mockResolvedValue([]),
  };
  const calls: Record<string, StreamCall[]> = {};
  const agentFor = (key: string, name: string) => {
    calls[key] = [];
    return {
      id: key,
      name,
      getDescription: () => `${name} description`,
      // No thread yet: a chat's first turn, and every run.
      getMemory: jest.fn().mockResolvedValue({
        getThreadById: jest.fn().mockResolvedValue(null),
      }),
      stream: jest.fn((input: unknown, opts: StreamCall['options']) => {
        calls[key].push({ input, options: opts });
        if (options.holdUntilAbort) {
          return Promise.resolve({
            fullStream: (async function* () {
              await new Promise<void>((resolve) => {
                if (opts.abortSignal?.aborted) resolve();
                opts.abortSignal?.addEventListener('abort', () => resolve());
              });
              yield* [];
              throw new Error('aborted');
            })(),
            text: Promise.resolve(''),
          });
        }
        return Promise.resolve({
          fullStream: streamOf(
            // A tool call, so the assistant's grounding guard stays quiet.
            options.chunks ?? [
              {
                type: 'tool-call',
                payload: {
                  toolCallId: 'c0',
                  toolName: 'list_entities',
                  args: {},
                },
              },
              {
                type: 'tool-result',
                payload: {
                  toolCallId: 'c0',
                  toolName: 'list_entities',
                  result: { entities: [] },
                },
              },
              { type: 'text-delta', payload: { text: 'Brazil won.' } },
            ],
          ),
          text: Promise.resolve(''),
        });
      }),
      generate: jest.fn().mockResolvedValue({ text: 'Synthesized.' }),
    };
  };
  const registry: Record<string, ReturnType<typeof agentFor>> = {
    assistant: agentFor('assistant', 'Questions to Insights Assistant'),
    'assistant-v2': agentFor('assistant-v2', 'Questions to Insights v2'),
    'data-readiness': agentFor('data-readiness', 'Data Readiness Agent'),
  };
  const v2Workflow = qtiV2TurnWorkflow as unknown as {
    createRun(): Promise<{
      stream(args: { inputData: unknown; requestContext: unknown }): unknown;
    }>;
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: jest.fn(
      async (key: string, inputData: unknown, requestContext: unknown) =>
        key === 'qti-v2-turn'
          ? (await v2Workflow.createRun()).stream({ inputData, requestContext })
          : streamTurnWorkflow(key, inputData, requestContext),
    ),
    ensureSessionWorkspace: jest.fn((id: string) =>
      Promise.resolve({ id: `session-${id}` }),
    ),
    deleteMemoryThread: jest.fn().mockResolvedValue(undefined),
    deleteSessionResources: jest.fn().mockResolvedValue(undefined),
  };
  const userAgents = {
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    skillsFor: jest.fn().mockResolvedValue([]),
    datasetNames: jest
      .fn()
      .mockResolvedValue(new Set(DATASETS.map((d) => d.name))),
    datasetKinds: jest
      .fn()
      .mockResolvedValue(
        DATASETS.map(({ name, datasourceKind }) => ({ name, datasourceKind })),
      ),
  };
  const datasetsRepository = {
    getByNames: jest.fn((names: string[]) =>
      Promise.resolve(DATASETS.filter((d) => names.includes(d.name))),
    ),
    list: jest.fn().mockResolvedValue(DATASETS),
  };
  const sessions = new SessionsService(
    repository as never,
    mastra as never,
    datasetsRepository as never,
    { get: jest.fn().mockResolvedValue({ id: 'ds', name: 'DS' }) } as never,
    {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
    } as never,
    {} as never,
    {
      referenceBlock: jest.fn().mockResolvedValue(undefined),
      isVerifiedSql: jest.fn().mockResolvedValue(false),
    } as never,
    { definitionBlock: jest.fn().mockResolvedValue(undefined) } as never,
    {
      contextFor: jest.fn().mockResolvedValue({ block: '', used: [] }),
    } as never,
    userAgents as never,
  );
  const workflows = {
    definition: jest.fn((id: string) =>
      id === V2_WORKFLOW.id
        ? Promise.resolve(V2_WORKFLOW)
        : Promise.reject(new Error(`Workflow "${id}" not found`)),
    ),
  };
  const runs = new WorkflowRunsService(
    workflows as unknown as WorkflowsService,
    sessions,
    datasetsRepository as never,
    mastra as never,
    new WorkflowRunsRepository(
      new SqliteDocStore(new BetterSqlite3(':memory:'), 'workflow_runs'),
    ),
  );
  /** A chat session over the same input as `workflow`'s run. */
  const chat = (workflow: Workflow): SessionDoc => {
    const doc: SessionDoc = {
      id: `s-${workflow}`,
      name: 'Chat',
      messages: [],
      visualizations: [],
      datasets: [],
      ...SESSIONS[workflow],
      ...options.session,
    };
    sessionStore.set(doc.id, doc);
    return doc;
  };
  return { sessions, runs, mastra, registry, calls, chat, userAgents };
}

type Ctx = ReturnType<typeof build>;

async function chatTurn(
  ctx: Ctx,
  sessionId: string,
  content: string,
  careful = false,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await streamStored(
    ctx.sessions,
    sessionId,
    content,
    (e) => events.push(e),
    undefined,
    undefined,
    careful,
  );
  return events;
}

/** A run of `qti-v2-turn` on `input`. */
async function runOf(
  ctx: Ctx,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<{ events: RunStreamEvent[]; run: WorkflowRun }> {
  const events: RunStreamEvent[] = [];
  const prepared = await ctx.runs.prepare(V2_WORKFLOW.id, {
    input,
    ...extra,
  });
  const run = await ctx.runs.stream(prepared, (e) => events.push(e), signal);
  return { events, run };
}

/**
 * One turn on a built-in agent's direct host, as the eval runner makes it
 * (`createEvalHost`): the host, the turn, then the host's view.
 */
async function agentHostTurn(
  ctx: Ctx,
  agentKey: string,
  question: string,
  options: { datasets?: string[]; careful?: boolean } = {},
) {
  const events: StreamEvent[] = [];
  const host = await ctx.sessions.createRunHost({
    runId: `eval-${agentKey}`,
    agentKey,
    name: `${agentKey} eval`,
    ...(options.datasets ? { datasets: options.datasets } : {}),
  });
  await ctx.sessions.streamRunTurn(
    host.id,
    question,
    (e) => events.push(e),
    undefined,
    options.careful ?? false,
    () => undefined,
  );
  const view = await ctx.sessions.finishRunHost(host.id);
  return { host, events, view };
}

const HOST_ONLY_KEYS = ['session-id', 'session-workspace-id'];

/**
 * A model call's request as the provider would see it: the input, the
 * options and the requestContext values, without what names the host (its
 * id, its workspace id and its memory thread id).
 */
function request(call: StreamCall) {
  const { requestContext, memory, abortSignal, ...rest } = call.options;
  void abortSignal;
  return {
    input: call.input,
    ...rest,
    memory: memory
      ? { ...memory, thread: '<host>', resource: '<host>' }
      : memory,
    requestContext: Object.fromEntries(
      [...requestContext.values.entries()].filter(
        ([key]) => !HOST_ONLY_KEYS.includes(key),
      ),
    ),
  };
}

function withoutTime<T extends { at?: string }>(message: T | undefined) {
  if (!message) return message;
  const { at, ...rest } = message;
  void at;
  return rest;
}

describe('a run sends the same model request as a chat turn (plan 1.24.2; agents.md 5.14)', () => {
  it('v2: the same input, options, system blocks and tools context, and the same answer', async () => {
    const ctx = build();
    const session = ctx.chat('v2');
    await chatTurn(ctx, session.id, 'Who won?');
    const { run } = await runOf(ctx, V2_INPUT);

    const [chatCall, runCall] = ctx.calls['assistant-v2'];
    expect(ctx.calls['assistant-v2']).toHaveLength(2);
    expect(request(runCall)).toEqual(request(chatCall));
    // The host names itself where the session did.
    expect(runCall.options.requestContext.values.get('session-id')).toBe(
      `run-${run.id}`,
    );
    expect(runCall.options.memory?.thread ?? `run-${run.id}`).toBe(
      `run-${run.id}`,
    );
    expect(run.status).toBe('success');
    expect(withoutTime(run.answer)).toEqual(
      withoutTime(session.messages.at(-1)),
    );
    expect(run.answer?.content).toBe('Brazil won.');
  });

  // The eval runner's direct host (1.23.35): the assistant and the Data
  // Readiness Agent have no catalogue workflow, and still run their turn.
  it.each(['assistant', 'readiness'] as const)(
    "%s's agent host: the same request as its chat turn, and the same answer",
    async (workflow) => {
      const ctx = build();
      const agentKey = AGENT_KEYS[workflow];
      const session = ctx.chat(workflow);
      await chatTurn(ctx, session.id, 'Who won?');
      const { host, view } = await agentHostTurn(ctx, agentKey, 'Who won?', {
        ...(workflow === 'assistant' ? { datasets: ['World Cup'] } : {}),
      });

      const [chatCall, hostCall] = ctx.calls[agentKey];
      expect(ctx.calls[agentKey]).toHaveLength(2);
      expect(request(hostCall)).toEqual(request(chatCall));
      expect(hostCall.options.requestContext.values.get('session-id')).toBe(
        host.id,
      );
      // Bound as its chat is, on the agent-turn engine, over the same data.
      expect(host).toMatchObject({
        datasets: ['World Cup'],
        workflowId: `agent:${agentKey}`,
        run: true,
      });
      expect(withoutTime(view.messages.at(-1))).toEqual(
        withoutTime(session.messages.at(-1)),
      );
    },
  );
});

describe('the run host (agents.md 5.14)', () => {
  it('refuses a workflow the catalogue does not hold, and an agent with no agent-turn binding', async () => {
    const ctx = build();
    for (const workflowId of [
      'agent:assistant',
      'agent:data-readiness',
      'agent:agent-1',
      'seq-text-demo',
      'deep-analysis',
    ]) {
      await expect(
        ctx.sessions.createRunHost({ runId: 'r', workflowId, name: 'x' }),
      ).rejects.toThrow(`Workflow "${workflowId}" not found`);
    }
    for (const agentKey of ['sql-fixer', 'assistant-v2', 'rfp', 'agent-1']) {
      await expect(
        ctx.sessions.createRunHost({ runId: 'r', agentKey, name: 'x' }),
      ).rejects.toThrow(`Agent "${agentKey}" not found`);
    }
    expect(ctx.mastra.ensureSessionWorkspace).not.toHaveBeenCalled();
  });

  it("refuses a Data Readiness host while no dataset qualifies, with the agent's requirement", async () => {
    const ctx = build();
    ctx.userAgents.datasetKinds.mockResolvedValue([
      { name: 'Orders API', datasourceKind: 'rest' },
    ]);
    await expect(
      ctx.sessions.createRunHost({
        runId: 'r',
        agentKey: 'data-readiness',
        name: 'x',
      }),
    ).rejects.toThrow('Add a PostgreSQL or Databricks dataset first');
  });

  it('is created per run and discarded after it: never listed, its memory thread deleted, its workspace kept', async () => {
    const ctx = build();
    const { run } = await runOf(ctx, V2_INPUT);
    const hostId = `run-${run.id}`;
    expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenCalledWith(
      hostId,
      'Questions to Insights v2',
    );
    expect(ctx.mastra.deleteMemoryThread).toHaveBeenCalledWith(hostId);
    expect(ctx.mastra.deleteSessionResources).not.toHaveBeenCalled();
    await expect(ctx.sessions.get(hostId)).rejects.toThrow(
      `Session ${hostId} not found`,
    );
    // Each run gets its own host.
    const second = await runOf(ctx, V2_INPUT);
    expect(second.run.id).not.toBe(run.id);
    expect(ctx.mastra.deleteMemoryThread).toHaveBeenLastCalledWith(
      `run-${second.run.id}`,
    );
  });

  it('narrows a host to the datasets an eval run names, and deletes its workspace with it (agents.md 8.3)', async () => {
    const ctx = build();
    const host = await ctx.sessions.createRunHost({
      runId: 'eval-1',
      agentKey: 'assistant',
      name: 'assistant eval',
      datasets: ['World Cup', 'Formula 1'],
    });
    ctx.sessions.narrowRunHost(host.id, ['World Cup', 'Unknown']);
    expect((await ctx.sessions.get(host.id)).datasets).toEqual(['World Cup']);
    // Nothing to keep leaves the host as it was.
    ctx.sessions.narrowRunHost(host.id, ['Unknown']);
    expect((await ctx.sessions.get(host.id)).datasets).toEqual(['World Cup']);
    await ctx.sessions.deleteRunHostResources(host.id);
    expect(ctx.mastra.deleteSessionResources).toHaveBeenCalledWith(host.id);
    await expect(ctx.sessions.get(host.id)).rejects.toThrow('not found');
  });

  it('sends the earlier run as two messages before this question (plan 5.4)', async () => {
    const ctx = build();
    const first = await runOf(ctx, V2_INPUT);
    await runOf(
      ctx,
      { question: 'And in 2014?', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    expect(ctx.calls['assistant-v2'][1].input).toEqual([
      { role: 'user', content: 'Who won?' },
      { role: 'assistant', content: 'Brazil won.' },
      { role: 'user', content: 'And in 2014?' },
    ]);
  });

  it('a stopped run aborts the agent stream and is stopped', async () => {
    const ctx = build({ holdUntilAbort: true });
    const abort = new AbortController();
    const pending = runOf(ctx, V2_INPUT, {}, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const call = ctx.calls['assistant-v2'][0];
    expect(call.options.abortSignal?.aborted).toBe(false);
    abort.abort();
    const { run, events } = await pending;
    expect(call.options.abortSignal?.aborted).toBe(true);
    expect(run.status).toBe('stopped');
    expect(events.some((e) => e.type === 'done' || e.type === 'error')).toBe(
      false,
    );
    expect(ctx.mastra.deleteMemoryThread).toHaveBeenCalledWith(`run-${run.id}`);
  });

  it("careful: true on an agent host's turn runs the cross-check, as a careful chat turn does", async () => {
    const ctx = build();
    const crossCheck = jest
      .spyOn(
        ctx.sessions as unknown as { crossCheckAnswer: () => Promise<unknown> },
        'crossCheckAnswer',
      )
      .mockResolvedValue({ status: 'agree', note: 'same' });
    const { view } = await agentHostTurn(ctx, 'assistant', 'Who won?', {
      datasets: ['World Cup'],
      careful: true,
    });
    expect(crossCheck).toHaveBeenCalledTimes(1);
    expect(view.messages.at(-1)?.crossCheck).toEqual({
      status: 'agree',
      note: 'same',
    });
    crossCheck.mockClear();
    // A v2 run takes no careful field: its input has none.
    await runOf(ctx, { ...V2_INPUT, careful: true });
    expect(crossCheck).not.toHaveBeenCalled();
  });

  it('a v2 run emits a running and an ended step event for each of its four steps', async () => {
    const ctx = build();
    const { events, run } = await runOf(ctx, V2_INPUT);
    const steps = events.filter(
      (e): e is Extract<RunStreamEvent, { type: 'step' }> => e.type === 'step',
    );
    expect(steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'analyse:running',
      'analyse:success',
      'wrap-up:running',
      'wrap-up:success',
    ]);
    expect(run.steps.map((s) => s.status)).toEqual([
      'success',
      'success',
      'success',
      'success',
    ]);
    expect(run.output).toEqual({ sqlQueries: 0, failedQueries: 0, rows: 0 });
    // v2's bar still moves from its steps, as in a chat.
    expect(events.some((e) => e.type === 'workflow')).toBe(true);
  });

  it("a Data Readiness agent host forwards tool-progress and runs over its kind's datasets", async () => {
    const ctx = build({
      chunks: [
        {
          type: 'tool-call',
          payload: {
            toolCallId: 'c1',
            toolName: 'assess_data_readiness',
            args: { dataset: 'World Cup' },
          },
        },
        {
          type: 'data-readiness-progress',
          data: {
            phase: 'profiling',
            message: 'Profiling 1 of 2',
            done: 1,
            total: 2,
          },
        },
        { type: 'text-delta', payload: { text: 'Assessed.' } },
      ],
    });
    const { events, view } = await agentHostTurn(
      ctx,
      'data-readiness',
      'Assess the readiness of this dataset',
    );
    const progress = events.find((e) => e.type === 'tool-progress');
    expect(JSON.parse(progress?.content ?? '{}')).toEqual({
      tool: 'assess_data_readiness',
      phase: 'profiling',
      message: 'Profiling 1 of 2',
      done: 1,
      total: 2,
    });
    // Its PostgreSQL and Databricks datasets; never the REST one.
    expect(view.datasets).toEqual(['World Cup']);
    expect(ctx.calls['data-readiness'][0].input).toEqual([
      { role: 'user', content: 'Assess the readiness of this dataset' },
    ]);
  });
});

describe('run host workspaces at start-up (data-model 3.16; agents.md 5.14)', () => {
  const workspaceIds = listSessionWorkspaceIds as jest.Mock;
  afterEach(() => workspaceIds.mockReset().mockReturnValue([]));

  it('the sessions sweep discards previews only: a run host workspace belongs to its stored run', async () => {
    const ctx = build();
    workspaceIds.mockReturnValue(['preview-a', 'run-b', 'abc']);
    await ctx.sessions.onModuleInit();
    expect(ctx.mastra.deleteSessionResources).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.deleteSessionResources).toHaveBeenCalledWith('preview-a');
  });

  it('lists the run host ids that have a workspace, for the runs’ recovery', () => {
    const ctx = build();
    workspaceIds.mockReturnValue(['preview-a', 'run-b', 'abc', 'run-c']);
    expect(ctx.sessions.runHostWorkspaceIds()).toEqual(['run-b', 'run-c']);
  });
});
