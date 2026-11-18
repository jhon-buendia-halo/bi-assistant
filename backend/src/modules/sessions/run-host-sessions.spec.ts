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
// The query inspector's page path a follow-up pages through (roadmap 1.28.8).
const mockPageQuery = jest.fn();
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
    pageQuery: (...args: unknown[]) => mockPageQuery(...args) as unknown,
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
    readWorkspaceImage: jest.fn(actual.readWorkspaceImage),
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
import {
  ANSWER_BUSINESS_QUESTION_STEPS,
  planOf,
} from '../../mastra/workflows/answer-business-question.steps';
import { answerBusinessQuestionWorkflow } from '../../mastra/workflows/answer-business-question.workflow';
import { askAgentWorkflow } from '../../mastra/workflows/ask-agent.workflow';
import { DATA_READINESS_ASSESSMENT_STEPS } from '../../mastra/workflows/data-readiness-assessment.steps';
import { dataReadinessAssessmentWorkflow } from '../../mastra/workflows/data-readiness-assessment.workflow';
import { CODE_WORKFLOWS } from '../../mastra/workflows/workflow-catalog';
import type { ReadinessReport } from '../data-readiness/engine/types';
import { BadGatewayException } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { listSessionWorkspaceIds } from '../../mastra/session-workspaces';
import { readWorkspaceImage, writeWorkspaceFile } from './workspace-files';
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

/** The workflow detail the fake catalogue answers for `answer-business-question`. */
const V2_WORKFLOW = {
  id: 'answer-business-question',
  name: 'Insights Analyst',
  input: CODE_WORKFLOWS[0].input,
  agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
  steps: ANSWER_BUSINESS_QUESTION_STEPS,
  edges: CODE_WORKFLOWS[0].edges,
  contractHash: CODE_WORKFLOWS[0].contractHash,
};

/** The workflow detail the fake catalogue answers for Assess Data Readiness. */
const READINESS_WORKFLOW = {
  id: 'data-readiness-assessment',
  name: 'Assess Data Readiness',
  input: CODE_WORKFLOWS[1].input,
  agents: [{ key: 'data-readiness', name: 'Data Readiness Agent' }],
  steps: DATA_READINESS_ASSESSMENT_STEPS,
  edges: CODE_WORKFLOWS[1].edges,
};

/** The report the fake engine scores for World Cup. */
const READINESS_REPORT: ReadinessReport = {
  id: 'r-wc',
  datasourceId: 'ds-pg',
  datasourceName: 'World Cup DB',
  datasourceKind: 'postgres',
  generatedAt: '2026-11-13T10:00:00.000Z',
  entityCount: 1,
  overallScore: 84,
  maturity: 'Managed',
  dimensionScores: [
    {
      dimension: 'completeness',
      score: 90,
      findingCount: 1,
      maxSeverity: 'low',
      assessed: true,
      totalChecks: 4,
    },
  ],
  findings: [
    {
      dimension: 'completeness',
      level: 'entity',
      namespace: 'public',
      entity: 'matches',
      field: 'winner',
      severity: 'low',
      measured: 0.02,
      description: '2% of winner is null',
      recommendation: 'Fill it',
    },
  ],
};

/** The registry key of the agent each turn calls. */
const AGENT_KEYS: Record<Workflow, string> = {
  assistant: 'assistant',
  v2: 'insights-analyst',
  readiness: 'data-readiness',
};

/** The chat session that takes the same input as each turn. */
const SESSIONS: Record<Workflow, Partial<SessionDoc>> = {
  assistant: { datasets: ['World Cup'] },
  v2: {
    datasets: ['World Cup'],
    agentKey: 'insights-analyst',
    agentName: 'Insights Analyst',
  },
  readiness: {
    datasets: ['World Cup'],
    agentKey: 'data-readiness',
    agentName: 'Data Readiness Agent',
  },
};

