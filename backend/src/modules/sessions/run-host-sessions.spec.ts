// A run of an agent workflow is one agent turn on a run host, through
// today's turn path (ADR-0041; agents.md 5.14; plan 5.1): these specs run the
// real SessionsService and WorkflowRunsService against stubbed agents, and
// check the run's model request equals a chat turn's for the same input.
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
  // Michael's catalog (Avery's answer_from_data) reads the datasets as the
  // dataset tools do.
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
jest.mock('./workspace-files', () => {
  const actual =
    jest.requireActual<typeof import('./workspace-files')>('./workspace-files');
  return {
    ...actual,
    writeWorkspaceFile: jest.fn(actual.writeWorkspaceFile),
  };
});
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
import { orchestratedMichaelWorkflow } from '../../mastra/workflows/orchestrated-answer-michael.workflow';
import {
  CODE_WORKFLOWS,
  CONVERSATION_WORKFLOWS,
} from '../../mastra/workflows/workflow-catalog';
import { insightsLeadConversationWorkflow } from '../../mastra/workflows/conversation-turn.workflow';
import { resolveAgentModelConfig } from '../../mastra/model-resolver';
import { STEP_MODEL_CONTEXT_KEY } from '../../mastra/step-model';
import { inEvalRun } from '../../mastra/evals/eval-run-scope';
import {
  CONVERSATION_GATES_CONTEXT_KEY,
  INSIGHTS_LEAD_ENGINE_ID,
  INSIGHTS_LEAD_WORKFLOW_ID,
} from '../../mastra/workflows/conversation-turn.steps';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { listSessionWorkspaceIds } from '../../mastra/session-workspaces';
import { writeWorkspaceFile } from './workspace-files';
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
import {
  ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../../mastra/workflows/orchestrated-answer-michael.steps';
import {
  CLARA_AFTER_ACCEPT,
  DASHBOARD_TOOLS_RUNTIME_KEY,
  SOLO_AFTER_ACCEPT,
  type DashboardToolsRuntime,
} from '../../mastra/tools/dashboard.tools';
import type { DashboardDraft } from '../../mastra/workflows/bi-dashboard.schemas';
import type { NewDashboardVersion } from '../artifacts/artifacts.service';
import type {
  DashboardRef,
  DashboardVersionData,
} from '../artifacts/entities/artifact.entity';

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
 * What a turn runs on: Answer a Business Question (Avery + Michael) (`avery`,
 * a run), or the assistant's direct host (`assistant`: the eval runner's,
 * 1.23.35).
 */
type Workflow = 'assistant' | 'avery';

const ORCHESTRATED_SOURCE = CODE_WORKFLOWS.find(
  (w) => w.id === ORCHESTRATED_MICHAEL_WORKFLOW_ID,
)!;

/** The workflow detail the fake catalogue answers for Avery + Michael. */
const ORCHESTRATED_WORKFLOW = {
  id: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  name: ORCHESTRATED_SOURCE.name,
  input: ORCHESTRATED_SOURCE.input,
  agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
  steps: ORCHESTRATED_SOURCE.steps,
  edges: ORCHESTRATED_SOURCE.edges,
  contractHash: ORCHESTRATED_SOURCE.contractHash,
};

const ELENA_SOURCE = CONVERSATION_WORKFLOWS.find(
  (w) => w.id === INSIGHTS_LEAD_WORKFLOW_ID,
)!;

/** The workflow detail the fake catalogue answers for Elena's conversation. */
const ELENA_WORKFLOW = {
  id: INSIGHTS_LEAD_WORKFLOW_ID,
  name: ELENA_SOURCE.name,
  input: ELENA_SOURCE.input,
  agents: [{ key: 'insights-lead', name: 'Elena' }],
  steps: ELENA_SOURCE.steps,
  edges: ELENA_SOURCE.edges,
  contractHash: ELENA_SOURCE.contractHash,
  conversational: true,
};

/** The chat session that takes the same input as each turn. */
const SESSIONS: Record<Workflow, Partial<SessionDoc>> = {
  assistant: { datasets: ['World Cup'] },
  // Michael's session that runs Avery + Michael, as a run host does.
  avery: {
    datasets: ['World Cup'],
    agentKey: 'insights-analyst',
    agentName: 'Insights Analyst',
    workflowId: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  },
};

/** The Avery + Michael run input that asks what the chat message asks. */
const AVERY_INPUT = { question: 'Who won?', datasets: ['World Cup'] };

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
  /** The datasources service's guarded read-only SQL (roadmap 1.28.11). */
  runReadOnlySql?: jest.Mock;
  /**
   * An agent's own scripted stream, by its key: it may call the tools'
   * runtimes on the call's requestContext as the real tools would.
   */
  streams?: Record<
    string,
    (opts: StreamCall['options']) => AsyncIterable<unknown>
  >;
  /** The artifacts service (Clara's dashboards, agents.md 5.22). */
  artifacts?: object;
  /** Avery's conversation exporter (agents.md 3.18). */
  exporter?: object;
}

/** Michael's analysis: one successful query, then his answer. */
const MICHAEL_CHUNKS = [
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
  { type: 'text-delta', payload: { text: 'Brazil won.' } },
];

/**
 * Avery hands the question to Michael through answer_from_data (her tool
 * runs his analysis through the runtime, as the real tool does), then
 * closes with no words of her own: his answer is the run's.
 */
