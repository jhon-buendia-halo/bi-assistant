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

import {
  streamStubWorkflow,
  streamTurnWorkflow,
} from '../../mastra/testing/turn-workflow.stub';
import {
  QTI_V2_TURN_STEPS,
  planOf,
} from '../../mastra/workflows/qti-v2-turn.steps';
import { qtiV2TurnWorkflow } from '../../mastra/workflows/qti-v2-turn.workflow';
import { CODE_WORKFLOWS } from '../../mastra/workflows/workflow-catalog';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { listSessionWorkspaceIds } from '../../mastra/session-workspaces';
import { WorkflowNodeChatsRepository } from '../workflows/repositories/workflow-node-chats.repository';
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
  edges: CODE_WORKFLOWS[0].edges,
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

/** v2's Analyse turn: one successful query, then its note. */
const V2_ANALYSE_CHUNKS = [
  {
    type: 'tool-call',
    payload: {
      toolCallId: 'q0',
      toolName: 'run_readonly_sql',
      args: { sql: 'SELECT winner FROM matches', rationale: 'Who won.' },
    },
  },
  {
    type: 'tool-result',
    payload: {
      toolCallId: 'q0',
      toolName: 'run_readonly_sql',
      result: { columns: ['winner'], rows: [{ winner: 'Brazil' }] },
    },
  },
  { type: 'text-delta', payload: { text: 'A note.' } },
];

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
            // v2's Analyse runs one successful query, so Validate passes.
            options.chunks ??
              (key === 'assistant-v2' ? V2_ANALYSE_CHUNKS : undefined) ?? [
                // A tool call, so the assistant's grounding guard stays quiet.
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
  // Suspended v2 runs dropped (their snapshots deleted, ADR-0043).
  const discards = { count: 0 };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: jest.fn(
      (key: string, inputData: unknown, requestContext: unknown) =>
        key === 'qti-v2-turn'
          ? streamStubWorkflow(
              qtiV2TurnWorkflow,
              inputData,
              requestContext,
              discards,
            )
          : streamTurnWorkflow(key, inputData, requestContext),
    ),
    discardSuspendedWorkflowRuns: jest.fn().mockResolvedValue(0),
    ensureSessionWorkspace: jest.fn((id: string) =>
      Promise.resolve({ id: `session-${id}` }),
    ),
    deleteMemoryThread: jest.fn().mockResolvedValue(undefined),
    deleteSessionResources: jest.fn().mockResolvedValue(undefined),
    // v2's Plan and Write answer model calls (agents.md 5.11).
    planV2Turn: jest.fn(({ question }: { question: string }) =>
      Promise.resolve({ plan: planOf({}, question), stopped: false }),
    ),
    writeV2Answer: jest.fn(
      (_input: unknown, opts: { onText?: (delta: string) => void }) => {
        opts.onText?.('Brazil won.');
        return Promise.resolve({
          answer: { headline: 'Brazil won.', answer: 'Brazil won.' },
          stopped: false,
        });
      },
    ),
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
  const runsRepository = new WorkflowRunsRepository(
    new SqliteDocStore(new BetterSqlite3(':memory:'), 'workflow_runs'),
  );
  const runs = new WorkflowRunsService(
    workflows as unknown as WorkflowsService,
    sessions,
    datasetsRepository as never,
    mastra as never,
    runsRepository,
    new WorkflowNodeChatsRepository(
      new SqliteDocStore(
        new BetterSqlite3(':memory:'),
        'workflow_run_node_chats',
      ),
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
  return {
    sessions,
    runs,
    runsRepository,
    mastra,
    registry,
    calls,
    chat,
    userAgents,
    discards,
  };
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

/** Resume a waiting run with an answer (api.md 138). */
async function resumeOf(
  ctx: Ctx,
  runId: string,
  body: Record<string, unknown>,
): Promise<{ events: RunStreamEvent[]; run: WorkflowRun }> {
  const events: RunStreamEvent[] = [];
  const prepared = await ctx.runs.prepareResume(runId, body);
  const run = await ctx.runs.resume(prepared, (e) => events.push(e));
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

  it('a node chat host sends its transcript before the message and its context block after the agent’s own (agents.md 5.16)', async () => {
    const ctx = build();
    const host = await ctx.sessions.createRunHost({
      runId: 'r-1-node-analyse',
      workflowId: 'qti-v2-turn',
      name: 'Questions to Insights v2: Analyse',
      datasets: ['World Cup'],
      transcript: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: 'Because.' },
      ],
      contextBlock: 'NODE CHAT CONTEXT',
    });
    await ctx.sessions.streamRunTurn(
      host.id,
      'And then?',
      () => undefined,
      undefined,
      false,
      () => undefined,
    );
    await ctx.sessions.finishRunHost(host.id);
    const call = ctx.calls['assistant-v2'][0];
    expect(call.input).toEqual([
      { role: 'user', content: 'Why?' },
      { role: 'assistant', content: 'Because.' },
      { role: 'user', content: 'And then?' },
    ]);
    const system = (
      call.options as unknown as { context: { content: string }[] }
    ).context.map((block) => block.content);
    const at = system.indexOf('NODE CHAT CONTEXT');
    expect(at).toBeGreaterThan(0);
    // The turn is the step's agent alone (agents.md 5.16): no plan, no
    // catalog or plan block, no answer step; the context block comes last.
    expect(at).toBe(system.length - 1);
    expect(ctx.mastra.planV2Turn).not.toHaveBeenCalled();
    expect(ctx.mastra.writeV2Answer).not.toHaveBeenCalled();
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
      'agent-turn',
      expect.anything(),
      expect.anything(),
    );
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

  it('a v2 run emits a running and an ended step event for each step it takes, and skips the branch it does not', async () => {
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
      'plan:running',
      'plan:success',
      'analyse:running',
      'analyse:success',
      'validate:running',
      'validate:success',
      'write-answer:running',
      'write-answer:success',
      'wrap-up:running',
      'wrap-up:success',
      'clarify:skipped',
    ]);
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success',
      'clarify:skipped',
      'analyse:success',
      'validate:success',
      'write-answer:success',
      'wrap-up:success',
    ]);
    // The loops' steps carry their attempt (api.md 3.6): Plan (Clarify
    // loops back to it) and the analysis's.
    expect(
      run.steps.filter((s) => s.attempt !== undefined).map((s) => s.id),
    ).toEqual(['plan', 'analyse', 'validate']);
    expect(run.output).toMatchObject({
      sqlQueries: 1,
      failedQueries: 0,
      answer: 'Brazil won.',
    });
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

/** A plan that asks the user first (agents.md 5.11). */
const ASKING_PLAN = planOf(
  {
    needsClarification: true,
    clarification: {
      question: 'Dominant by what measure?',
      options: ['Matches won', 'Goals scored'],
    },
  },
  'Which team was the most dominant?',
);

/** The agent asks the user mid-analysis (`ask_clarification`). */
const ASK_CHUNKS = [
  {
    type: 'tool-call',
    payload: {
      toolCallId: 'a0',
      toolName: 'ask_clarification',
      args: {
        question: 'Which tournament?',
        options: '2018 — Russia\n2022 — Qatar',
      },
    },
  },
  { type: 'text-delta', payload: { text: 'Never reached.' } },
];

const stepLine = (s: { id: string; status: string; attempt?: number }) =>
  `${s.id}:${s.status}${s.attempt ? `#${s.attempt}` : ''}`;

describe('a v2 run that waits for the user (api.md 119, 138; ADR-0043)', () => {
  it('suspends at Clarify: the waiting step, input-required, then done with the run suspended', async () => {
    const ctx = build();
    ctx.mastra.planV2Turn.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const { events, run } = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
    });
    const tail = events.slice(-3);
    expect(tail[0]).toMatchObject({
      type: 'step',
      id: 'clarify',
      status: 'suspended',
      attempt: 1,
    });
    expect(tail[1]).toEqual({
      type: 'input-required',
      runId: run.id,
      stepId: 'clarify',
      title: 'Clarify',
      question: 'Dominant by what measure?',
      options: ['Matches won', 'Goals scored'],
      expiresAt: expect.any(String) as unknown,
    });
    expect(tail[2]).toMatchObject({ type: 'done', run: { id: run.id } });
    expect(run.status).toBe('suspended');
    expect(run.waitingFor).toEqual({
      stepId: 'clarify',
      title: 'Clarify',
      question: 'Dominant by what measure?',
      options: ['Matches won', 'Goals scored'],
      since: expect.any(String) as unknown,
      expiresAt: (tail[1] as { expiresAt: string }).expiresAt,
    });
    expect(
      Date.parse(run.waitingFor!.expiresAt) - Date.parse(run.waitingFor!.since),
    ).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    // Only the steps that ran: the rest may still run.
    expect(run.steps.map(stepLine)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success#1',
      'clarify:suspended#1',
    ]);
    expect(run.finishedAt).toBeUndefined();
    expect(run.answer).toBeUndefined();
    // Stored as such.
    expect((await ctx.runs.get(run.id)).status).toBe('suspended');
    expect(await ctx.runsRepository.listSuspended()).toEqual([
      expect.objectContaining({ id: run.id }),
    ]);
    // No agent turn ran: Plan asked first.
    expect(ctx.calls['assistant-v2']).toHaveLength(0);
    expect(ctx.discards.count).toBe(0);
  });

  it('resumes the same run with the answer: Clarify goes back to Plan, which plans with it, then the analysis and the answer', async () => {
    const ctx = build();
    ctx.mastra.planV2Turn.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const started = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
    });
    const { events, run } = await resumeOf(ctx, started.run.id, {
      stepId: 'clarify',
      answer: '  Matches won ',
    });
    expect(events[0]).toEqual({
      type: 'run',
      runId: started.run.id,
      workflowId: 'qti-v2-turn',
    });
    const steps = events.filter(
      (e): e is Extract<RunStreamEvent, { type: 'step' }> => e.type === 'step',
    );
    expect(steps.map(stepLine)).toEqual([
      'clarify:running#1',
      'clarify:success#1',
      'plan:running#2',
      'plan:success#2',
      'analyse:running#1',
      'analyse:success#1',
      'validate:running#1',
      'validate:success#1',
      'write-answer:running',
      'write-answer:success',
      'wrap-up:running',
      'wrap-up:success',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'input-required')).toBe(false);
    expect(run.id).toBe(started.run.id);
    expect(run.status).toBe('success');
    expect(run.waitingFor).toBeUndefined();
    expect(run.answer?.content).toBe('Brazil won.');
    expect(run.steps.map(stepLine)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success#1',
      'plan:success#2',
      'clarify:success#1',
      'analyse:success#1',
      'validate:success#1',
      'write-answer:success',
      'wrap-up:success',
    ]);
    // Plan planned again with its question and the trimmed answer.
    expect(ctx.mastra.planV2Turn).toHaveBeenCalledTimes(2);
    expect(ctx.mastra.planV2Turn.mock.calls[1][0]).toMatchObject({
      question: 'Which team was the most dominant?',
      answered: {
        question: 'Dominant by what measure?',
        options: ['Matches won', 'Goals scored'],
        answer: 'Matches won',
      },
    });
    const stored = await ctx.runs.get(run.id);
    expect(stored.status).toBe('success');
    expect(stored.waitingFor).toBeUndefined();
    // The workflow run's snapshot, written while it waited, is dropped.
    expect(ctx.discards.count).toBe(1);
    // Resumed once: a second answer is refused.
    await expect(
      ctx.runs.prepareResume(run.id, { stepId: 'clarify', answer: 'Again' }),
    ).rejects.toThrow(`Run "${run.id}" is not waiting for an answer`);
  });

  it('suspends at Analyse on ask_clarification, and resumes by running the agent again with its question and the answer', async () => {
    const ctx = build();
    const agent = ctx.registry['assistant-v2'];
    const defaultStream = agent.stream.getMockImplementation()!;
    agent.stream.mockImplementationOnce((input, opts) => {
      ctx.calls['assistant-v2'].push({ input, options: opts });
      return Promise.resolve({
        fullStream: streamOf(ASK_CHUNKS),
        text: Promise.resolve(''),
      });
    });
    const started = await runOf(ctx, V2_INPUT);
    expect(started.run.status).toBe('suspended');
    expect(started.run.waitingFor).toMatchObject({
      stepId: 'analyse',
      title: 'Analyse',
      question: 'Which tournament?',
      options: ['2018 — Russia', '2022 — Qatar'],
    });
    expect(started.run.steps.map(stepLine)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success#1',
      'analyse:suspended#1',
    ]);
    // The question stopped the agent's stream, not the run.
    const firstCall = ctx.calls['assistant-v2'][0];
    expect(firstCall.options.abortSignal?.aborted).toBe(true);

    agent.stream.mockImplementation(defaultStream);
    const { events, run } = await resumeOf(ctx, started.run.id, {
      stepId: 'analyse',
      answer: '2022 — Qatar',
    });
    expect(run.status).toBe('success');
    expect(run.answer?.content).toBe('Brazil won.');
    expect(
      events
        .filter((e) => e.type === 'step')
        .map((e) => stepLine(e as { id: string; status: string })),
    ).toEqual([
      'analyse:running#1',
      'analyse:success#1',
      'validate:running#1',
      'validate:success#1',
      'write-answer:running',
      'write-answer:success',
      'wrap-up:running',
      'wrap-up:success',
      'clarify:skipped',
    ]);
    // The agent runs again (no memory thread) with the conversation so far:
    // the question, its clarifying question and the user's answer.
    expect(ctx.calls['assistant-v2']).toHaveLength(2);
    const second = ctx.calls['assistant-v2'][1];
    expect(second.options.memory).toBeUndefined();
    expect(second.input).toEqual([
      { role: 'user', content: 'Who won?' },
      {
        role: 'assistant',
        content: 'Which tournament?\n- 2018 — Russia\n- 2022 — Qatar',
      },
      { role: 'user', content: '2022 — Qatar' },
    ]);
    expect(
      second.options.context.some((block) =>
        block.content.startsWith('Analysis plan for this turn:'),
      ),
    ).toBe(true);
  });

  it('refuses a resume before any frame: 404, 409, 400 answer, 400 step', async () => {
    const ctx = build();
    await expect(
      ctx.runs.prepareResume('nope', { stepId: 'clarify', answer: 'a' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Run "nope" not found',
    });
    const done = await runOf(ctx, V2_INPUT);
    await expect(
      ctx.runs.prepareResume(done.run.id, { stepId: 'clarify', answer: 'a' }),
    ).rejects.toMatchObject({
      status: 409,
      message: `Run "${done.run.id}" is not waiting for an answer`,
    });
    ctx.mastra.planV2Turn.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const waiting = await runOf(ctx, V2_INPUT);
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'clarify',
        answer: ' ',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Answer is required' });
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'analyse',
        answer: 'a',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Step "analyse" is not waiting for an answer',
    });
    // The refusals took nothing: the run still waits.
    const { run } = await resumeOf(ctx, waiting.run.id, {
      stepId: 'clarify',
      answer: 'Matches won',
    });
    expect(run.status).toBe('success');
  });

  it('answers 410 once the run expired: the stored run is stopped with waitingFor expired, its turn dropped', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    try {
      const ctx = build();
      ctx.mastra.planV2Turn.mockResolvedValueOnce({
        plan: ASKING_PLAN,
        stopped: false,
      });
      const waiting = await runOf(ctx, V2_INPUT);
      jest.advanceTimersByTime(30 * 60 * 1000);
      await jest.runAllTimersAsync();
      await expect(
        ctx.runs.prepareResume(waiting.run.id, {
          stepId: 'clarify',
          answer: 'Matches won',
        }),
      ).rejects.toMatchObject({
        status: 410,
        message:
          'This run can no longer continue — run it again with your answer',
      });
      const stored = await ctx.runs.get(waiting.run.id);
      expect(stored.status).toBe('stopped');
      expect(stored.waitingFor).toMatchObject({
        stepId: 'clarify',
        expired: true,
      });
      expect(stored.steps.find((s) => s.id === 'clarify')?.status).toBe(
        'stopped',
      );
      expect(ctx.discards.count).toBe(1);
      // Its host left memory with its memory thread.
      expect(ctx.mastra.deleteMemoryThread).toHaveBeenCalledWith(
        `run-${waiting.run.id}`,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('"Run again with my answer": a run whose context is the expired run plans with its question and clarifying question', async () => {
    const ctx = build();
    ctx.mastra.planV2Turn.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const waiting = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
    });
    // The app restarted: the waiting run can no longer go on.
    await ctx.runs.onModuleInit();
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'clarify',
        answer: 'Matches won',
      }),
    ).rejects.toMatchObject({ status: 410 });
    const prepared = await ctx.runs.prepare(V2_WORKFLOW.id, {
      input: { question: 'Matches won', datasets: ['World Cup'] },
      context: { fromRunId: waiting.run.id },
    });
    expect(prepared.context).toEqual({
      fromRunId: waiting.run.id,
      question: 'Which team was the most dominant?',
      answer: 'Dominant by what measure?\n- Matches won\n- Goals scored',
    });
    const rerun = await ctx.runs.stream(prepared, () => undefined);
    expect(rerun.status).toBe('success');
    // Plan sees the original question, its clarifying question, the answer.
    const planned = ctx.mastra.planV2Turn.mock.calls.at(-1)![0] as {
      messages: unknown;
      question: string;
    };
    expect(planned.question).toBe('Matches won');
    expect(planned.messages).toEqual([
      { role: 'user', content: 'Which team was the most dominant?' },
      {
        role: 'assistant',
        content: 'Dominant by what measure?\n- Matches won\n- Goals scored',
      },
      { role: 'user', content: 'Matches won' },
    ]);
  });

  it('at start-up, a run stored suspended becomes stopped with waitingFor expired, and the leftover snapshots go', async () => {
    const ctx = build();
    ctx.mastra.planV2Turn.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const waiting = await runOf(ctx, V2_INPUT);
    await ctx.runs.onModuleInit();
    const stored = await ctx.runsRepository.get(waiting.run.id);
    expect(stored).toMatchObject({
      status: 'stopped',
      waitingFor: { stepId: 'clarify', expired: true },
      finishedAt: expect.any(String) as unknown,
    });
    expect(ctx.mastra.discardSuspendedWorkflowRuns).toHaveBeenCalledWith(
      'qti-v2-turn',
    );
    expect(ctx.mastra.deleteMemoryThread).toHaveBeenCalledWith(
      `run-${waiting.run.id}`,
    );
  });

  it('a chat session still ends on the question as a clarification card: its workflow run is dropped', async () => {
    const ctx = build();
    ctx.mastra.planV2Turn.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const session = ctx.chat('v2');
    const events = await chatTurn(ctx, session.id, 'Which team?');
    const done = events.at(-1) as { type: string; session?: SessionDoc };
    expect(done.type).toBe('done');
    expect(done.session?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Dominant by what measure?',
      clarification: {
        question: 'Dominant by what measure?',
        options: [{ label: 'Matches won' }, { label: 'Goals scored' }],
      },
    });
    expect(ctx.discards.count).toBe(1);
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