/** The v2 run input that asks what the chat message asks. */
// Build visual is on unless the run turns it off (workflows R41): the runs
// below turn it off; the Build visual runs set it.
const V2_INPUT = {
  question: 'Who won?',
  datasets: ['World Cup'],
  buildVisual: false,
};
// What the engine is given: the flag only picks the branch (the runtime's
// `buildsVisual`), it is not an input of the workflow's steps.
const V2_ENGINE_INPUT = { question: 'Who won?', datasets: ['World Cup'] };

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
  /** The data-readiness service, for Assess Data Readiness runs. */
  readiness?: object;
  /** The visualization service's designer (`createFromAnswer`), for Build visual. */
  visuals?: object;
  /** The datasources service's guarded read-only SQL (roadmap 1.28.11). */
  runReadOnlySql?: jest.Mock;
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
              (key === 'insights-analyst' ? V2_ANALYSE_CHUNKS : undefined) ?? [
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
    'data-readiness': agentFor('data-readiness', 'Data Readiness Agent'),
  };
  // Suspended v2 runs dropped (their snapshots deleted, ADR-0043).
  const discards = { count: 0 };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: jest.fn(
      (key: string, inputData: unknown, requestContext: unknown) =>
        key === 'answer-business-question'
          ? streamStubWorkflow(
              answerBusinessQuestionWorkflow,
              inputData,
              requestContext,
              discards,
            )
          : key === 'data-readiness-assessment'
            ? streamStubWorkflow(
                dataReadinessAssessmentWorkflow,
                inputData,
                requestContext,
              )
            : key === 'ask-agent'
              ? streamStubWorkflow(askAgentWorkflow, inputData, requestContext)
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
    // v2's Plan and Write answer model calls (agents.md 5.11).
    planAnalysis: jest.fn(
      (
        { question }: { question: string },
        opts?: { onExchange?: (e: object) => Promise<void> },
      ) => {
        // The stand-in records nothing; a test may (`onExchange`).
        void opts;
        return Promise.resolve({ plan: planOf({}, question), stopped: false });
      },
    ),
    // Nathan's reading of a follow-up (roadmap 1.28.8): a new question
    // unless a test says otherwise.
    interpretResult: jest.fn((input: unknown, opts?: unknown) => {
      void input;
      void opts;
      return Promise.resolve({
        action: 'new-question',
        query: 0,
        interpretation: {
          request: {},
          understood: '',
        },
      });
    }),
    writeAnswer: jest.fn(
      (_input: unknown, opts: { onText?: (delta: string) => void }) => {
        opts.onText?.('Brazil won.');
        return Promise.resolve({
          answer: { headline: 'Brazil won.', answer: 'Brazil won.' },
          stopped: false,
        });
      },
    ),
    // Read images' model call (agents.md 2.15): no notes unless a test
    // scripts them.
    readImages: jest.fn(
      (
        input: { question: string; images: unknown[] },
        opts: { onExchange?: (e: object) => Promise<void> },
      ) => {
        // The stand-in records nothing; a test may (`onExchange`).
        void input;
        void opts;
        return Promise.resolve({
          imageNotes: '',
          imageCount: 0,
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
    {
      get: jest.fn().mockResolvedValue({ id: 'ds', name: 'DS' }),
      runReadOnlySql:
        options.runReadOnlySql ??
        jest.fn().mockResolvedValue({ columns: [], rows: [], totalRows: 0 }),
    } as never,
    {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
    } as never,
    (options.visuals ?? {}) as never,
    {
      referenceBlock: jest.fn().mockResolvedValue(undefined),
      isVerifiedSql: jest.fn().mockResolvedValue(false),
    } as never,
    { definitionBlock: jest.fn().mockResolvedValue(undefined) } as never,
    {
      contextFor: jest.fn().mockResolvedValue({ block: '', used: [] }),
    } as never,
    userAgents as never,
    options.readiness as never,
  );
  const workflows = {
    definition: jest.fn((id: string) =>
      id === V2_WORKFLOW.id
        ? Promise.resolve(V2_WORKFLOW)
        : id === READINESS_WORKFLOW.id
          ? Promise.resolve(READINESS_WORKFLOW)
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
    // No stored artifact: no workflow here takes one.
    { list: () => Promise.resolve([]) } as never,
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

/** A run of `answer-business-question` on `input`. */
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
    for (const agentKey of [
      'sql-fixer',
      'insights-analyst',
      'rfp',
      'agent-1',
    ]) {
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

  it('is created per run and discarded after it: never listed, its memory threads and workspace kept', async () => {
    const ctx = build();
    const { run } = await runOf(ctx, V2_INPUT);
    const hostId = `run-${run.id}`;
    expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenCalledWith(
      hostId,
      'Insights Analyst',
    );
    // The run keeps its agents' threads until it is deleted.
    expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
    expect(ctx.mastra.deleteSessionResources).not.toHaveBeenCalled();
    await expect(ctx.sessions.get(hostId)).rejects.toThrow(
      `Session ${hostId} not found`,
    );
    // Each run gets its own host.
    const second = await runOf(ctx, V2_INPUT);
    expect(second.run.id).not.toBe(run.id);
    expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenLastCalledWith(
      `run-${second.run.id}`,
      'Insights Analyst',
    );
  });

  it("writes every reference image of the run's input to its workspace once and records their paths (workflows R35)", async () => {
    const ctx = build();
    const write = jest.mocked(writeWorkspaceFile);
    write.mockClear();
    write.mockResolvedValue(undefined);
    const one = Buffer.from('one');
    const two = Buffer.from('two');
    const host = await ctx.sessions.createRunHost({
      runId: 'img-1',
      workflowId: 'answer-business-question',
      name: 'Answer a Business Question',
      datasets: ['World Cup'],
      image: { path: 'inputs/image.png', data: one },
      inputFiles: [
        { path: 'inputs/image.png', data: one },
        { path: 'inputs/images/1.png', data: two },
      ],
      inputImages: ['inputs/images/1.png'],
    });
    expect(host.inputImages).toEqual(['inputs/images/1.png']);
    expect(host.inputImage).toBe('inputs/image.png');
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith('run-img-1', 'inputs/images/1.png', two);
    // A host with no images records none.
    const plain = await ctx.sessions.createRunHost({
      runId: 'img-2',
      workflowId: 'answer-business-question',
      name: 'Answer a Business Question',
      datasets: ['World Cup'],
    });
    expect(plain).not.toHaveProperty('inputImages');
    write.mockReset();
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
    expect(ctx.calls['insights-analyst'][1].input).toEqual([
      { role: 'user', content: 'Who won?' },
      { role: 'assistant', content: 'Brazil won.' },
      { role: 'user', content: 'And in 2014?' },
    ]);
    // The earlier run had no thread to copy (the stand-in copies none).
    expect(ctx.mastra.copyMemoryResource).toHaveBeenCalledWith(
      `run-${first.run.id}`,
      expect.stringMatching(/^run-/) as string,
    );
  });

  it("a follow-up whose earlier run's threads were copied replays only the earlier answer and this question, and Plan still reads the whole transcript", async () => {
    const ctx = build();
    const first = await runOf(ctx, V2_INPUT);
    // The copies exist once the host is created.
    ctx.mastra.copyMemoryResource.mockResolvedValueOnce(3);
    ctx.registry['insights-analyst'].getMemory.mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: 'copied' }),
    });
    await runOf(
      ctx,
      { question: 'And in 2014?', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    // The copied thread holds the earlier analysis; the answer it gave
    // comes with the new question.
    expect(ctx.calls['insights-analyst'][1].input).toEqual([
      { role: 'assistant', content: 'Brazil won.' },
      { role: 'user', content: 'And in 2014?' },
    ]);
    expect(ctx.mastra.planAnalysis).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Who won?' },
          { role: 'assistant', content: 'Brazil won.' },
          { role: 'user', content: 'And in 2014?' },
        ],
      }),
      expect.anything(),
    );
  });

  it("records Plan's and Write answer's exchanges in their threads on the run's host (agents.md 5.14)", async () => {
    const ctx = build();
    ctx.mastra.planAnalysis.mockImplementationOnce(
      async (
        { question }: { question: string },
        opts: { onExchange?: (e: object) => Promise<void> },
      ) => {
        await opts.onExchange?.({ request: question, reply: '{"plan":1}' });
        return { plan: planOf({}, question), stopped: false };
      },
    );
    ctx.mastra.writeAnswer.mockImplementationOnce(
      async (
        _input: unknown,
        opts: {
          onText?: (delta: string) => void;
          onExchange?: (e: object) => Promise<void>;
        },
      ) => {
        opts.onText?.('Brazil won.');
        await opts.onExchange?.({ request: 'rows', reply: 'Brazil won.' });
        return {
          answer: { headline: 'Brazil won.', answer: 'Brazil won.' },
          stopped: false,
        };
      },
    );
    const { run } = await runOf(ctx, V2_INPUT);
    expect(ctx.mastra.recordAgentExchange).toHaveBeenCalledWith(
      `run-${run.id}`,
      'analysis-planner',
      { request: 'Who won?', reply: '{"plan":1}' },
    );
    expect(ctx.mastra.recordAgentExchange).toHaveBeenCalledWith(
      `run-${run.id}`,
      'answer-writer',
      { request: 'rows', reply: 'Brazil won.' },
    );
  });

  it('a failure to record an exchange never fails the run', async () => {
    const ctx = build();
    ctx.mastra.recordAgentExchange.mockRejectedValue(new Error('disk full'));
    ctx.mastra.planAnalysis.mockImplementationOnce(
      async (
        { question }: { question: string },
        opts: { onExchange?: (e: object) => Promise<void> },
      ) => {
        await opts.onExchange?.({ request: question, reply: 'x' });
        return { plan: planOf({}, question), stopped: false };
      },
    );
    const { run } = await runOf(ctx, V2_INPUT);
    expect(run.status).toBe('success');
  });

  it('a node chat host sends its transcript before the message and its context block after the agent’s own (agents.md 5.16)', async () => {
    const ctx = build();
    const host = await ctx.sessions.createRunHost({
      runId: 'r-1-node-analyse',
      workflowId: 'answer-business-question',
      name: 'Insights Analyst: Analyse',
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
    // The turn is the step's agent alone (agents.md 5.16): no plan, no
    // catalog or plan block, no answer step; the context block comes last.
    expect(at).toBe(system.length - 1);
    expect(ctx.mastra.planAnalysis).not.toHaveBeenCalled();
    expect(ctx.mastra.writeAnswer).not.toHaveBeenCalled();
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
    const call = ctx.calls['insights-analyst'][0];
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
      'interpret-follow-up:running',
      'interpret-follow-up:success',
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
      // No reference images (workflows R35).
      'read-images:skipped',
      'clarify:skipped',
      // Not asked for (agents.md 5.11).
      'build-visual:skipped',
      'page-result:skipped',
      'page-answer:skipped',
    ]);
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'read-images:skipped',
      'receive-question:success',
      'load-catalog:success',
      'interpret-follow-up:success',
      'plan:success',
      'clarify:skipped',
      'analyse:success',
      'validate:success',
      'write-answer:success',
      'build-visual:skipped',
      'wrap-up:success',
      'page-result:skipped',
      'page-answer:skipped',
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

/** The data-readiness service: its phases, and the calls the tools make. */
function readinessService() {
  return {
    prepare: jest.fn((input: { runId?: string }) =>
      Promise.resolve({
        datasource: { id: 'ds-pg', name: 'World Cup DB' },
        kind: 'postgres',
        ...(input.runId ? { runId: input.runId } : {}),
      }),
    ),
    profileSource: jest.fn().mockResolvedValue({
      sourceId: 'ds-pg',
      sourceType: 'postgres',
      entities: [{ namespace: 'public', name: 'matches' }],
      relationships: [],
    }),
    scoreProfile: jest.fn(() => ({ ...READINESS_REPORT })),
    saveReport: jest.fn((report: ReadinessReport) => Promise.resolve(report)),
    get: jest.fn().mockResolvedValue(READINESS_REPORT),
    list: jest.fn().mockResolvedValue({ reports: [] }),
    assess: jest.fn(),
  };
}

describe('a v2 run that builds a visual (agents.md 5.11, workflows R41)', () => {
  const BUILT = {
    id: 'v-1',
    title: 'Wins per team',
    description: 'Wins',
    path: 'visuals/v-1',
    sourceMessageAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    currentVersion: 1,
    versions: [],
  };

  it('designs the visual from the written answer and the rows, stores it with the session and logs its creation beside the answer', async () => {
    const createFromAnswer = jest
      .fn()
      .mockResolvedValue({ metadata: BUILT, bundle: {} });
    const ctx = build({ visuals: { createFromAnswer } });
    await ctx.sessions.onModuleInit();
    const { run } = await runOf(ctx, { ...V2_INPUT, buildVisual: true });

    expect(run.status).toBe('success');
    const stepLines = run.steps.map((s) => `${s.id}:${s.status}`);
    expect(stepLines.indexOf('build-visual:success')).toBe(
      stepLines.indexOf('write-answer:success') + 1,
    );
    expect(createFromAnswer).toHaveBeenCalledTimes(1);
    const [, source] = createFromAnswer.mock.calls[0] as [
      unknown,
      { question: string; answer: string; at: string; data: unknown[] },
    ];
    expect(source.question).toBe('Who won?');
    expect(source.answer).toBe(run.answer?.content);
    expect(source.data.length).toBeGreaterThan(0);
    // The turn's stop reaches the designer (agents.md 6.7).
    expect((createFromAnswer.mock.calls[0] as unknown[])[2]).toBeInstanceOf(
      AbortSignal,
    );
    // The answer is stored at the time the visual names as its source.
    expect(run.answer?.at).toBe(source.at);
    expect((run.visualizations ?? []).map((v) => v.id)).toEqual(['v-1']);
    expect(
      run.steps.find((s) => s.id === 'build-visual')?.output,
    ).toMatchObject({ visual: { visualId: 'v-1', title: 'Wins per team' } });
    expect(run.events?.at(-1)?.content).toContain(
      'Created interactive visual "Wins per team" (v1).',
    );
  });

  it('keeps the answer when the design fails, saying why in the step', async () => {
    const createFromAnswer = jest
      .fn()
      .mockRejectedValue(new Error('The designer is down'));
    const ctx = build({ visuals: { createFromAnswer } });
    await ctx.sessions.onModuleInit();
    const { run } = await runOf(ctx, { ...V2_INPUT, buildVisual: true });
    expect(run.status).toBe('success');
    expect(run.answer?.content).toBe('Brazil won.');
    expect(run.visualizations ?? []).toEqual([]);
    expect(
      run.steps.find((s) => s.id === 'build-visual')?.output,
    ).toMatchObject({
      visual: {
        error: expect.stringContaining('The designer is down') as unknown,
      },
    });
  });

  it('skips Build visual when the run turns it off', async () => {
    const createFromAnswer = jest.fn();
    const ctx = build({ visuals: { createFromAnswer } });
    await ctx.sessions.onModuleInit();
    const { run } = await runOf(ctx, V2_INPUT);
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toContain(
      'build-visual:skipped',
    );
    expect(createFromAnswer).not.toHaveBeenCalled();
    expect(run.visualizations ?? []).toEqual([]);
  });

  it("asked alone (agents.md 5.21), Ryan designs a new visual from the earlier answer's rows, the follow-up as his instruction, and no query runs", async () => {
    const createFromAnswer = jest
      .fn()
      .mockResolvedValue({ metadata: BUILT, bundle: {} });
    const ctx = build({ visuals: { createFromAnswer } });
    await ctx.sessions.onModuleInit();
    const first = await runOf(ctx, V2_INPUT);
    const earlierRecords = first.run.answer?.data ?? [];
    expect(earlierRecords).toHaveLength(1);

    const { run } = await runOf(
      ctx,
      { question: 'As a bar chart', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id, askStep: 'build-visual' } },
    );

    expect(run.status).toBe('success');
    expect(
      run.steps
        .filter((step) => step.status !== 'skipped')
        .map((step) => `${step.id}:${step.status}`),
    ).toEqual(['build-visual:success']);
    // One designer call, no new query or model step.
    expect(createFromAnswer).toHaveBeenCalledTimes(1);
    expect(ctx.calls['insights-analyst']).toHaveLength(1);
    expect(ctx.mastra.planAnalysis).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.writeAnswer).toHaveBeenCalledTimes(1);
    const [, source] = createFromAnswer.mock.calls[0] as [
      unknown,
      {
        question: string;
        answer: string;
        at: string;
        data: unknown[];
        instruction?: string;
      },
    ];
    expect(source).toMatchObject({
      question: 'Who won?',
      answer: first.run.answer?.content,
      instruction: 'As a bar chart',
    });
    expect(source.data).toEqual(earlierRecords);
    // The code-written answer carries the earlier records once, with their
    // evidence, at the time the visual names as its source.
    expect(run.answer?.content).toBe(
      `Here's a new visual of the earlier answer: "Wins per team".`,
    );
    expect(run.answer?.visual).toBeUndefined();
    expect(run.answer?.data).toEqual(earlierRecords);
    expect(run.answer?.evidence).toHaveLength(1);
    expect(run.answer?.at).toBe(source.at);
    expect(
      run.steps.find((s) => s.id === 'build-visual')?.output,
    ).toMatchObject({ visual: { visualId: 'v-1', title: 'Wins per team' } });
    expect(run.events?.at(-1)?.content).toContain(
      'Created interactive visual "Wins per team" (v1).',
    );
  });

  it("asked alone, a design that fails is the answer's news and the step still ends done", async () => {
    const createFromAnswer = jest
      .fn()
      .mockRejectedValue(new Error('The designer is down'));
    const ctx = build({ visuals: { createFromAnswer } });
    await ctx.sessions.onModuleInit();
    const first = await runOf(ctx, V2_INPUT);
    const { run } = await runOf(
      ctx,
      { question: 'As a bar chart', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id, askStep: 'build-visual' } },
    );
    expect(run.status).toBe('success');
    expect(run.answer?.content).toContain(
      "I couldn't build a new visual: The designer is down",
    );
    expect(
      run.steps.find((s) => s.id === 'build-visual')?.output,
    ).toMatchObject({
      visual: {
        error: expect.stringContaining('The designer is down') as unknown,
      },
    });
    expect(run.events ?? []).toEqual([]);
  });
});