function averyAsksMichael(): (
  opts: StreamCall['options'],
) => AsyncIterable<unknown> {
  return (opts) =>
    (async function* () {
      const tools = opts.requestContext.values.get(
        ORCHESTRATOR_TOOLS_RUNTIME_KEY,
      ) as OrchestratorToolsRuntime;
      yield {
        type: 'tool-call',
        payload: {
          toolCallId: 'm1',
          toolName: 'answer_from_data',
          args: { brief: 'Who won?' },
        },
      };
      const result = await tools.answerFromData('Who won?');
      yield {
        type: 'tool-result',
        payload: {
          toolCallId: 'm1',
          toolName: 'answer_from_data',
          result: { result },
        },
      };
    })();
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
        const scripted = options.streams?.[key];
        if (scripted) {
          return Promise.resolve({
            fullStream: scripted(opts),
            text: Promise.resolve(''),
          });
        }
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
            // Michael's analysis runs one successful query, so it validates.
            options.chunks ??
              (key === 'insights-analyst' ? MICHAEL_CHUNKS : undefined) ?? [
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
    'insights-analyst': agentFor('insights-analyst', 'Insights Analyst'),
    'chief-of-staff': agentFor('chief-of-staff', 'Avery'),
    'bi-analyst': agentFor('bi-analyst', 'Business Intelligence Analyst'),
    // A stand-in for Elena (her own agent is registered in mastra/index.ts).
    'insights-lead': agentFor('insights-lead', 'Insights Lead'),
  };
  // Suspended Avery + Michael runs dropped (their snapshots deleted,
  // ADR-0043).
  const discards = { count: 0 };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: jest.fn(
      (key: string, inputData: unknown, requestContext: unknown) =>
        key === ORCHESTRATED_MICHAEL_WORKFLOW_ID
          ? streamStubWorkflow(
              orchestratedMichaelWorkflow,
              inputData,
              requestContext,
              discards,
            )
          : key === INSIGHTS_LEAD_ENGINE_ID
            ? streamStubWorkflow(
                insightsLeadConversationWorkflow,
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
    deleteSessionWorkspace: jest.fn().mockResolvedValue(undefined),
    // The run's memory threads (agents.md 5.14).
    copyMemoryResource: jest.fn().mockResolvedValue(0),
    copyMemoryThread: jest.fn().mockResolvedValue(false),
    recordAgentExchange: jest.fn().mockResolvedValue(undefined),
  };
  const userAgents = {
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    skillsFor: jest.fn().mockResolvedValue([]),
    datasetNames: jest
      .fn()
      .mockResolvedValue(new Set(DATASETS.map((d) => d.name))),
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
    {
      get: jest.fn().mockResolvedValue({ id: 'ds', name: 'DS' }),
      runReadOnlySql:
        options.runReadOnlySql ??
        jest.fn().mockResolvedValue({ columns: [], rows: [], totalRows: 0 }),
    } as never,
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
    options.artifacts as never,
    options.exporter as never,
  );
  const workflows = {
    definition: jest.fn((id: string) =>
      id === ORCHESTRATED_WORKFLOW.id
        ? Promise.resolve(ORCHESTRATED_WORKFLOW)
        : id === ELENA_WORKFLOW.id
          ? Promise.resolve(ELENA_WORKFLOW)
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
    {} as never,
    // No stored artifact: no workflow here takes one; nothing is saved.
    {
      list: () => Promise.resolve([]),
      isVersionSaved: () => Promise.resolve(null),
    } as never,
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

/** A run of Answer a Business Question (Avery + Michael) on `input`. */
async function runOf(
  ctx: Ctx,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<{ events: RunStreamEvent[]; run: WorkflowRun }> {
  const events: RunStreamEvent[] = [];
  const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
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

describe('an Answer a Business Question (Avery + Michael) run (agents.md 5.23)', () => {
  it("ends success with Avery's closing words as its answer, the one Orchestrate step run by her alone", async () => {
    const ctx = build();
    await ctx.sessions.onModuleInit();
    const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
      input: { question: 'Who won?', datasets: ['World Cup'] },
    });
    const events: RunStreamEvent[] = [];
    const run = await ctx.runs.stream(prepared, (e) => events.push(e));

    expect(run.status).toBe('success');
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'orchestrate:success',
    ]);
    // No team call was made, so her own words are the answer.
    expect(run.answer?.content).toBe('Brazil won.');
    expect(ctx.calls['chief-of-staff']).toHaveLength(1);
    expect(ctx.calls['insights-analyst'] ?? []).toHaveLength(0);
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('a run sends the same model request as a chat turn (plan 1.24.2; agents.md 5.14)', () => {
  it('Avery + Michael: Michael gets the same input, options, system blocks and tools context, and the answer is the same', async () => {
    const ctx = build({ streams: { 'chief-of-staff': averyAsksMichael() } });
    const session = ctx.chat('avery');
    await chatTurn(ctx, session.id, 'Who won?');
    const { run } = await runOf(ctx, AVERY_INPUT);

    const [chatCall, runCall] = ctx.calls['insights-analyst'];
    expect(ctx.calls['insights-analyst']).toHaveLength(2);
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

  // The eval runner's direct host (1.23.35): the assistant has no
  // catalogue workflow, and still runs its turn.
  it("the assistant's agent host: the same request as its chat turn, and the same answer", async () => {
    const ctx = build();
    const session = ctx.chat('assistant');
    await chatTurn(ctx, session.id, 'Who won?');
    const { host, view } = await agentHostTurn(ctx, 'assistant', 'Who won?', {
      datasets: ['World Cup'],
    });

    const [chatCall, hostCall] = ctx.calls['assistant'];
    expect(ctx.calls['assistant']).toHaveLength(2);
    expect(request(hostCall)).toEqual(request(chatCall));
    expect(hostCall.options.requestContext.values.get('session-id')).toBe(
      host.id,
    );
    // Bound as its chat is, on the agent-turn engine, over the same data.
    expect(host).toMatchObject({
      datasets: ['World Cup'],
      workflowId: 'agent:assistant',
      run: true,
    });
    expect(withoutTime(view.messages.at(-1))).toEqual(
      withoutTime(session.messages.at(-1)),
    );
  });
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
    // The assistant is the only built-in agent with a direct host; the
    // removed Data Readiness Agent (`data-readiness`) has none either.
    for (const agentKey of [
      'sql-fixer',
      'insights-analyst',
      'data-readiness',
      'rfp',
      'agent-1',
    ]) {
      await expect(
        ctx.sessions.createRunHost({ runId: 'r', agentKey, name: 'x' }),
      ).rejects.toThrow(`Agent "${agentKey}" not found`);
    }
    expect(ctx.mastra.ensureSessionWorkspace).not.toHaveBeenCalled();
  });

  it('is created per run and discarded after it: never listed, its memory threads and workspace kept', async () => {
    const ctx = build();
    const { run } = await runOf(ctx, AVERY_INPUT);
    const hostId = `run-${run.id}`;
    expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenCalledWith(
      hostId,
      ORCHESTRATED_WORKFLOW.name,
    );
    // The run keeps its agents' threads until it is deleted.
    expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
    expect(ctx.mastra.deleteSessionResources).not.toHaveBeenCalled();
    await expect(ctx.sessions.get(hostId)).rejects.toThrow(
      `Session ${hostId} not found`,
    );
    // Each run gets its own host.
    const second = await runOf(ctx, AVERY_INPUT);
    expect(second.run.id).not.toBe(run.id);
    expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenLastCalledWith(
      `run-${second.run.id}`,
      ORCHESTRATED_WORKFLOW.name,
    );
  });

  it("writes every image file of the run's input to its workspace (workflows R35)", async () => {
    const ctx = build();
    const write = jest.mocked(writeWorkspaceFile);
    write.mockClear();
    write.mockResolvedValue(undefined);
    const one = Buffer.from('one');
    const two = Buffer.from('two');
    await ctx.sessions.createRunHost({
      runId: 'img-1',
      workflowId: ORCHESTRATED_WORKFLOW.id,
      name: ORCHESTRATED_WORKFLOW.name,
      datasets: ['World Cup'],
      inputFiles: [
        { path: 'inputs/images/1.png', data: one },
        { path: 'inputs/images/2.png', data: two },
      ],
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith('run-img-1', 'inputs/images/2.png', two);
    write.mockReset();
  });

  it("deletes an eval host's workspace with it (agents.md 8.3)", async () => {
    const ctx = build();
    const host = await ctx.sessions.createRunHost({
      runId: 'eval-1',
      agentKey: 'assistant',
      name: 'assistant eval',
      datasets: ['World Cup'],
    });
    expect((await ctx.sessions.get(host.id)).datasets).toEqual(['World Cup']);
    await ctx.sessions.deleteRunHostResources(host.id);
    expect(ctx.mastra.deleteSessionResources).toHaveBeenCalledWith(host.id);
    await expect(ctx.sessions.get(host.id)).rejects.toThrow('not found');
  });

  it('sends the earlier run as two messages before this question (plan 5.4)', async () => {
    const ctx = build();
    const first = await runOf(ctx, AVERY_INPUT);
    await runOf(
      ctx,
      { question: 'And in 2014?', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    expect(ctx.calls['chief-of-staff'][1].input).toEqual([
      { role: 'user', content: 'Who won?' },
      { role: 'assistant', content: 'Brazil won.' },
      { role: 'user', content: 'And in 2014?' },
    ]);
  });

  it("an Avery + Michael follow-up copies none of the earlier run's threads: Avery and Michael both read the whole transcript (workflows R45)", async () => {
    const ctx = build({ streams: { 'chief-of-staff': averyAsksMichael() } });
    const first = await runOf(ctx, AVERY_INPUT);
    await runOf(
      ctx,
      { question: 'And in 2014?', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    // Avery holds the conversation; each teammate starts from her brief.
    expect(ctx.mastra.copyMemoryResource).not.toHaveBeenCalled();
    const transcript = [
      { role: 'user', content: 'Who won?' },
      { role: 'assistant', content: 'Brazil won.' },
      { role: 'user', content: 'And in 2014?' },
    ];
    expect(ctx.calls['chief-of-staff'][1].input).toEqual(transcript);
    expect(ctx.calls['insights-analyst'][1].input).toEqual(transcript);
  });

  it('a node chat host sends its transcript before the message and its context block after the agent’s own (agents.md 5.16)', async () => {
    const ctx = build();
    const host = await ctx.sessions.createRunHost({
      runId: 'r-1-node-orchestrate',
      workflowId: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
      name: 'Insights Analyst: Orchestrate',
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
    const call = ctx.calls['insights-analyst'][0];
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
    // The turn is the step's agent alone (agents.md 5.16): no Avery, no
    // catalog block; the context block comes last.
    expect(at).toBe(system.length - 1);
    expect(ctx.calls['chief-of-staff']).toHaveLength(0);
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
      'agent-turn',
      expect.anything(),
      expect.anything(),
    );
  });

  it('a stopped run aborts the agent stream and is stopped', async () => {
    const ctx = build({ holdUntilAbort: true });
    const abort = new AbortController();
    const pending = runOf(ctx, AVERY_INPUT, {}, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const call = ctx.calls['chief-of-staff'][0];
    expect(call.options.abortSignal?.aborted).toBe(false);
    abort.abort();
    const { run, events } = await pending;
    expect(call.options.abortSignal?.aborted).toBe(true);
    expect(run.status).toBe('stopped');
    expect(events.some((e) => e.type === 'done' || e.type === 'error')).toBe(
      false,
    );
    // A stopped run keeps what its agents recorded.
    expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
  });

  /** An Avery + Michael host's turn on `signal`, the turn's model calls recorded. */
  async function averyHostTurn(ctx: Ctx, runId: string, signal?: AbortSignal) {
    const host = await ctx.sessions.createRunHost({
      runId,
      workflowId: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
      name: ORCHESTRATED_WORKFLOW.name,
      datasets: ['World Cup'],
    });
    const suspension = await ctx.sessions.streamRunTurn(
      host.id,
      'Which team was the most dominant?',
      () => undefined,
      signal,
      false,
      () => undefined,
    );
    return { host, suspension };
  }

  /** Every model call of the turn ran on an aborted signal. */
  const allAborted = (ctx: Ctx) =>
    [...ctx.calls['chief-of-staff'], ...ctx.calls['insights-analyst']].every(
      (call) => call.options.abortSignal?.aborted,
    );

  it('a Stop while the turn stores its question aborts the turn at once: no step works on a live signal', async () => {
    const ctx = build();
    const abort = new AbortController();
    const stored = ctx.sessions as unknown as {
      updateDoc: (...args: unknown[]) => Promise<unknown>;
    };
    // The first write (the question) is stopped, then goes on as it was.
    const write = jest
      .spyOn(stored, 'updateDoc')
      .mockImplementationOnce((...args) => {
        abort.abort();
        write.mockRestore();
        return stored.updateDoc(...args);
      });
    await averyHostTurn(ctx, 'stop-write', abort.signal);
    expect(allAborted(ctx)).toBe(true);
  });

  it("a Stop while the turn builds the agent's input aborts the turn at once", async () => {
    const ctx = build();
    const abort = new AbortController();
    const agent = ctx.registry['insights-analyst'];
    agent.getMemory.mockImplementationOnce(() => {
      abort.abort();
      return Promise.resolve({
        getThreadById: jest.fn().mockResolvedValue(null),
      });
    });
    await averyHostTurn(ctx, 'stop-input', abort.signal);
    expect(allAborted(ctx)).toBe(true);
  });

  it('a resume whose signal is aborted before its listener is added aborts the resumed turn at once', async () => {
    const ctx = build();
    averyAsksOnce(ctx);
    const { suspension } = await averyHostTurn(ctx, 'stop-resume');
    expect(suspension?.stepId).toBe('orchestrate');
    const abort = new AbortController();
    abort.abort();
    await suspension!.resume('Matches won', {
      emit: () => undefined,
      abortSignal: abort.signal,
      onStepEvent: () => undefined,
    });
    expect(allAborted(ctx)).toBe(true);
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
    // An Avery + Michael run takes no careful field: its input has none.
    await runOf(ctx, { ...AVERY_INPUT, careful: true });
    expect(crossCheck).not.toHaveBeenCalled();
  });

  it('an Avery + Michael run emits a running and an ended event for its one step, and moves no prompt bar', async () => {
    const ctx = build({ streams: { 'chief-of-staff': averyAsksMichael() } });
    const { events, run } = await runOf(ctx, AVERY_INPUT);
    const steps = events.filter(
      (e): e is Extract<RunStreamEvent, { type: 'step' }> => e.type === 'step',
    );
    expect(steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'orchestrate:running',
      'orchestrate:success',
    ]);
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'orchestrate:success',
    ]);
    // Michael's answer is the run's.
    expect(run.output).toMatchObject({ answer: 'Brazil won.' });
    expect(run.answer?.content).toBe('Brazil won.');
    // A built-in agent's steps are its run's events, never a prompt's bar.
    expect(events.some((e) => e.type === 'workflow')).toBe(false);
  });
});

/** Avery asks the user first (`ask_clarification`, agents.md 5.23). */
const AVERY_ASKS = [
  {
    type: 'tool-call',
    payload: {
      toolCallId: 'a0',
      toolName: 'ask_clarification',
      args: {
        question: 'Dominant by what measure?',
        options: 'Matches won\nGoals scored',
      },
    },
  },
  { type: 'text-delta', payload: { text: 'Never reached.' } },
];

/** Avery's next stream asks the user (AVERY_ASKS); the ones after it answer. */
function averyAsksOnce(ctx: Ctx): void {
  ctx.registry['chief-of-staff'].stream.mockImplementationOnce(
    (input: unknown, opts: StreamCall['options']) => {
      ctx.calls['chief-of-staff'].push({ input, options: opts });
      return Promise.resolve({
        fullStream: streamOf(AVERY_ASKS),
        text: Promise.resolve(''),
      });
    },
  );
}

const stepLine = (s: { id: string; status: string; attempt?: number }) =>
  `${s.id}:${s.status}${s.attempt ? `#${s.attempt}` : ''}`;

describe('an Avery + Michael run that waits for the user (api.md 119, 138; ADR-0043)', () => {
  it('suspends at Orchestrate: the waiting step, input-required, then done with the run suspended', async () => {
    const ctx = build();
    averyAsksOnce(ctx);
    const { events, run } = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
    });
    const tail = events.slice(-3);
    expect(tail[0]).toMatchObject({
      type: 'step',
      id: 'orchestrate',
      status: 'suspended',
    });
    expect(tail[1]).toEqual({
      type: 'input-required',
      runId: run.id,
      stepId: 'orchestrate',
      title: 'Orchestrate',
      question: 'Dominant by what measure?',
      options: ['Matches won', 'Goals scored'],
      expiresAt: expect.any(String) as unknown,
    });
    expect(tail[2]).toMatchObject({ type: 'done', run: { id: run.id } });
    expect(run.status).toBe('suspended');
    expect(run.waitingFor).toEqual({
      stepId: 'orchestrate',
      title: 'Orchestrate',
      question: 'Dominant by what measure?',
      options: ['Matches won', 'Goals scored'],
      since: expect.any(String) as unknown,
      expiresAt: (tail[1] as { expiresAt: string }).expiresAt,
    });
    expect(
      Date.parse(run.waitingFor!.expiresAt) - Date.parse(run.waitingFor!.since),
    ).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(run.steps.map(stepLine)).toEqual(['orchestrate:suspended']);
    expect(run.finishedAt).toBeUndefined();
    expect(run.answer).toBeUndefined();
    // Stored as such.
    expect((await ctx.runs.get(run.id)).status).toBe('suspended');
    expect(await ctx.runsRepository.listSuspended()).toEqual([
      expect.objectContaining({ id: run.id }),
    ]);
    // Michael never ran: Avery asked first.
    expect(ctx.calls['insights-analyst']).toHaveLength(0);
    expect(ctx.discards.count).toBe(0);
  });

  it('resumes the same run with the answer: Avery goes on with her question and the trimmed answer', async () => {
    const ctx = build();
    averyAsksOnce(ctx);
    const started = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
    });
    const { events, run } = await resumeOf(ctx, started.run.id, {
      stepId: 'orchestrate',
      answer: '  Matches won ',
    });
    expect(events[0]).toEqual({
      type: 'run',
      runId: started.run.id,
      workflowId: 'orchestrated-answer-michael',
    });
    const steps = events.filter(
      (e): e is Extract<RunStreamEvent, { type: 'step' }> => e.type === 'step',
    );
    expect(steps.map(stepLine)).toEqual([
      'orchestrate:running',
      'orchestrate:success',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'input-required')).toBe(false);
    expect(run.id).toBe(started.run.id);
    expect(run.status).toBe('success');
    expect(run.waitingFor).toBeUndefined();
    expect(run.answer?.content).toBe('Brazil won.');
    expect(run.steps.map(stepLine)).toEqual(['orchestrate:success']);
    // Avery ran again with the question, her question and the answer.
    expect(ctx.calls['chief-of-staff']).toHaveLength(2);
    expect(ctx.calls['chief-of-staff'][1].input).toEqual([
      { role: 'user', content: 'Which team was the most dominant?' },
      {
        role: 'assistant',
        content: 'Dominant by what measure?\n- Matches won\n- Goals scored',
      },
      { role: 'user', content: 'Matches won' },
    ]);
    const stored = await ctx.runs.get(run.id);
    expect(stored.status).toBe('success');
    expect(stored.waitingFor).toBeUndefined();
    // The workflow run's snapshot, written while it waited, is dropped.
    expect(ctx.discards.count).toBe(1);
    // Resumed once: a second answer is refused.
    await expect(
      ctx.runs.prepareResume(run.id, {
        stepId: 'orchestrate',
        answer: 'Again',
      }),
    ).rejects.toThrow(`Run "${run.id}" is not waiting for an answer`);
  });

  it('refuses a resume before any frame: 404, 409, 400 answer, 400 step', async () => {
    const ctx = build();
    await expect(
      ctx.runs.prepareResume('nope', { stepId: 'orchestrate', answer: 'a' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Run "nope" not found',
    });
    const done = await runOf(ctx, AVERY_INPUT);
    await expect(
      ctx.runs.prepareResume(done.run.id, {
        stepId: 'orchestrate',
        answer: 'a',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: `Run "${done.run.id}" is not waiting for an answer`,
    });
    averyAsksOnce(ctx);
    const waiting = await runOf(ctx, AVERY_INPUT);
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'orchestrate',
        answer: ' ',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Answer is required' });
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'plan',
        answer: 'a',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Step "plan" is not waiting for an answer',
    });
    // The refusals took nothing: the run still waits.
    const { run } = await resumeOf(ctx, waiting.run.id, {
      stepId: 'orchestrate',
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
      averyAsksOnce(ctx);
      const waiting = await runOf(ctx, AVERY_INPUT);
      jest.advanceTimersByTime(30 * 60 * 1000);
      await jest.runAllTimersAsync();
      await expect(
        ctx.runs.prepareResume(waiting.run.id, {
          stepId: 'orchestrate',
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
        stepId: 'orchestrate',
        expired: true,
      });
      expect(stored.steps.find((s) => s.id === 'orchestrate')?.status).toBe(
        'stopped',
      );
      expect(ctx.discards.count).toBe(1);
      // Its host left memory; its memory threads stay with the run.
      expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers 410 to a run stored under another contract (its contract changed): stopped with waitingFor expired, its turn dropped', async () => {
    const ctx = build();
    averyAsksOnce(ctx);
    const waiting = await runOf(ctx, AVERY_INPUT);
    await ctx.runsRepository.update(waiting.run.id, {
      contractHash: 'before-1278',
    });
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'orchestrate',
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
      stepId: 'orchestrate',
      expired: true,
    });
    expect(ctx.discards.count).toBe(1);
  });

  it('"Run again with my answer": a run whose context is the expired run gives Avery its question and clarifying question', async () => {
    const ctx = build();
    averyAsksOnce(ctx);
    const waiting = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
    });
    // The app restarted: the waiting run can no longer go on.
    await ctx.runs.onModuleInit();
    await expect(
      ctx.runs.prepareResume(waiting.run.id, {
        stepId: 'orchestrate',
        answer: 'Matches won',
      }),
    ).rejects.toMatchObject({ status: 410 });
    const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
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
    // Avery sees the original question, its clarifying question, the answer.
    expect(ctx.calls['chief-of-staff'].at(-1)?.input).toEqual([
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
    averyAsksOnce(ctx);
    const waiting = await runOf(ctx, AVERY_INPUT);
    await ctx.runs.onModuleInit();
    const stored = await ctx.runsRepository.get(waiting.run.id);
    expect(stored).toMatchObject({
      status: 'stopped',
      waitingFor: { stepId: 'orchestrate', expired: true },
      finishedAt: expect.any(String) as unknown,
    });
    // No key: every registered workflow's leftover snapshots are deleted.
    expect(ctx.mastra.discardSuspendedWorkflowRuns).toHaveBeenCalledWith();
    // The run keeps its memory threads, as any finished run does.
    expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
  });

  it('a chat session still ends on the question as a clarification card: its workflow run is dropped', async () => {
    const ctx = build();
    averyAsksOnce(ctx);
    const session = ctx.chat('avery');
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

/** Clara's dashboard of goals by team, bound to her data query's columns. */
const GOALS_DRAFT: DashboardDraft = {
  title: 'Goals by team',
  summary: 'Goals per team.',
  theme: { mode: 'light', accent: '#2563eb', palette: ['#2563eb', '#16a34a'] },
  layout: 'A KPI, then goals by team.',
  filters: [{ id: 'team', label: 'Team', kind: 'select', column: 'team' }],
  widgets: [
    {
      id: 'goals',
      title: 'Goals',
      kind: 'kpi',
      span: 4,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
        },
      ],
      dimension: '',
      description: 'All goals.',
      filteredBy: ['team'],
    },
    {
      id: 'by-team',
      title: 'Goals by team',
      kind: 'bar',
      span: 8,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
        },
      ],
      dimension: 'team',
      description: 'Goals per team.',
      filteredBy: ['team'],
    },
  ],
  columns: [
    { name: 'team', type: 'string', description: 'The team.' },
    { name: 'goals', type: 'number', description: 'Goals scored.' },
  ],
};
const GOALS_SQL =
  'SELECT team, sum(goals) AS goals FROM wc.public.goals GROUP BY team';
const GOALS_BRIEF = 'A dashboard of goals by team, filterable by team.';

/** The artifacts service, as Clara's saves reach it (plan bi-dashboard 2.5). */
function dashboardArtifacts() {
  const versions: (NewDashboardVersion & { version: number })[] = [];
  const refOf = (
    input: NewDashboardVersion,
    version: number,
    action: DashboardRef['action'],
  ): DashboardRef => ({
    artifactId: 'a-1',
    version,
    title: input.blueprint.title,
    action,
    widgetCount: input.blueprint.widgets.length,
    filterCount: input.blueprint.filters.length,
    rowCount: input.rows.length,
    saved: false,
  });
  return {
    versions,
    createDashboard: jest.fn((input: NewDashboardVersion) => {
      versions.push({ ...input, version: 1 });
      return Promise.resolve(refOf(input, 1, 'created'));
    }),
    addDashboardVersion: jest.fn((_id: string, input: NewDashboardVersion) => {
      const version = versions.length + 1;
      versions.push({ ...input, version });
      return Promise.resolve(refOf(input, version, 'updated'));
    }),
    dashboardVersion: jest.fn((id: string): Promise<DashboardVersionData> => {
      const last = versions.at(-1);
      if (id !== 'a-1' || !last) {
        return Promise.reject(new Error(`Artifact "${id}" not found`));
      }
      return Promise.resolve({
        artifactId: id,
        version: last.version,
        title: last.blueprint.title,
        name: last.blueprint.title,
        blueprint: last.blueprint,
        query: last.query,
        columns: last.columns,
        rowCount: last.rows.length,
        widgetCount: last.blueprint.widgets.length,
        filterCount: last.blueprint.filters.length,
        createdAt: '2026-11-22T10:00:00.000Z',
        rows: last.rows,
      });
    }),
  };
}

/**
 * Avery calls build_dashboard with `brief` (her tool runs Clara through the
 * runtime, as the real tool does), then closes with `closing`; `told` gets
 * what the tool answered her.
 */
function averyBuilds(
  brief: string,
  closing: string,
  told: string[],
): (opts: StreamCall['options']) => AsyncIterable<unknown> {
  return (opts) =>
    (async function* () {
      const tools = opts.requestContext.values.get(
        ORCHESTRATOR_TOOLS_RUNTIME_KEY,
      ) as OrchestratorToolsRuntime;
      yield {
        type: 'tool-call',
        payload: {
          toolCallId: 'b1',
          toolName: 'build_dashboard',
          args: { brief },
        },
      };
      const result = await tools.buildDashboard(brief);
      told.push(result);
      yield {
        type: 'tool-result',
        payload: {
          toolCallId: 'b1',
          toolName: 'build_dashboard',
          result: { result },
        },
      };
      yield { type: 'text-delta', payload: { text: closing } };
    })();
}

/**
 * Clara submits `draft` with `sql` (her submit_dashboard runs through the
 * runtime, as the real tool does), then replies to Avery; `outcomes` gets
 * what the host answered, and `afterSubmit` runs once it has.
 */
function claraSubmits(
  outcomes: unknown[],
  draft: DashboardDraft = GOALS_DRAFT,
  sql: string = GOALS_SQL,
  afterSubmit?: () => void,
  runtimes?: DashboardToolsRuntime[],
): (opts: StreamCall['options']) => AsyncIterable<unknown> {
  return (opts) =>
    (async function* () {
      const runtime = opts.requestContext.values.get(
        DASHBOARD_TOOLS_RUNTIME_KEY,
      ) as DashboardToolsRuntime;
      runtimes?.push(runtime);
      const args = { dashboard: draft, sql, rationale: 'Goals per team.' };
      yield {
        type: 'tool-call',
        payload: { toolCallId: 's1', toolName: 'submit_dashboard', args },
      };
      const outcome = await runtime.submit({ ...args, datasourceId: 'ds-pg' });
      outcomes.push(outcome);
      afterSubmit?.();
      yield {
        type: 'tool-result',
        payload: {
          toolCallId: 's1',
          toolName: 'submit_dashboard',
          result: outcome.accepted
            ? { result: 'Accepted.' }
            : { error: outcome.error },
        },
      };
      yield {
        type: 'text-delta',
        payload: { text: 'I built goals by team with a team filter.' },
      };
    })();
}

/** The goals query's rows, numbers as Postgres sends a sum (text). */
const goalsRows = () =>
  jest.fn().mockResolvedValue({
    columns: ['team', 'goals'],
    rows: [
      { team: 'Brazil', goals: '12' },
      { team: 'Germany', goals: '9' },
    ],
    totalRows: 2,
  });

/** A run event as `<type>:<tool name>`, for the activity's order. */
function activityOf(events: RunStreamEvent[]): string[] {
  return events
    .filter((e) => e.type === 'tool' || e.type === 'tool-result')
    .map((e) => {
      const body = JSON.parse((e as { content: string }).content) as {
        name?: string;
        tool?: string;
      };
      return `${e.type}:${body.name ?? body.tool}`;
    });
}

describe("Clara builds Avery's dashboards (agents.md 2.22, 5.22)", () => {
  it("hands Clara's submit_dashboard her old line after an accepted dashboard", async () => {
    const runtimes: DashboardToolsRuntime[] = [];
    const ctx = build({
      artifacts: dashboardArtifacts(),
      runReadOnlySql: goalsRows(),
      streams: {
        'chief-of-staff': averyBuilds(
          GOALS_BRIEF,
          'Your dashboard is ready.',
          [],
        ),
        'bi-analyst': claraSubmits(
          [],
          GOALS_DRAFT,
          GOALS_SQL,
          undefined,
          runtimes,
        ),
      },
    });
    await ctx.sessions.onModuleInit();
    const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
      input: {
        question: 'Create a dashboard of goals by team',
        datasets: ['World Cup'],
      },
    });
    await ctx.runs.stream(prepared, () => undefined);
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0].afterAccept).toBe(CLARA_AFTER_ACCEPT);
  });

  it('runs her data query with 5,000 rows, saves the dashboard on its rows and carries it on the answer, with her query as a source', async () => {
    const artifacts = dashboardArtifacts();
    const runReadOnlySql = goalsRows();
    const told: string[] = [];
    const outcomes: unknown[] = [];
    const ctx = build({
      artifacts,
      runReadOnlySql,
      streams: {
        'chief-of-staff': averyBuilds(
          GOALS_BRIEF,
          'Your dashboard is ready.',
          told,
        ),
        'bi-analyst': claraSubmits(outcomes),
      },
    });
    await ctx.sessions.onModuleInit();
    const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
      input: {
        question: 'Create a dashboard of goals by team',
        datasets: ['World Cup'],
      },
    });
    const events: RunStreamEvent[] = [];
    const run = await ctx.runs.stream(prepared, (e) => events.push(e));

    expect(run.status).toBe('success');
    // The host ran her query itself, past the 500-row clamp, with the stop.
    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-pg',
      GOALS_SQL,
      5000,
      5000,
      { signal: expect.any(AbortSignal) as unknown },
    );
    expect(outcomes).toEqual([
      { accepted: true, rowCount: 2, columns: ['team', 'goals'] },
    ]);
    expect(artifacts.createDashboard).toHaveBeenCalledTimes(1);
    const [saved] = artifacts.versions;
    expect(saved).toMatchObject({
      query: {
        sql: GOALS_SQL,
        datasourceId: 'ds-pg',
        rationale: 'Goals per team.',
      },
      columns: ['team', 'goals'],
      rows: [
        { team: 'Brazil', goals: 12 },
        { team: 'Germany', goals: 9 },
      ],
      instruction: GOALS_BRIEF,
      source: { runId: run.id, workflowId: ORCHESTRATED_MICHAEL_WORKFLOW_ID },
    });
    expect(saved.blueprint.widgets.map((w) => w.id)).toEqual([
      'goals',
      'by-team',
    ]);
    // The answer: Avery's words (never Clara's) and the dashboard's card.
    expect(run.answer?.content).toBe('Your dashboard is ready.');
    expect(run.answer?.dashboard).toEqual({
      artifactId: 'a-1',
      version: 1,
      title: 'Goals by team',
      action: 'created',
      widgetCount: 2,
      filterCount: 1,
      rowCount: 2,
      // A draft: the user saves it to Artifacts from the panel.
      saved: false,
    });
    expect(told[0]).toContain(
      'Built dashboard "Goals by team", version 1 (created): 2 widgets, 1 filters, 2 rows.',
    );
    // Her query is one of the answer's sources: the inspector opens it.
    expect(run.answer?.data).toEqual([
      expect.objectContaining({
        tool: 'run_readonly_sql',
        input: GOALS_SQL,
        rowCount: 2,
        rationale: 'Goals per team.',
      }),
    ]);
    expect(run.answer?.evidence).toEqual([
      expect.objectContaining({
        index: 0,
        datasourceId: 'ds-pg',
        rowLimit: 5000,
        totalRows: 2,
      }),
    ]);
    // Her calls come between Avery's call and its result; the host's
    // query follows her submit's result, so each call pairs.
    expect(activityOf(events)).toEqual([
      'tool:build_dashboard',
      'tool:submit_dashboard',
      'tool-result:submit_dashboard',
      'tool:run_readonly_sql',
      'tool-result:run_readonly_sql',
      'tool-result:build_dashboard',
    ]);
    // Clara: no memory, her brief and the catalog, the gate's fact for Avery.
    const [clara] = ctx.calls['bi-analyst'];
    expect(clara.options.memory).toBeUndefined();
    expect(clara.input).toEqual([
      { role: 'user', content: 'Create a dashboard of goals by team' },
    ]);
    expect(
      clara.options.context.some((block) =>
        block.content.startsWith(
          `Brief from Avery, the Chief of Staff: ${GOALS_BRIEF}`,
        ),
      ),
    ).toBe(true);
    const [avery] = ctx.calls['chief-of-staff'];
    expect(avery.options.context[0].content).toContain(
      'The user asked for a dashboard: build_dashboard is available.',
    );
  });

  it('refuses a query that the 5,000-row cap cut, and a draft bound to a column it does not return; nothing is saved', async () => {
    const artifacts = dashboardArtifacts();
    const told: string[] = [];
    const outcomes: unknown[] = [];
    const ctx = build({
      artifacts,
      runReadOnlySql: jest.fn().mockResolvedValue({
        columns: ['team', 'goals'],
        rows: Array.from({ length: 5000 }, (_, n) => ({
          team: `T${n}`,
          goals: n,
        })),
        totalRows: 7000,
      }),
      streams: {
        'chief-of-staff': averyBuilds(GOALS_BRIEF, 'No dashboard.', told),
        'bi-analyst': claraSubmits(outcomes),
      },
    });
    await ctx.sessions.onModuleInit();
    const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
      input: { question: 'A dashboard of goals', datasets: ['World Cup'] },
    });
    const run = await ctx.runs.stream(prepared, () => undefined);
    expect(outcomes).toEqual([
      {
        accepted: false,
        error:
          'More than 5,000 rows: group the query to the grain the widgets need',
      },
    ]);
    expect(artifacts.createDashboard).not.toHaveBeenCalled();
    expect(run.answer?.dashboard).toBeUndefined();
    expect(told[0]).toMatch(/^Clara built no dashboard: /);

    const unbound = build({
      artifacts,
      runReadOnlySql: goalsRows(),
      streams: {
        'chief-of-staff': averyBuilds(GOALS_BRIEF, 'No dashboard.', told),
        'bi-analyst': claraSubmits(outcomes, {
          ...GOALS_DRAFT,
          filters: [
            { id: 'stage', label: 'Stage', kind: 'select', column: 'stage' },
          ],
        }),
      },
    });
    await unbound.sessions.onModuleInit();
    const again = await unbound.runs.stream(
      await unbound.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: { question: 'A dashboard of goals', datasets: ['World Cup'] },
      }),
      () => undefined,
    );
    expect(outcomes[1]).toMatchObject({ accepted: false });
    expect((outcomes[1] as { error: string }).error).toContain('stage');
    expect(artifacts.createDashboard).not.toHaveBeenCalled();
    expect(again.answer?.dashboard).toBeUndefined();
  });

  it('saves nothing when the run is stopped while Clara works', async () => {
    const artifacts = dashboardArtifacts();
    const abort = new AbortController();
    const outcomes: unknown[] = [];
    const ctx = build({
      artifacts,
      runReadOnlySql: goalsRows(),
      streams: {
        'chief-of-staff': averyBuilds(GOALS_BRIEF, 'Ready.', []),
        'bi-analyst': claraSubmits(outcomes, GOALS_DRAFT, GOALS_SQL, () =>
          abort.abort(),
        ),
      },
    });
    await ctx.sessions.onModuleInit();
    const prepared = await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
      input: { question: 'A dashboard of goals', datasets: ['World Cup'] },
    });
    const run = await ctx.runs.stream(prepared, () => undefined, abort.signal);
    // Accepted, then stopped before the save.
    expect(outcomes).toEqual([expect.objectContaining({ accepted: true })]);
    expect(run.status).toBe('stopped');
    expect(artifacts.createDashboard).not.toHaveBeenCalled();
    expect(artifacts.addDashboardVersion).not.toHaveBeenCalled();
    expect(run.answer?.dashboard).toBeUndefined();
  });

  it("a follow-up changes the conversation's dashboard into its next version, whatever it says", async () => {
    const artifacts = dashboardArtifacts();
    const ctx = build({
      artifacts,
      runReadOnlySql: goalsRows(),
      streams: {
        'chief-of-staff': averyBuilds(GOALS_BRIEF, 'Ready.', []),
        'bi-analyst': claraSubmits([]),
      },
    });
    await ctx.sessions.onModuleInit();
    const first = await ctx.runs.stream(
      await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: {
          question: 'Create a dashboard of goals by team',
          datasets: ['World Cup'],
        },
      }),
      () => undefined,
    );
    expect(first.answer?.dashboard).toMatchObject({ version: 1 });

    const second = await ctx.runs.stream(
      await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: { question: 'add a filter by team', datasets: ['World Cup'] },
        context: { fromRunId: first.id },
      }),
      () => undefined,
    );
    expect(artifacts.dashboardVersion).toHaveBeenCalledWith('a-1');
    expect(artifacts.addDashboardVersion).toHaveBeenCalledWith(
      'a-1',
      expect.objectContaining({ instruction: GOALS_BRIEF }),
    );
    expect(second.answer?.dashboard).toMatchObject({
      artifactId: 'a-1',
      version: 2,
      action: 'updated',
    });
    // Avery reads the conversation's dashboard; Clara gets it to change.
    const avery = ctx.calls['chief-of-staff'].at(-1)!;
    expect(avery.options.context[0].content).toContain(
      'The conversation has a dashboard: "Goals by team", version 1 (2 widgets, 1 filters). build_dashboard changes it into version 2.',
    );
    const clara = ctx.calls['bi-analyst'].at(-1)!;
    const brief = clara.options.context.find((block) =>
      block.content.startsWith('Brief from Avery'),
    );
    expect(brief?.content).toContain(
      'The current dashboard: "Goals by team", version 1.',
    );
    expect(brief?.content).toContain(
      `Its data query (datasource ds-pg): ${GOALS_SQL}`,
    );
  });

  it('carries nothing when the artifact is gone: the gate reads the message alone', async () => {
    const artifacts = dashboardArtifacts();
    const ctx = build({
      artifacts,
      runReadOnlySql: goalsRows(),
      streams: {
        'chief-of-staff': averyBuilds(GOALS_BRIEF, 'Ready.', []),
        'bi-analyst': claraSubmits([]),
      },
    });
    await ctx.sessions.onModuleInit();
    const first = await ctx.runs.stream(
      await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: {
          question: 'Create a dashboard of goals by team',
          datasets: ['World Cup'],
        },
      }),
      () => undefined,
    );
    artifacts.dashboardVersion.mockRejectedValueOnce(
      new Error('Artifact "a-1" not found'),
    );
    // Avery answers in words this time: no dashboard tool call.
    ctx.registry['chief-of-staff'].stream.mockImplementationOnce(
      (input: unknown, opts: StreamCall['options']) => {
        ctx.calls['chief-of-staff'].push({ input, options: opts });
        return Promise.resolve({
          fullStream: streamOf([
            { type: 'text-delta', payload: { text: 'Brazil.' } },
          ]),
          text: Promise.resolve(''),
        });
      },
    );
    const second = await ctx.runs.stream(
      await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: { question: 'Who scored most?', datasets: ['World Cup'] },
        context: { fromRunId: first.id },
      }),
      () => undefined,
    );
    expect(second.status).toBe('success');
    const avery = ctx.calls['chief-of-staff'].at(-1)!;
    expect(avery.options.context[0].content).not.toContain('dashboard');
    const tools = avery.options.requestContext.values.get(
      ORCHESTRATOR_TOOLS_RUNTIME_KEY,
    ) as OrchestratorToolsRuntime;
    expect(tools.buildsDashboard).toBe(false);
    expect(second.answer?.dashboard).toBeUndefined();
  });
});

describe('Avery exports the conversation (agents.md 3.18; workflows R45)', () => {
  const EXPORT = {
    id: 'x-1',
    title: 'Who won the World Cup',
    createdAt: '2026-11-23T10:00:00.000Z',
    files: [{ format: 'pdf', fileName: 'w.pdf', bytes: 3, pages: 4 }],
  };

  /** Avery: on an export request she calls export_conversation, else answers. */
  function averyExports(told: string[]) {
    return (opts: StreamCall['options']) =>
      (async function* () {
        const tools = opts.requestContext.values.get(
          ORCHESTRATOR_TOOLS_RUNTIME_KEY,
        ) as OrchestratorToolsRuntime;
        if (tools.exportsConversation) {
          const result = await tools.exportConversation({
            formats: ['pdf'],
            title: 'Who won the World Cup',
            summary: ['Brazil won.', 'The answer named the winner.'],
            turns: [{ number: 1, headline: 'Brazil won', points: [] }],
            includeSql: false,
          });
          told.push(result);
        }
        yield { type: 'text-delta', payload: { text: 'Done.' } };
      })();
  }

  it('opens on the request, reads the earlier turns, exports them and carries the export on the answer', async () => {
    const exporter = {
      turns: jest.fn().mockResolvedValue({
        questions: ['Who won?'],
        answers: ['Brazil won.'],
      }),
      export: jest.fn().mockResolvedValue(EXPORT),
    };
    const told: string[] = [];
    const ctx = build({
      exporter,
      streams: { 'chief-of-staff': averyExports(told) },
    });
    await ctx.sessions.onModuleInit();
    const first = await ctx.runs.stream(
      await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: { question: 'Who won?', datasets: ['World Cup'] },
      }),
      () => undefined,
    );
    // A question that is no export: no export line, no call to the exporter.
    expect(
      ctx.calls['chief-of-staff'][0].options.context[0].content,
    ).not.toContain('export');
    expect(exporter.turns).not.toHaveBeenCalled();
    expect(first.answer?.export).toBeUndefined();

    const second = await ctx.runs.stream(
      await ctx.runs.prepare(ORCHESTRATED_WORKFLOW.id, {
        input: {
          question: 'Export this conversation to PDF',
          datasets: ['World Cup'],
        },
        context: { fromRunId: first.id },
      }),
      () => undefined,
    );
    expect(second.status).toBe('success');
    expect(exporter.turns).toHaveBeenCalledWith(first.id, second.id);
    const avery = ctx.calls['chief-of-staff'].at(-1)!;
    expect(avery.options.context[0].content).toContain(
      'The user asked to export the conversation: export_conversation is available. Its earlier questions, in order: 1. "Who won?"',
    );
    expect(exporter.export).toHaveBeenCalledWith({
      conversationId: first.id,
      beforeRunId: second.id,
      content: expect.objectContaining({
        title: 'Who won the World Cup',
      }) as unknown,
      brand: 'halo',
      // The cover's author: Avery, with her team (plan Elena 1.3).
      author: { name: 'Avery', role: 'Chief of Staff', team: true },
    });
    expect(told).toEqual([
      'Exported "Who won the World Cup": PDF (4 pages). The user sees the download card with the answer: do not repeat the summary.',
    ]);
    expect(second.answer?.export).toEqual(EXPORT);
    expect(second.answer?.content).toBe('Done.');
  });
});