describe('an Assess Data Readiness run (agents.md 5.13; data-readiness R2)', () => {
  /** The agent reads the stored report, then explains it. */
  const EXPLAIN_CHUNKS = [
    {
      type: 'tool-call',
      payload: {
        toolCallId: 'g0',
        toolName: 'get_readiness_report',
        args: { reportId: 'r-wc' },
      },
    },
    {
      type: 'tool-result',
      payload: {
        toolCallId: 'g0',
        toolName: 'get_readiness_report',
        result: { report: READINESS_REPORT, summary: { reportId: 'r-wc' } },
      },
    },
    { type: 'text-delta', payload: { text: 'World Cup is Managed (84).' } },
  ];

  async function readinessRun(
    ctx: Ctx,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    await ctx.sessions.onModuleInit();
    const events: RunStreamEvent[] = [];
    const prepared = await ctx.runs.prepare(READINESS_WORKFLOW.id, { input });
    const run = await ctx.runs.stream(prepared, (e) => events.push(e), signal);
    return { events, run };
  }

  it('profiles, scores and stores in code, then the agent explains the stored report once', async () => {
    const readiness = readinessService();
    const ctx = build({ chunks: EXPLAIN_CHUNKS, readiness });
    const { events, run } = await readinessRun(ctx, { dataset: 'World Cup' });

    expect(run.status).toBe('success');
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      // No reference images (workflows R35).
      'read-images:skipped',
      'resolve-dataset:success',
      'profile-source:success',
      'score-readiness:success',
      'save-report:success',
      'finding-rows:success',
      'explain-report:success',
      'wrap-up:success',
    ]);
    // One assessment of the run's dataset, recorded with the run; the
    // agent never runs a second one.
    expect(readiness.prepare).toHaveBeenCalledWith({
      datasourceId: 'ds-pg',
      entities: ['wc.public.matches'],
      runId: run.id,
    });
    expect(readiness.saveReport).toHaveBeenCalledTimes(1);
    expect(readiness.assess).not.toHaveBeenCalled();
    // The agent answers the default question, told to read the stored
    // report, with assess_data_readiness refusing (agents.md 3.13).
    expect(ctx.calls['data-readiness']).toHaveLength(1);
    const [call] = ctx.calls['data-readiness'];
    expect(call.input).toEqual([
      { role: 'user', content: 'Assess the readiness of this dataset' },
    ]);
    expect(call.options.context.at(-1)?.content).toContain(
      'stored readiness report r-wc',
    );
    expect(
      call.options.requestContext.values.get('readiness-assessed-report'),
    ).toBe('r-wc');
    // The answer carries the report: its card and scorecard (R5).
    expect(events.filter((e) => e.type === 'readiness-report')).not.toEqual([]);
    expect(run.answer).toMatchObject({
      content: 'World Cup is Managed (84).',
      readinessReport: { reportId: 'r-wc' },
    });
    expect(run.output).toMatchObject({
      reportId: 'r-wc',
      overallScore: 84,
      maturity: 'Managed',
      findingCount: 1,
      answer: 'World Cup is Managed (84).',
    });
  });

  // Roadmap 1.28.11; data-readiness R34: the rows behind each top finding
  // are a source of the answer, ahead of the agent's own records.
  it("records the rows behind each top finding as the answer's sources, a failed query as a failed one, and leaves the agent's input as it was", async () => {
    const readiness = readinessService();
    const report: ReadinessReport = {
      ...READINESS_REPORT,
      findings: [
        ...READINESS_REPORT.findings,
        {
          dimension: 'uniqueness',
          level: 'entity',
          namespace: 'public',
          entity: 'matches',
          field: 'match_id',
          severity: 'high',
          measured: '2 duplicate row(s)',
          description: 'The primary key (match_id) has 2 duplicate row(s).',
          recommendation: 'De-duplicate.',
        },
        {
          dimension: 'accessibility',
          level: 'source',
          severity: 'medium',
          measured: '1 of 2 table(s) not readable',
          description: 'One table cannot be read.',
          recommendation: 'Grant access.',
        },
      ],
    };
    readiness.scoreProfile.mockReturnValue({ ...report });
    const runReadOnlySql = jest.fn((datasourceId: string, sql: string) =>
      sql.includes('IS NULL')
        ? Promise.resolve({
            columns: ['winner', 'matching_rows'],
            rows: [{ winner: null, matching_rows: 1 }],
            totalRows: 1,
          })
        : Promise.reject(new Error('relation "public.matches" is locked')),
    );
    const ctx = build({ chunks: EXPLAIN_CHUNKS, readiness, runReadOnlySql });
    const { events, run } = await readinessRun(ctx, { dataset: 'World Cup' });

    expect(run.status).toBe('success');
    expect(run.steps.map((s) => `${s.id}:${s.status}`)).toContain(
      'finding-rows:success',
    );
    // Most severe first (the summary's order), at most 20; nothing for
    // accessibility. Each on the report's datasource, capped at 200 rows.
    expect(runReadOnlySql.mock.calls.map((call) => call[0])).toEqual([
      'ds-pg',
      'ds-pg',
    ]);
    expect((runReadOnlySql.mock.calls as unknown[][]).map((c) => c[2])).toEqual(
      [200, 200],
    );
    expect(run.answer?.data?.slice(0, 2)).toEqual([
      {
        tool: 'run_readonly_sql',
        input:
          'SELECT "match_id", COUNT(*) AS occurrences FROM "public"."matches" GROUP BY "match_id" HAVING COUNT(*) > 1 ORDER BY occurrences DESC, "match_id"',
        error: 'relation "public.matches" is locked',
        rationale: 'Values of match_id that repeat in public.matches',
      },
      {
        tool: 'run_readonly_sql',
        input:
          'SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM "public"."matches" WHERE "winner" IS NULL',
        columns: ['winner', 'matching_rows'],
        rows: [{ winner: null, matching_rows: 1 }],
        rowCount: 1,
        rationale: 'Rows where winner is empty in public.matches',
        // Only its count links a figure (agent-answers R69).
        figureColumns: ['matching_rows'],
      },
    ]);
    expect(run.answer?.evidence?.slice(0, 2)).toEqual([
      { index: 0, datasourceId: 'ds-pg', rowLimit: 200 },
      expect.objectContaining({
        index: 1,
        datasourceId: 'ds-pg',
        totalRows: 1,
        rowLimit: 200,
        coverage: expect.any(String) as unknown,
      }),
    ]);
    // Each source shows in the run's stream as a SQL call and its result.
    const shown = events
      .filter((e) => e.type === 'tool-result')
      .map((e) => JSON.parse((e as { content: string }).content) as object);
    expect(shown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'run_readonly_sql',
          rationale: 'Rows where winner is empty in public.matches',
          rowCount: 1,
        }),
      ]),
    );
    // The agent's input is unchanged: the same question and no block that
    // carries the finding queries (out of scope of 1.28.11).
    const [call] = ctx.calls['data-readiness'];
    expect(call.input).toEqual([
      { role: 'user', content: 'Assess the readiness of this dataset' },
    ]);
    expect(
      call.options.context.some((block) => block.content.includes('SELECT')),
    ).toBe(false);
    expect(run.answer?.content).toBe('World Cup is Managed (84).');
  });

  it('fails at Profile source with the datasource named when it cannot be reached, storing nothing', async () => {
    const readiness = readinessService();
    readiness.profileSource.mockRejectedValue(
      new BadGatewayException('connect ECONNREFUSED'),
    );
    const ctx = build({ chunks: EXPLAIN_CHUNKS, readiness });
    const { run } = await readinessRun(ctx, { dataset: 'World Cup' });
    expect(run.status).toBe('failed');
    expect(run.error).toContain(
      'Could not reach "World Cup DB": connect ECONNREFUSED',
    );
    expect(readiness.saveReport).not.toHaveBeenCalled();
    expect(ctx.calls['data-readiness']).toEqual([]);
  });

  it('refuses a dataset that is not PostgreSQL or Databricks before the run', async () => {
    const ctx = build({ readiness: readinessService() });
    await ctx.sessions.onModuleInit();
    await expect(
      ctx.runs.prepare(READINESS_WORKFLOW.id, {
        input: { dataset: 'Orders API' },
      }),
    ).rejects.toThrow('is not a PostgreSQL or Databricks dataset');
  });

  // Reference images (workflows R35; agents.md 2.15, 5.13).
  it("adds Zoe's notes after the report block when the run has images, and leaves the context as it was without", async () => {
    const readiness = readinessService();
    const ctx = build({ chunks: EXPLAIN_CHUNKS, readiness });
    jest.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    jest.mocked(readWorkspaceImage).mockResolvedValue({
      path: 'inputs/images/1.png',
      data: PNG_BYTES,
      mediaType: 'image/png',
    });
    ctx.mastra.readImages.mockResolvedValue({
      imageNotes: IMAGE_NOTES,
      imageCount: 1,
      stopped: false,
    });
    const plain = await readinessRun(ctx, { dataset: 'World Cup' });
    const noted = await readinessRun(ctx, {
      dataset: 'World Cup',
      images: [PNG_URL],
    });
    expect(plain.run.status).toBe('success');
    expect(noted.run.status).toBe('success');
    expect(noted.run.steps[0]).toMatchObject({
      id: 'read-images',
      status: 'success',
    });
    const [before, after] = ctx.calls['data-readiness'].map((call) =>
      call.options.context.map((block) => block.content),
    );
    // Without images: the report block is the last one, as before.
    expect(before.at(-1)).toContain('stored readiness report');
    // With images: the same blocks, then the notes.
    expect(after.slice(0, -1)).toHaveLength(before.length);
    expect(after.at(-2)).toContain('stored readiness report');
    expect(after.at(-1)).toBe(IMAGE_NOTES);
    expect(ctx.mastra.readImages).toHaveBeenCalledTimes(1);
    jest.mocked(writeWorkspaceFile).mockReset();
    jest.mocked(readWorkspaceImage).mockReset();
  });
});