/** Elena answers with one successful query (as Michael's analysis does). */
const elenaAnswers = () => () => streamOf(MICHAEL_CHUNKS);

/** Start a run of Elena's conversation (api.md 119). */
async function elenaRunOf(
  ctx: Ctx,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<{ events: RunStreamEvent[]; run: WorkflowRun }> {
  const events: RunStreamEvent[] = [];
  const prepared = await ctx.runs.prepare(INSIGHTS_LEAD_WORKFLOW_ID, {
    input,
    ...extra,
  });
  const run = await ctx.runs.stream(prepared, (e) => events.push(e));
  return { events, run };
}

describe("Elena's conversation on the run host (plan Elena 1.3, 2.4)", () => {
  it('runs her on her own engine: one Answer step, her host bound to her, her budget and no memory thread', async () => {
    const ctx = build({ streams: { 'insights-lead': elenaAnswers() } });
    const { run } = await elenaRunOf(ctx, AVERY_INPUT);
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
      INSIGHTS_LEAD_ENGINE_ID,
      expect.anything(),
      expect.anything(),
    );
    expect(run.status).toBe('success');
    expect(run.workflowId).toBe(INSIGHTS_LEAD_WORKFLOW_ID);
    expect(run.conversationId).toBe(run.id);
    expect(run.steps.map(stepLine)).toEqual(['answer:success']);
    expect(run.steps[0].output).toEqual({ answer: 'Brazil won.', attempts: 1 });
    expect(run.answer?.content).toBe('Brazil won.');
    // Every check passed, and they are stored on the answer.
    expect(run.answer?.checks?.length).toBeGreaterThan(0);
    expect(run.answer?.checks?.every((check) => check.passed)).toBe(true);
    // Only Elena ran: no team.
    expect(ctx.calls['insights-lead']).toHaveLength(1);
    expect(ctx.calls['chief-of-staff']).toHaveLength(0);
    expect(ctx.calls['insights-analyst']).toHaveLength(0);
    const call = ctx.calls['insights-lead'][0].options;
    expect(call.maxSteps).toBe(24);
    expect(call.memory).toBeUndefined();
    expect(
      call.requestContext.values.get(CONVERSATION_GATES_CONTEXT_KEY),
    ).toEqual({ dashboard: false, export: false });
    expect(call.requestContext.values.has(DASHBOARD_TOOLS_RUNTIME_KEY)).toBe(
      false,
    );
  });

  it('runs exactly one repair round when a check fails, the findings in her request, and stores the last checks', async () => {
    // A figure with no query behind it: `Ran a query` fails twice.
    const ctx = build({
      streams: {
        'insights-lead': () =>
          (async function* () {
            yield await Promise.resolve({
              type: 'text-delta',
              payload: { text: 'Brazil won 5 titles.' },
            });
          })(),
      },
    });
    const { run } = await elenaRunOf(ctx, AVERY_INPUT);
    expect(ctx.calls['insights-lead']).toHaveLength(2);
    const repair = ctx.calls['insights-lead'][1].options.context
      .map((block) => block.content)
      .join('\n');
    expect(repair).toContain(
      'Checks on your answer failed:\n- Ran a query: No SQL query ran.',
    );
    expect(ctx.calls['insights-lead'][1].options.maxSteps).toBe(8);
    expect(run.steps[0].output).toMatchObject({ attempts: 2 });
    expect(
      run.answer?.checks?.find((check) => check.check === 'Ran a query'),
    ).toMatchObject({ passed: false });
  });

  it("builds the conversation's dashboard when asked: her submit_dashboard, saved once, carried on the answer", async () => {
    const artifacts = dashboardArtifacts();
    const outcomes: unknown[] = [];
    const runtimes: DashboardToolsRuntime[] = [];
    const ctx = build({
      artifacts,
      runReadOnlySql: goalsRows(),
      streams: {
        'insights-lead': claraSubmits(
          outcomes,
          GOALS_DRAFT,
          GOALS_SQL,
          undefined,
          runtimes,
        ),
      },
    });
    await ctx.sessions.onModuleInit();
    const { run } = await elenaRunOf(ctx, {
      question: 'Create a dashboard of goals by team',
      datasets: ['World Cup'],
    });
    expect(outcomes).toEqual([
      expect.objectContaining({ accepted: true }) as unknown,
    ]);
    expect(runtimes[0].afterAccept).toBe(SOLO_AFTER_ACCEPT);
    expect(
      ctx.calls['insights-lead'][0].options.requestContext.values.get(
        CONVERSATION_GATES_CONTEXT_KEY,
      ),
    ).toEqual({ dashboard: true, export: false });
    // Her dashboard query counts as hers: the checks pass, no repair.
    expect(ctx.calls['insights-lead']).toHaveLength(1);
    expect(artifacts.createDashboard).toHaveBeenCalledTimes(1);
    expect(artifacts.createDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: 'Create a dashboard of goals by team',
      }),
    );
    expect(run.answer?.dashboard).toMatchObject({
      artifactId: 'a-1',
      version: 1,
    });
  });

  it('runs her on Opus 5.5 high when the saved model is a Claude model, but never in an eval (plan Elena 2.5)', async () => {
    const config = jest.mocked(resolveAgentModelConfig);
    config.mockResolvedValue('anthropic/claude-sonnet-4-6');
    try {
      const ctx = build({ streams: { 'insights-lead': elenaAnswers() } });
      await elenaRunOf(ctx, AVERY_INPUT);
      expect(
        ctx.calls['insights-lead'][0].options.requestContext.values.get(
          STEP_MODEL_CONTEXT_KEY,
        ),
      ).toEqual({ model: 'claude-opus-5-5', reasoningEffort: 'high' });
      const evalCtx = build({ streams: { 'insights-lead': elenaAnswers() } });
      await inEvalRun('eval-1', () => elenaRunOf(evalCtx, AVERY_INPUT));
      expect(
        evalCtx.calls['insights-lead'][0].options.requestContext.values.has(
          STEP_MODEL_CONTEXT_KEY,
        ),
      ).toBe(false);
    } finally {
      config.mockResolvedValue('openai/gpt-4.1-mini');
    }
  });

  it('joins a follow-up to the conversation: same conversationId, the earlier turn in her transcript', async () => {
    const ctx = build({ streams: { 'insights-lead': elenaAnswers() } });
    const first = await elenaRunOf(ctx, AVERY_INPUT);
    const second = await elenaRunOf(
      ctx,
      { question: 'And in 2002?', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    expect(second.run.conversationId).toBe(first.run.id);
    expect(ctx.calls['insights-lead'][1].input).toEqual([
      { role: 'user', content: 'Who won?' },
      { role: 'assistant', content: 'Brazil won.' },
      { role: 'user', content: 'And in 2002?' },
    ]);
  });
});