/** Read images' notes as a stand-in model returns them (agents.md 2.15). */
const IMAGE_NOTES = '## Reference images\nA bar chart of goals per team.';
/** Bytes with the PNG signature, as the input check requires. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('chart'),
]);
const PNG_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

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
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
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
      'interpret-follow-up:success',
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
    expect(ctx.calls['insights-analyst']).toHaveLength(0);
    expect(ctx.discards.count).toBe(0);
  });

  it('resumes the same run with the answer: Clarify goes back to Plan, which plans with it, then the analysis and the answer', async () => {
    const ctx = build();
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const started = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
      buildVisual: false,
    });
    const { events, run } = await resumeOf(ctx, started.run.id, {
      stepId: 'clarify',
      answer: '  Matches won ',
    });
    expect(events[0]).toEqual({
      type: 'run',
      runId: started.run.id,
      workflowId: 'answer-business-question',
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
      'read-images:skipped',
      'build-visual:skipped',
      'page-result:skipped',
      'page-answer:skipped',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'input-required')).toBe(false);
    expect(run.id).toBe(started.run.id);
    expect(run.status).toBe('success');
    expect(run.waitingFor).toBeUndefined();
    expect(run.answer?.content).toBe('Brazil won.');
    expect(run.steps.map(stepLine)).toEqual([
      'read-images:skipped',
      'receive-question:success',
      'load-catalog:success',
      'interpret-follow-up:success',
      'plan:success#1',
      'plan:success#2',
      'clarify:success#1',
      'analyse:success#1',
      'validate:success#1',
      'write-answer:success',
      'build-visual:skipped',
      'wrap-up:success',
      'page-result:skipped',
      'page-answer:skipped',
    ]);
    // Plan planned again with its question and the trimmed answer.
    expect(ctx.mastra.planAnalysis).toHaveBeenCalledTimes(2);
    expect(ctx.mastra.planAnalysis.mock.calls[1][0]).toMatchObject({
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
    const agent = ctx.registry['insights-analyst'];
    const defaultStream = agent.stream.getMockImplementation()!;
    agent.stream.mockImplementationOnce((input, opts) => {
      ctx.calls['insights-analyst'].push({ input, options: opts });
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
      'interpret-follow-up:success',
      'plan:success#1',
      'analyse:suspended#1',
    ]);
    // The question stopped the agent's stream, not the run.
    const firstCall = ctx.calls['insights-analyst'][0];
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
      'read-images:skipped',
      'clarify:skipped',
      'build-visual:skipped',
      'page-result:skipped',
      'page-answer:skipped',
    ]);
    // The agent runs again (no memory thread) with the conversation so far:
    // the question, its clarifying question and the user's answer.
    expect(ctx.calls['insights-analyst']).toHaveLength(2);
    const second = ctx.calls['insights-analyst'][1];
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
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
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
      ctx.mastra.planAnalysis.mockResolvedValueOnce({
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
      // Its host left memory; its memory threads stay with the run.
      expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers 410 to a run stored under another contract (the Clarify path moved, roadmap 1.28.8): stopped with waitingFor expired, its turn dropped', async () => {
    const ctx = build();
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const waiting = await runOf(ctx, V2_INPUT);
    await ctx.runsRepository.update(waiting.run.id, {
      contractHash: 'before-1278',
    });
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
    expect(ctx.discards.count).toBe(1);
  });

  it('"Run again with my answer": a run whose context is the expired run plans with its question and clarifying question', async () => {
    const ctx = build();
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
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
    const planned = ctx.mastra.planAnalysis.mock.calls.at(-1)![0] as {
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
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
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
    // No key: every registered workflow's leftover snapshots are deleted.
    expect(ctx.mastra.discardSuspendedWorkflowRuns).toHaveBeenCalledWith();
    // The run keeps its memory threads, as any finished run does.
    expect(ctx.mastra.deleteMemoryThread).not.toHaveBeenCalled();
  });

  it('a chat session still ends on the question as a clarification card: its workflow run is dropped', async () => {
    const ctx = build();
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
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

describe('a follow-up run over an earlier result (roadmap 1.28.8; workflows R36)', () => {
  const PAGE_2 = {
    columns: ['winner'],
    columnKinds: { winner: 'text' },
    rows: [{ winner: 'Italy' }],
    page: 2,
    pageSize: 1,
    pageCount: 3,
    matchedRows: 3,
    capped: false,
    view: { filters: [], sort: [], page: 2, pageSize: 1, matchedRows: 3 },
    ranAt: '2026-11-16T10:00:00.000Z',
    datasourceId: 'ds-pg',
  };

  beforeEach(() => mockPageQuery.mockReset());

  it("pages the earlier answer's query instead of planning: one result-explorer call, the page recorded as explore_result with its view, the answer written by code", async () => {
    const ctx = build();
    const first = await runOf(ctx, V2_INPUT);
    // A first run has no earlier result: no extra model call.
    expect(ctx.mastra.interpretResult).not.toHaveBeenCalled();
    ctx.mastra.interpretResult.mockResolvedValueOnce({
      action: 'explore',
      query: 0,
      interpretation: { request: { page: 2 }, understood: 'page 2' },
    });
    mockPageQuery.mockResolvedValueOnce(PAGE_2);
    const { events, run } = await runOf(
      ctx,
      { question: 'next page', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    expect(ctx.mastra.interpretResult).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.interpretResult.mock.calls[0][0]).toMatchObject({
      text: 'next page',
      candidates: [
        { ref: 'Q1', columns: [{ name: 'winner', values: ['Brazil'] }] },
      ],
      view: null,
    });
    expect(mockPageQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: 'SELECT winner FROM matches',
        columns: ['winner'],
      }),
      ['World Cup'],
      { page: 2 },
    );
    // No planning, no analysis, no Write answer on the follow-up.
    expect(ctx.mastra.planAnalysis).toHaveBeenCalledTimes(1);
    expect(ctx.calls['insights-analyst']).toHaveLength(1);
    expect(ctx.mastra.writeAnswer).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('success');
    expect(
      run.steps
        .filter((step) => step.status !== 'skipped')
        .map((step) => step.id),
    ).toEqual([
      'receive-question',
      'load-catalog',
      'interpret-follow-up',
      'page-result',
      'page-answer',
    ]);
    expect(run.answer?.content.split('\n')[0]).toBe('Rows 2–2 of 3');
    expect(run.answer?.content).toContain('| Italy |');
    // The page is the answer's query: its source SQL and the page's rows,
    // its view as evidence, so the inspector opens on page 2.
    expect(run.answer?.data).toEqual([
      expect.objectContaining({
        tool: 'explore_result',
        input: 'SELECT winner FROM matches',
        rows: [{ winner: 'Italy' }],
        truncated: true,
      }),
    ]);
    expect(run.answer?.evidence?.[0]).toMatchObject({
      index: 0,
      view: PAGE_2.view,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        content: expect.stringContaining('"name":"explore_result"') as string,
      }),
    );
  });

  it('plans the follow-up as a new question when result-explorer reads one', async () => {
    const ctx = build();
    const first = await runOf(ctx, V2_INPUT);
    const { run } = await runOf(
      ctx,
      { question: 'And in 2014?', datasets: ['World Cup'] },
      { context: { fromRunId: first.run.id } },
    );
    expect(ctx.mastra.interpretResult).toHaveBeenCalledTimes(1);
    expect(mockPageQuery).not.toHaveBeenCalled();
    expect(ctx.mastra.planAnalysis).toHaveBeenCalledTimes(2);
    expect(run.answer?.content).toBe('Brazil won.');
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

describe('a v2 run with reference images (workflows R35; agents.md 2.15, 5.11)', () => {
  /** The system blocks of an Analyse call, by content. */
  const systemOf = (call: StreamCall) =>
    call.options.context.map((block) => block.content);

  let ctx: Ctx;
  beforeEach(() => {
    ctx = build();
    jest.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    // Each stored image reads back as its own path's bytes.
    jest
      .mocked(readWorkspaceImage)
      .mockImplementation((_id: string, path: string) =>
        Promise.resolve({
          path,
          data: Buffer.from(path),
          mediaType: 'image/png',
        }),
      );
    ctx.mastra.readImages.mockImplementation(async (_input, opts) => {
      await opts.onExchange?.({ request: 'Describe 2 images', reply: '{}' });
      return { imageNotes: IMAGE_NOTES, imageCount: 2, stopped: false };
    });
  });
  afterEach(() => {
    jest.mocked(writeWorkspaceFile).mockReset();
    jest.mocked(readWorkspaceImage).mockReset();
  });

  it("reads the stored images once and hands Zoe's notes to Plan, Analyse and Write answer", async () => {
    const { run } = await runOf(ctx, {
      ...V2_INPUT,
      images: [PNG_URL, PNG_URL],
    });
    expect(run.status).toBe('success');
    expect(run.steps[0]).toMatchObject({
      id: 'read-images',
      status: 'success',
    });
    // The engine is given the stored paths, never the bytes.
    const paths = ['inputs/images/1.png', 'inputs/images/2.png'];
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
      'answer-business-question',
      { ...V2_ENGINE_INPUT, images: paths },
      expect.anything(),
    );
    // Each stored image is loaded from the run's workspace, in order, and
    // Zoe gets them all in one call, her exchange recorded in her thread.
    expect(
      jest.mocked(readWorkspaceImage).mock.calls.map(([, path]) => path),
    ).toEqual(paths);
    expect(ctx.mastra.readImages).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.readImages).toHaveBeenCalledWith(
      {
        question: 'Who won?',
        images: paths.map((path) => ({
          data: Buffer.from(path),
          mediaType: 'image/png',
        })),
      },
      expect.objectContaining({
        onExchange: expect.any(Function) as unknown,
      }),
    );
    expect(ctx.mastra.recordAgentExchange).toHaveBeenCalledWith(
      expect.any(String),
      'image-reader',
      { request: 'Describe 2 images', reply: '{}' },
    );
    expect(ctx.mastra.planAnalysis.mock.calls[0][0]).toMatchObject({
      imageNotes: IMAGE_NOTES,
    });
    const system = systemOf(ctx.calls['insights-analyst'][0]);
    expect(system.at(-3)).toMatch(/^Catalog loaded for this turn:/);
    expect(system.at(-2)).toMatch(/^Analysis plan for this turn:/);
    expect(system.at(-1)).toBe(IMAGE_NOTES);
    expect(ctx.mastra.writeAnswer.mock.calls[0][0]).toMatchObject({
      imageNotes: IMAGE_NOTES,
    });
  });

  it('sends every model request as before when the run has no images', async () => {
    const { run } = await runOf(ctx, V2_INPUT);
    expect(run.status).toBe('success');
    expect(run.steps[0]).toMatchObject({
      id: 'read-images',
      status: 'skipped',
    });
    // The engine's input has no images field at all.
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
      'answer-business-question',
      V2_ENGINE_INPUT,
      expect.anything(),
    );
    expect(ctx.mastra.readImages).not.toHaveBeenCalled();
    expect(readWorkspaceImage).not.toHaveBeenCalled();
    // Plan and Write answer get no notes field; Analyse's last two system
    // blocks are the catalog and the plan, as before.
    expect(ctx.mastra.planAnalysis.mock.calls[0][0]).not.toHaveProperty(
      'imageNotes',
    );
    expect(ctx.mastra.writeAnswer.mock.calls[0][0]).not.toHaveProperty(
      'imageNotes',
    );
    const system = systemOf(ctx.calls['insights-analyst'][0]);
    expect(system.at(-2)).toMatch(/^Catalog loaded for this turn:/);
    expect(system.at(-1)).toMatch(/^Analysis plan for this turn:/);
  });

  it('keeps the notes through a Clarify wait and its resume, without reading the images again', async () => {
    ctx.mastra.planAnalysis.mockResolvedValueOnce({
      plan: ASKING_PLAN,
      stopped: false,
    });
    const started = await runOf(ctx, {
      question: 'Which team was the most dominant?',
      datasets: ['World Cup'],
      images: [PNG_URL],
    });
    expect(started.run.status).toBe('suspended');
    const { run } = await resumeOf(ctx, started.run.id, {
      stepId: 'clarify',
      answer: 'Matches won',
    });
    expect(run.status).toBe('success');
    expect(ctx.mastra.readImages).toHaveBeenCalledTimes(1);
    expect(ctx.mastra.planAnalysis).toHaveBeenCalledTimes(2);
    expect(ctx.mastra.planAnalysis.mock.calls[1][0]).toMatchObject({
      answered: expect.objectContaining({ answer: 'Matches won' }) as unknown,
      imageNotes: IMAGE_NOTES,
    });
    expect(systemOf(ctx.calls['insights-analyst'][0]).at(-1)).toBe(IMAGE_NOTES);
    expect(ctx.mastra.writeAnswer.mock.calls[0][0]).toMatchObject({
      imageNotes: IMAGE_NOTES,
    });
  });
});