/** A user agent's saved draft, as Try it runs it (agents-evals R60). */
const DRAFT_CONFIG = {
  name: 'Sales helper',
  role: 'Analyst',
  description: 'Answers sales questions.',
  instructions: 'Answer in euros.',
  datasets: ['World Cup'],
  starterQuestions: [],
};

/** `agent-1` answers with its draft (`patch` over `DRAFT_CONFIG`). */
function withDraft(ctx: Ctx, patch: Record<string, unknown> = {}) {
  ctx.userAgents.get.mockImplementation((id: string) =>
    Promise.resolve(
      id === 'agent-1'
        ? { id, draft: { ...DRAFT_CONFIG, ...patch }, owner: 'demo' }
        : null,
    ),
  );
}

/** One Try it run of `agent-1`'s draft (api.md 129). */
async function draftRunOf(
  ctx: Ctx,
  question = 'Who won?',
  signal?: AbortSignal,
): Promise<{ events: RunStreamEvent[]; run: WorkflowRun }> {
  const events: RunStreamEvent[] = [];
  const prepared = await ctx.runs.prepareDraft('agent-1', {
    input: { question },
  });
  const run = await ctx.runs.stream(prepared, (e) => events.push(e), signal);
  return { events, run };
}

describe("Try it on Elena's conversation engine (api.md 129; ADR-0059)", () => {
  it("runs the draft as Elena's one Answer step, with the draft's instructions in her context, and stores nothing", async () => {
    const ctx = build({ streams: { 'insights-lead': elenaAnswers() } });
    withDraft(ctx);
    const { events, run } = await draftRunOf(ctx);
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
      INSIGHTS_LEAD_ENGINE_ID,
      expect.anything(),
      expect.anything(),
    );
    expect(events[0]).toEqual({
      type: 'run',
      runId: run.id,
      workflowId: 'agent:agent-1',
    });
    expect(run.status).toBe('success');
    expect(run.steps.map(stepLine)).toEqual(['answer:success']);
    expect(run.answer?.content).toBe('Brazil won.');
    expect(run).toMatchObject({
      workflowId: 'agent:agent-1',
      agentKey: 'insights-lead',
      agentId: 'agent-1',
      agentName: 'Sales helper',
    });
    // Elena alone, her budget, the draft's instructions as Block 5.
    expect(ctx.calls['insights-lead']).toHaveLength(1);
    expect(ctx.calls['assistant']).toHaveLength(0);
    const call = ctx.calls['insights-lead'][0].options;
    expect(call.maxSteps).toBe(24);
    expect(call.memory).toBeUndefined();
    const blocks = call.context.map((block) => block.content);
    const own = blocks.findIndex((content) =>
      content.includes('<agent-instructions>\nAnswer in euros.'),
    );
    expect(own).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/^Datasets for this session: World Cup\./);
    // Never stored, and its host and workspace go with it.
    expect(await ctx.runsRepository.list()).toEqual([]);
    expect(ctx.mastra.deleteSessionResources).toHaveBeenCalledWith(
      `run-${run.id}`,
    );
  });

  it('keeps the dashboard and export gates closed: nothing is saved, even when asked for a dashboard', async () => {
    const artifacts = dashboardArtifacts();
    const ctx = build({
      artifacts,
      streams: { 'insights-lead': elenaAnswers() },
    });
    withDraft(ctx);
    const { run } = await draftRunOf(ctx, 'Create a dashboard of goals');
    expect(run.status).toBe('success');
    const call = ctx.calls['insights-lead'][0].options;
    expect(
      call.requestContext.values.get(CONVERSATION_GATES_CONTEXT_KEY),
    ).toEqual({ dashboard: false, export: false });
    expect(call.requestContext.values.has(DASHBOARD_TOOLS_RUNTIME_KEY)).toBe(
      false,
    );
    expect(artifacts.createDashboard).not.toHaveBeenCalled();
    expect(run.answer?.dashboard).toBeUndefined();
  });

  it("routes the draft as Elena's runs: Opus 5.5 high on a Claude provider, an effort override keeping Opus, a model override replacing it", async () => {
    const config = jest.mocked(resolveAgentModelConfig);
    config.mockResolvedValue('anthropic/claude-sonnet-4-6');
    const stepModelOf = async (patch: Record<string, unknown>) => {
      const ctx = build({ streams: { 'insights-lead': elenaAnswers() } });
      withDraft(ctx, patch);
      await draftRunOf(ctx);
      const call = ctx.calls['insights-lead'][0].options;
      return call.requestContext.values.get(STEP_MODEL_CONTEXT_KEY);
    };
    try {
      expect(await stepModelOf({})).toEqual({
        model: 'claude-opus-5-5',
        reasoningEffort: 'high',
      });
      expect(await stepModelOf({ reasoningEffort: 'low' })).toEqual({
        model: 'claude-opus-5-5',
        reasoningEffort: 'low',
      });
      expect(await stepModelOf({ model: 'claude-own' })).toBeUndefined();
    } finally {
      config.mockResolvedValue('openai/gpt-4.1-mini');
    }
  });
});
