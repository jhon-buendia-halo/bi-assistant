// The real Mastra instance pulls in ESM-only packages Jest cannot require.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  ASSISTANT_EVAL_SETS: [],
}));
jest.mock('../../mastra/evals/eval-sets', () => ({
  evalSetsFor: () => [],
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
// The run host is the sessions service's; here it is a fake.
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
  RUN_HOST_ID_PREFIX: 'run-',
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import { CODE_WORKFLOWS } from '../../mastra/workflows/workflow-catalog';
import { ContractViolationError } from '../../mastra/workflows/workflow-contract';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from '../agents/agents.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { QueryEvidenceService } from '../sessions/query-evidence/query-evidence.service';
import type { WorkflowRun, WorkflowRunDoc } from './workflow-run-steps';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import { LiveRuns } from './live-runs';
import {
  WorkflowRunsService,
  type RunStreamEvent,
} from './workflow-runs.service';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowNodeChatsService } from './workflow-node-chats.service';
import { WorkflowNodeChatsRepository } from './repositories/workflow-node-chats.repository';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

function fakeAgent(name: string, tools: string[]) {
  return {
    id: name,
    name,
    getDescription: () => `${name} description`,
    listTools: () =>
      Object.fromEntries(tools.map((tool) => [tool, { description: tool }])),
    getInstructions: () => '',
    getMemory: () => undefined,
    getModel: () => {
      throw new Error('no LLM settings');
    },
  };
}

/** One engine step event, as the turn's `onStep` receives it. */
type StepEvent = {
  type: string;
  payload: {
    id: string;
    status?: string;
    payload?: unknown;
    output?: unknown;
    error?: unknown;
  };
};

const stepStart = (id: string, payload?: unknown): StepEvent => ({
  type: 'workflow-step-start',
  payload: { id, ...(payload === undefined ? {} : { payload }) },
});
const stepResult = (id: string, output: unknown): StepEvent => ({
  type: 'workflow-step-result',
  payload: { id, status: 'success', output },
});

/** What the Analyse step of `answer-business-question` (and agent-turn's Answer) ends with. */
const ANALYSE_OUTPUT = { calls: [], stopped: false };
/** What Wrap up ends with: the run's output. */
const WRAP_UP_OUTPUT = {
  sqlQueries: 0,
  failedQueries: 0,
  rows: 0,
  answer: 'Brazil won.',
};
/** What Plan, Validate and Write answer end with. */
const PLAN_OUTPUT = { plan: { needsClarification: false } };
const VALIDATE_OUTPUT = { ok: true, attempt: 1, findings: [] };
const ANSWER_OUTPUT = { headline: 'Brazil won.', answer: 'Brazil won.' };

/** The steps `answer-business-question` reports before its agent step's turn streams. */
const V2_STEPS_BEFORE: StepEvent[] = [
  stepStart('receive-question', {
    question: 'Who won in 2002?',
    datasets: ['World Cup Core'],
  }),
  stepResult('receive-question', { question: 'Who won in 2002?' }),
  stepStart('load-catalog', { question: 'Who won in 2002?' }),
  stepResult('load-catalog', { entities: 1 }),
  stepStart('plan', { question: 'Who won in 2002?' }),
  stepResult('plan', PLAN_OUTPUT),
  stepStart('analyse', { question: 'Who won in 2002?' }),
];

const DATASETS = [
  { name: 'World Cup Core', datasourceKind: 'postgres' },
  { name: 'Claims', datasourceKind: 'databricks' },
];

/**
 * What the fake run host's turn does. A `answer-business-question` host reports its four
 * steps as the engine does (Receive question and Load catalog, then Analyse
 * around the turn's events, then Wrap up); a draft host, agent-turn's one
 * Answer step.
 */
interface TurnScript {
  events?: { type: string; content?: string }[];
  /** The step events before the turn's events (default: the engine's). */
  steps?: StepEvent[];
  throws?: Error;
  /** Abort the run mid-turn, as a closed connection does. */
  abort?: AbortController;
  answer?: string;
  /** The answer's data records. */
  data?: unknown[];
  /** The visual Build visual stored (its step runs after Write answer). */
  visual?: { visualId: string; title: string };
}

function build(
  datasets: { name: string; datasourceKind?: string }[] = DATASETS,
  script: TurnScript = {},
) {
  const db = new BetterSqlite3(':memory:');
  const userAgents = new UserAgentsService(
    new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
    new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings')),
    {
      list: jest.fn().mockResolvedValue(datasets),
    } as unknown as DatasetsRepository,
    new SkillsRepository(new SqliteDocStore<SkillDoc>(db, 'skills')),
  );
  const registry = {
    'sql-fixer': fakeAgent('SQL Fixer', ['b']),
    assistant: fakeAgent('Questions to Insights Assistant', [
      'run_readonly_sql',
      'ask_clarification',
    ]),
    'insights-analyst': fakeAgent('Insights Analyst', ['run_readonly_sql']),
    'data-readiness': fakeAgent('Data Readiness Agent', ['assess_readiness']),
  };
  const deleteMemoryThread = jest.fn().mockResolvedValue(undefined);
  const deleteMemoryResource = jest.fn().mockResolvedValue(undefined);
  const mastra = {
    listAgents: () => registry,
    deleteMemoryThread,
    deleteMemoryResource,
  } as unknown as MastraService;
  const agents = new AgentsService(mastra, userAgents);
  const workflows = new WorkflowsService(agents);
  let hostMessages: {
    role: string;
    content: string;
    at: string;
    data?: unknown[];
  }[] = [];
  let draftHost = false;
  let orchestratedHost = false;
  const sessions = {
    createRunHost: jest.fn(
      (spec: {
        runId: string;
        workflowId?: string;
        draftAgentId?: string;
        context?: { question: string; answer: string };
        transcript?: { role: string; content: string }[];
        image?: unknown;
        inputFiles?: { path: string; data: Buffer }[];
        inputImages?: string[];
      }) => {
        draftHost = !!spec.draftAgentId;
        orchestratedHost = spec.workflowId === 'orchestrated-answer';
        hostMessages = spec.transcript
          ? spec.transcript.map((m) => ({ ...m, at: 't' }))
          : spec.context
            ? [
                { role: 'user', content: spec.context.question, at: 't' },
                { role: 'assistant', content: spec.context.answer, at: 't' },
              ]
            : [];
        return Promise.resolve({ id: `run-${spec.runId}` });
      },
    ),
    streamRunTurn: jest.fn(
      async (
        _hostId: string,
        question: string,
        emit: (event: unknown) => void,
        _signal: AbortSignal | undefined,
        _careful: boolean,
        onStep: (event: unknown) => void,
      ) => {
        hostMessages.push({ role: 'user', content: question, at: 't' });
        if (orchestratedHost) {
          // Avery's one step: Orchestrate.
          onStep(stepStart('orchestrate', { question }));
          for (const event of script.events ?? []) emit(event);
          const answer = script.answer ?? 'Brazil won.';
          onStep(stepResult('orchestrate', { answer }));
          hostMessages.push({ role: 'assistant', content: answer, at: 't' });
          emit({ type: 'done', session: { id: 'host' } });
          return;
        }
        const agentStep = draftHost ? 'answer' : 'analyse';
        for (const step of script.steps ??
          (draftHost ? [stepStart('answer')] : V2_STEPS_BEFORE)) {
          onStep(step);
        }
        for (const event of script.events ?? []) emit(event);
        if (script.abort) {
          script.abort.abort();
          return;
        }
        if (script.throws) throw script.throws;
        onStep(stepResult(agentStep, ANALYSE_OUTPUT));
        if (!draftHost) {
          onStep(stepStart('validate', ANALYSE_OUTPUT));
          onStep(stepResult('validate', VALIDATE_OUTPUT));
          onStep(stepStart('write-answer', VALIDATE_OUTPUT));
          onStep(stepResult('write-answer', ANSWER_OUTPUT));
          if (script.visual) {
            onStep(stepStart('build-visual', ANSWER_OUTPUT));
            onStep(
              stepResult('build-visual', {
                ...ANSWER_OUTPUT,
                visual: script.visual,
              }),
            );
          }
          onStep(stepStart('wrap-up', ANSWER_OUTPUT));
          onStep(stepResult('wrap-up', WRAP_UP_OUTPUT));
        }
        hostMessages.push({
          role: 'assistant',
          content: script.answer ?? 'Brazil won.',
          at: 't',
          ...(script.data ? { data: script.data } : {}),
        });
        emit({ type: 'done', session: { id: 'host' } });
        await Promise.resolve();
      },
    ),
    finishRunHost: jest.fn(() =>
      Promise.resolve({
        id: 'host',
        name: 'Insights Analyst',
        datasets: ['World Cup Core'],
        messages: hostMessages,
        visualizations: [],
        panelItems: [],
        workflowRef: {
          id: 'answer-business-question',
          name: 'Answer a Business Question',
          kind: 'code',
          deleted: false,
        },
      }),
    ),
    deleteRunHostResources: jest.fn().mockResolvedValue(undefined),
    // The draft's name and existing datasets are the sessions service's.
    draftRunTarget: jest.fn((agentId: string) => {
      if (agentId === 'missing') {
        return Promise.reject(
          new NotFoundException('Agent "missing" not found'),
        );
      }
      if (agentId === 'no-data') {
        return Promise.reject(
          new BadRequestException('Select at least one dataset to preview'),
        );
      }
      return Promise.resolve({
        name: 'Sales helper',
        datasets: ['World Cup Core'],
      });
    }),
    // The rating itself is the sessions service's (its own spec proves it).
    rateRunAnswer: jest.fn(
      (
        _runId: string,
        host: { messages: { role: string; at: string }[] },
        messageAt: string,
        rating: string,
      ) =>
        Promise.resolve({
          ...host.messages.find(
            (m) => m.at === messageAt && m.role === 'assistant',
          ),
          feedback: rating,
          ...(rating === 'up' ? { verified: true } : {}),
        }),
    ),
    runHostWorkspaceIds: jest.fn((): string[] => []),
    // A run's input image from its host's workspace: gone unless a test sets it.
    runHostImage: jest.fn<
      Promise<{ data: Buffer; mediaType: string }>,
      [hostId: string, path: string]
    >(() => Promise.reject(new Error('gone'))),
    // A run-backed host as the API shows it (api.md 2.1): derived fields.
    toView: jest.fn((host: { id: string; panelItems?: unknown[] }) =>
      Promise.resolve({
        ...host,
        panelItems: host.panelItems ?? [],
        workflow: { phases: [], source: 'workflow' },
        agent: {
          id: 'insights-analyst',
          name: 'Insights Analyst',
          deleted: false,
        },
      }),
    ),
    panelItemFileOf: jest.fn(() =>
      Promise.resolve({
        item: { id: 'p1' },
        contentType: 'text/plain',
        text: 'hi',
      }),
    ),
    downloadPanelItemOf: jest.fn(() =>
      Promise.resolve({
        filename: 'notes.md',
        contentType: 'text/markdown',
        body: Buffer.from('# Notes'),
      }),
    ),
    getVisualizationOf: jest.fn(() =>
      Promise.resolve({ id: 'v1', document: '<html>', version: 1 }),
    ),
    // The visual pipeline itself is the sessions service's; here it answers
    // what each action would: new metadata, the version to show, the event.
    runVisualAction: jest.fn(
      (
        _host: unknown,
        action: { kind: string; visualId?: string; version?: number },
      ) => {
        const visualId = action.visualId ?? 'vis-1';
        const version =
          action.kind === 'create' ? 1 : action.kind === 'revert' ? 1 : 2;
        const metadata = {
          id: visualId,
          title: 'Goals by team',
          description: '',
          path: `visuals/${visualId}`,
          sourceMessageAt: 't',
          createdAt: 't',
          currentVersion: version,
        };
        const named: Record<string, string> = {
          create: 'created',
          tailor: 'updated',
          revert: 'reverted',
        };
        return Promise.resolve({
          metadata,
          version,
          panelItems: [
            {
              id: `visual:${visualId}`,
              kind: 'visual',
              title: 'Goals by team',
              shownAt: 't',
              visualId,
            },
          ],
          ...(named[action.kind]
            ? {
                event: {
                  visualId,
                  version,
                  title: 'Goals by team',
                  action: named[action.kind],
                },
              }
            : {}),
        });
      },
    ),
    downloadVisualizationOf: jest.fn(() =>
      Promise.resolve({
        filename: 'goals-v1.zip',
        archive: Buffer.from('zip'),
      }),
    ),
  };
  const datasetsRepository = {
    list: jest.fn().mockResolvedValue(datasets),
  } as unknown as DatasetsRepository;
  const repository = new WorkflowRunsRepository(
    new SqliteDocStore(db, 'workflow_runs'),
  );
  const nodeChats = new WorkflowNodeChatsRepository(
    new SqliteDocStore(db, 'workflow_run_node_chats'),
  );
  // The query inspector's queries (api.md 139-143); its own spec proves them.
  const queryEvidence = {
    prepare: jest.fn().mockResolvedValue(null),
    rerun: jest.fn(),
    exportRows: jest.fn(),
  };
  const service = new WorkflowRunsService(
    workflows,
    sessions as unknown as SessionsService,
    datasetsRepository,
    mastra,
    repository,
    nodeChats,
    queryEvidence as unknown as QueryEvidenceService,
    // No stored artifact: no workflow here takes one.
    { list: () => Promise.resolve([]) } as never,
  );
  return {
    db,
    service,
    repository,
    nodeChats,
    queryEvidence,
    deleteMemoryThread,
    deleteMemoryResource,
    /** The same store and collaborators after a backend restart. */
    restarted: () =>
      new WorkflowRunsService(
        workflows,
        sessions as unknown as SessionsService,
        datasetsRepository,
        mastra,
        new WorkflowRunsRepository(new SqliteDocStore(db, 'workflow_runs')),
        nodeChats,
        queryEvidence as unknown as QueryEvidenceService,
        { list: () => Promise.resolve([]) } as never,
      ),
    sessions,
    userAgents,
    workflows,
  };
}

/** The step ids and statuses of a run's `step` events, in order. */
const stepTrail = (events: RunStreamEvent[]) =>
  events.flatMap((event) =>
    event.type === 'step' ? [`${event.id}:${event.status}`] : [],
  );

/** Run a workflow through the streamed path and collect its events. */
async function streamed(
  ctx: ReturnType<typeof build>,
  id: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ events: RunStreamEvent[]; run: WorkflowRun }> {
  const events: RunStreamEvent[] = [];
  const prepared = await ctx.service.prepare(id, body);
  const run = await ctx.service.stream(prepared, (e) => events.push(e), signal);
  return { events, run };
}

describe('WorkflowRunsService: refusals before anything runs (api.md 119; plan 4.1)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const refuse = async (id: string, body: unknown, message: string) => {
    const refusal = ctx.service.prepare(id, body);
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow(message);
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  };

  it.each([
    [{}, 'Question is required'],
    [
      { input: { question: '   ', datasets: ['Claims'] } },
      'Question is required',
    ],
    [{ input: { datasets: ['Claims'] } }, 'Question is required'],
    [{ input: { question: 'Who won?' } }, 'Select at least one dataset'],
    [
      { input: { question: 'Who won?', datasets: [] } },
      'Select at least one dataset',
    ],
    [
      { input: { question: 'Who won?', datasets: ['Nope'] } },
      'Dataset "Nope" not found',
    ],
  ])('Insights Analyst refuses %p with %p', async (body, message) => {
    ctx = build();
    await refuse('answer-business-question', body, message);
  });

  it('refuses the whole input at once: every error in field order, then the context, nothing stored', async () => {
    ctx = build();
    const refusal = await ctx.service
      .prepare('answer-business-question', {
        input: { question: ' \n ', datasets: [] },
        context: { fromRunId: 'nope' },
      })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(BadRequestException);
    expect((refusal as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Question is required',
      errors: [
        { field: 'question', message: 'Question is required' },
        { field: 'datasets', message: 'Select at least one dataset' },
        { field: null, message: 'Run "nope" not found' },
      ],
    });
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
    expect(await ctx.repository.list()).toEqual([]);
  });

  it('refuses a question over 4000 characters', async () => {
    ctx = build();
    await refuse(
      'answer-business-question',
      { input: { question: 'x'.repeat(4001), datasets: ['Claims'] } },
      'Question must be at most 4000 characters',
    );
  });

  it('answers 404 for a workflow the catalogue does not list, the removed ones included (1.23.35)', async () => {
    ctx = build();
    const live = await ctx.userAgents.create({
      name: 'Historian',
      description: '',
      instructions: '',
      datasets: ['World Cup Core'],
      starterQuestions: [],
    });
    await ctx.userAgents.publish(live.id);
    for (const id of [
      'agent:assistant',
      'agent:data-readiness',
      `agent:${live.id}`,
      'seq-text-demo',
      'deep-analysis',
      'agent:rfp',
      'nope',
      'agent:sql-fixer',
      'agent-turn',
    ]) {
      const refusal = ctx.service.prepare(id, {
        input: { question: 'Who won?', datasets: ['Claims'], text: 'Hi' },
      });
      await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
      await expect(refusal).rejects.toThrow(`Workflow "${id}" not found`);
    }
    await expect(
      ctx.service.run('seq-text-demo', { input: { text: 'Hi' } }),
    ).rejects.toThrow('Workflow "seq-text-demo" not found');
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
    expect(await ctx.repository.list()).toEqual([]);
  });

  it("refuses a workflow that has no input fields: it can't run on an input", async () => {
    ctx = build();
    jest.spyOn(ctx.workflows, 'definition').mockResolvedValue({
      id: 'x',
      input: [],
    } as never);
    await refuse('x', { input: {} }, 'Workflow "x" can\'t run on an input');
  });

  it('refuses a context naming a run it does not hold', async () => {
    ctx = build();
    await refuse(
      'answer-business-question',
      {
        input: { question: 'And 2018?', datasets: ['Claims'] },
        context: { fromRunId: 'gone' },
      },
      'Run "gone" not found',
    );
  });
});

describe('WorkflowRunsService: an Answer a Business Question run (agents.md 5.14)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = {
    question: '  Who won in 2002?  ',
    datasets: ['World Cup Core'],
  };

  it('runs one turn on a fresh run host, forwards its events and ends with done carrying the run', async () => {
    ctx = build(DATASETS, {
      events: [
        { type: 'tool', content: '{"name":"run_readonly_sql"}' },
        { type: 'text', content: 'Brazil won.' },
      ],
    });
    const { events, run } = await streamed(ctx, 'answer-business-question', {
      input: { ...ASK, careful: true, extra: 'ignored' },
    });

    expect(ctx.sessions.createRunHost).toHaveBeenCalledWith({
      runId: run.id,
      workflowId: 'answer-business-question',
      name: 'Answer a Business Question',
      datasets: ['World Cup Core'],
      // Build visual is on unless the run turns it off (workflows R41),
      // and so is Approve each step (workflows R44).
      buildVisual: true,
      approveSteps: true,
    });
    // Careful is no field of v2's input: the turn runs without it.
    // The turn runs on its own signal: the no-progress watchdog's.
    expect(ctx.sessions.streamRunTurn).toHaveBeenCalledWith(
      `run-${run.id}`,
      'Who won in 2002?',
      expect.any(Function),
      expect.any(AbortSignal),
      false,
      expect.any(Function),
    );
    // The host is discarded once, after the turn.
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledTimes(1);
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledWith(`run-${run.id}`);
    expect(
      events.map((event) =>
        event.type === 'step' ? `${event.id}:${event.status}` : event.type,
      ),
    ).toEqual([
      'run',
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'plan:running',
      'plan:success',
      'analyse:running',
      'tool',
      'text',
      'analyse:success',
      'validate:running',
      'validate:success',
      'write-answer:running',
      'write-answer:success',
      'wrap-up:running',
      'wrap-up:success',
      // The steps the run never took end skipped: Read images (no image
      // attached).
      'read-images:skipped',
      'build-visual:skipped',
      'done',
    ]);
    expect(events[0]).toEqual({
      type: 'run',
      runId: run.id,
      workflowId: 'answer-business-question',
    });
    // Each step carries what it received and when it started.
    expect(events[1]).toEqual({
      type: 'step',
      id: 'receive-question',
      title: 'Receive question',
      status: 'running',
      input: { question: 'Who won in 2002?', datasets: ['World Cup Core'] },
      startedAt: expect.any(String) as string,
    });
    expect(events[10]).toEqual({
      type: 'step',
      id: 'analyse',
      title: 'Analyse',
      status: 'success',
      // A step inside the analysis loop carries its attempt (api.md 3.6).
      attempt: 1,
      input: { question: 'Who won in 2002?' },
      output: ANALYSE_OUTPUT,
      startedAt: expect.any(String) as string,
      endedAt: expect.any(String) as string,
      // The turn's `tool` event is the step's call; no result came for it.
      toolCalls: [{ tool: 'run_readonly_sql' }],
      // Its story is told as it ends (ui.md 4.4b, Logs Story).
      story: {
        headline: 'Ran 1 query on the data.',
        brief: '1 query',
        stats: [{ value: '1', label: 'query' }],
        source: 'step',
      },
    });
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(run).toMatchObject({
      workflowId: 'answer-business-question',
      workflowName: 'Answer a Business Question',
      input: {
        question: '  Who won in 2002?  ',
        datasets: ['World Cup Core'],
      },
      status: 'success',
      steps: [
        { id: 'read-images', status: 'skipped' },
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success', output: { entities: 1 } },
        { id: 'plan', status: 'success', output: PLAN_OUTPUT },
        {
          id: 'analyse',
          title: 'Analyse',
          status: 'success',
          attempt: 1,
          output: ANALYSE_OUTPUT,
        },
        { id: 'validate', status: 'success', attempt: 1 },
        { id: 'write-answer', status: 'success', output: ANSWER_OUTPUT },
        { id: 'build-visual', status: 'skipped' },
        { id: 'wrap-up', status: 'success', output: WRAP_UP_OUTPUT },
      ],
      output: WRAP_UP_OUTPUT,
      question: 'Who won in 2002?',
      answer: { role: 'assistant', content: 'Brazil won.' },
      datasets: ['World Cup Core'],
      panelItems: [],
      visualizations: [],
    });
    expect(run.input).not.toHaveProperty('careful');
    expect(run.finishedAt).toBeDefined();
    // Every step that ran has its start and end times, the end never before
    // the start; the skipped steps have none.
    for (const step of run.steps.filter((s) => s.status !== 'skipped')) {
      expect(Date.parse(step.endedAt!)).toBeGreaterThanOrEqual(
        Date.parse(step.startedAt!),
      );
    }
    await expect(ctx.service.get(run.id)).resolves.toEqual(run);
  });

  it("attaches the turn's tool calls to its running agent step, in the step events and the stored run", async () => {
    ctx = build(DATASETS, {
      steps: [
        stepStart('analyse', {
          question: 'Who won?',
          datasets: ['World Cup Core'],
        }),
      ],
      events: [
        {
          type: 'tool',
          content: JSON.stringify({ name: 'run_readonly_sql', input: 'wins' }),
        },
        {
          type: 'tool-result',
          content: JSON.stringify({
            tool: 'run_readonly_sql',
            input: 'SELECT winner FROM matches',
            rowCount: 1,
          }),
        },
        {
          type: 'tool',
          content: JSON.stringify({ name: 'run_readonly_sql', input: 'x' }),
        },
        {
          type: 'tool-result',
          content: JSON.stringify({
            tool: 'run_readonly_sql',
            input: 'SELECT nope',
            error: 'column "nope" does not exist',
          }),
        },
      ],
    });
    const { events, run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const calls = [
      {
        tool: 'run_readonly_sql',
        input: 'SELECT winner FROM matches',
        rowCount: 1,
        durationMs: expect.any(Number) as number,
      },
      {
        tool: 'run_readonly_sql',
        input: 'SELECT nope',
        error: 'column "nope" does not exist',
        durationMs: expect.any(Number) as number,
      },
    ];
    const steps = events.filter(
      (event) => event.type === 'step' && event.id === 'analyse',
    );
    expect(steps[0]).toMatchObject({
      status: 'running',
      input: { question: 'Who won?', datasets: ['World Cup Core'] },
    });
    expect(steps[0]).not.toHaveProperty('toolCalls');
    expect(steps[1]).toMatchObject({
      status: 'success',
      input: { question: 'Who won?', datasets: ['World Cup Core'] },
      toolCalls: calls,
    });
    const analyse = (doc: { steps: WorkflowRun['steps'] } | null) =>
      doc?.steps.find((step) => step.id === 'analyse');
    expect(analyse(run)?.toolCalls).toEqual(calls);
    // A code step makes no calls.
    expect(run.steps.find((s) => s.id === 'wrap-up')).not.toHaveProperty(
      'toolCalls',
    );
    const stored = await ctx.repository.get(run.id);
    expect(analyse(stored)).toMatchObject({
      input: { question: 'Who won?', datasets: ['World Cup Core'] },
      startedAt: expect.any(String) as string,
      endedAt: expect.any(String) as string,
      toolCalls: calls,
    });
  });

  it('ends with error, as the chat stream does, when the turn fails; the host is still discarded', async () => {
    ctx = build(DATASETS, {
      throws: new Error('The endpoint rejected the API key (401)'),
    });
    const { events, run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    expect(events.at(-1)).toEqual({
      type: 'error',
      content: 'The endpoint rejected the API key (401)',
    });
    expect(events.some((event) => event.type === 'done')).toBe(false);
    expect(run).toMatchObject({
      status: 'failed',
      error: 'The endpoint rejected the API key (401)',
      steps: [
        { id: 'read-images', status: 'skipped' },
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'plan', status: 'success' },
        {
          id: 'analyse',
          status: 'failed',
          attempt: 1,
          error: 'The endpoint rejected the API key (401)',
        },
        { id: 'validate', status: 'skipped' },
        { id: 'write-answer', status: 'skipped' },
        { id: 'build-visual', status: 'skipped' },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
    expect(stepTrail(events).slice(-5)).toEqual([
      'analyse:failed',
      'validate:skipped',
      'write-answer:skipped',
      'build-visual:skipped',
      'wrap-up:skipped',
    ]);
    expect(run.answer).toBeUndefined();
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledTimes(1);
  });

  it('a stopped run sends nothing after the stop and is held as stopped', async () => {
    const abort = new AbortController();
    ctx = build(DATASETS, {
      abort,
      events: [{ type: 'text', content: 'Bra' }],
    });
    const { events, run } = await streamed(
      ctx,
      'answer-business-question',
      { input: ASK },
      abort.signal,
    );
    // What streamed before the stop was sent; nothing after it.
    expect(
      events.map((event) =>
        event.type === 'step' ? `${event.id}:${event.status}` : event.type,
      ),
    ).toEqual([
      'run',
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'plan:running',
      'plan:success',
      'analyse:running',
      'text',
    ]);
    expect(run.status).toBe('stopped');
    // A step the stop kept from running says so (ui.md 4.4b, the node Story).
    const notReached = {
      headline: 'Did not run: the run was stopped before it got here.',
      brief: 'Not reached',
      source: 'generic',
    };
    expect(run.steps.slice(4)).toEqual([
      {
        id: 'analyse',
        title: 'Analyse',
        status: 'stopped',
        attempt: 1,
        input: { question: 'Who won in 2002?' },
        startedAt: expect.any(String) as string,
        endedAt: expect.any(String) as string,
        story: {
          headline: 'You stopped the analysis before it ran a query.',
          brief: 'No queries',
          stats: [{ value: '0', label: 'queries' }],
          source: 'step',
        },
      },
      {
        id: 'validate',
        title: 'Validate',
        status: 'skipped',
        story: notReached,
      },
      {
        id: 'write-answer',
        title: 'Write answer',
        status: 'skipped',
        story: notReached,
      },
      {
        id: 'build-visual',
        title: 'Build visual',
        status: 'skipped',
        // On by default: a stopped run did not get there.
        story: notReached,
      },
      { id: 'wrap-up', title: 'Wrap up', status: 'skipped', story: notReached },
    ]);
    // The turn's own signal aborts with the request's.
    expect(ctx.sessions.streamRunTurn.mock.calls[0][3]?.aborted).toBe(true);
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledTimes(1);
  });

  it("gives a later run the earlier run's question and answer as context (plan 5.4)", async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const second = await streamed(ctx, 'answer-business-question', {
      input: { question: 'And in 2014?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    expect(ctx.sessions.createRunHost).toHaveBeenLastCalledWith({
      runId: second.run.id,
      workflowId: 'answer-business-question',
      name: 'Answer a Business Question',
      datasets: ['World Cup Core'],
      buildVisual: true,
      approveSteps: true,
      context: {
        question: 'Who won in 2002?',
        answer: 'Brazil won in 2002.',
      },
      // Its agents go on from copies of the earlier run's threads.
      continuesThreadsOf: `run-${first.run.id}`,
    });
    expect(second.run.context).toEqual({ fromRunId: first.run.id });
    // The answer is this run's, never the context's.
    expect(second.run.answer?.content).toBe('Brazil won in 2002.');
    expect(second.run.question).toBe('And in 2014?');
  });

  it("hands a later run the earlier answer's queries to explore (agents.md 3.15; plan 2)", async () => {
    ctx = build(DATASETS, {
      answer: 'Brazil won in 2002.',
      data: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT year, winner FROM wc.public.cups',
          columns: ['year', 'winner'],
          rows: [
            { year: 2002, winner: 'Brazil' },
            { year: 2006, winner: 'Italy' },
          ],
          rowCount: 2,
          rationale: 'Every winner.',
        },
        { tool: 'run_readonly_sql', input: 'SELECT nope', error: 'boom' },
        {
          tool: 'sample_rows',
          input: 'wc.public.cups',
          columns: ['year'],
          rows: [{ year: 1930 }],
        },
      ],
    });
    const first = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await streamed(ctx, 'answer-business-question', {
      input: { question: 'Only Italy', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    const spec = ctx.sessions.createRunHost.mock.lastCall?.[0] as {
      contextQueries?: unknown[];
    };
    expect(spec.contextQueries).toEqual([
      {
        ref: 'Q1',
        sql: 'SELECT year, winner FROM wc.public.cups',
        columns: ['year', 'winner'],
        kinds: { year: 'number', winner: 'text' },
        sampleValues: { year: [2002, 2006], winner: ['Brazil', 'Italy'] },
        rationale: 'Every winner.',
        // The number the reader saw it under (agent-answers R69).
        source: 1,
      },
    ]);
  });

  it('rates the stored answer of a run (api.md 128)', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });

    const up = await ctx.service.rateAnswer(first.run.id, 'up');
    expect(ctx.sessions.rateRunAnswer).toHaveBeenCalledWith(
      first.run.id,
      expect.objectContaining({ id: `run-${first.run.id}` }),
      first.run.answer?.at,
      'up',
    );
    expect(up.answer).toMatchObject({ feedback: 'up', verified: true });
    // Stored: a later read still shows the rating.
    expect((await ctx.service.get(first.run.id)).answer?.feedback).toBe('up');
  });

  it('refuses to rate a run without an answer', async () => {
    const abort = new AbortController();
    ctx = build(DATASETS, { abort });
    const stopped = await streamed(
      ctx,
      'answer-business-question',
      { input: ASK },
      abort.signal,
    );
    await expect(ctx.service.rateAnswer(stopped.run.id, 'up')).rejects.toThrow(
      'has no answer',
    );
  });

  it('a context run carries the earlier question and answer only, never its stages or a legacy RFP id', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const finishView = ctx.sessions.finishRunHost.getMockImplementation()!;
    ctx.sessions.finishRunHost.mockImplementationOnce(async () => ({
      ...(await finishView()),
      rfpId: 'rfp-1',
      workflowState: { current: 2, done: [1], updatedAt: 't' },
    }));
    const first = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await streamed(ctx, 'answer-business-question', {
      input: { question: 'And in 2014?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    const spec = ctx.sessions.createRunHost.mock.lastCall?.[0];
    expect(spec).not.toHaveProperty('workflowState');
    expect(spec).not.toHaveProperty('rfpId');
    expect(spec).toMatchObject({
      context: { question: 'Who won in 2002?', answer: 'Brazil won in 2002.' },
    });
  });

  it('refuses a context run that has no answer', async () => {
    const abort = new AbortController();
    ctx = build(DATASETS, { abort });
    const stopped = await streamed(
      ctx,
      'answer-business-question',
      { input: ASK },
      abort.signal,
    );
    await expect(
      ctx.service.prepare('answer-business-question', {
        input: ASK,
        context: { fromRunId: stopped.run.id },
      }),
    ).rejects.toThrow(`Run "${stopped.run.id}" has no answer to continue from`);
  });

  it('POST /runs (118) answers the run as the stream ends it, and stores it', async () => {
    ctx = build();
    const run = await ctx.service.run('answer-business-question', {
      input: ASK,
    });
    expect(run).toMatchObject({
      workflowId: 'answer-business-question',
      status: 'success',
      answer: { content: 'Brazil won.' },
      output: WRAP_UP_OUTPUT,
    });
    await expect(ctx.service.get(run.id)).resolves.toEqual(run);
    // A refusal stores nothing.
    await expect(
      ctx.service.run('answer-business-question', {}),
    ).rejects.toThrow('Question is required');
    expect(await ctx.repository.list()).toHaveLength(1);
  });

  it('stores a run when it starts, as running, and step by step as it ends', async () => {
    ctx = build();
    const atStart: unknown[] = [];
    const prepared = await ctx.service.prepare('answer-business-question', {
      input: ASK,
    });
    const run = await ctx.service.stream(prepared, (event) => {
      if (event.type === 'run') {
        void ctx.repository.get(event.runId).then((doc) => atStart.push(doc));
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(atStart[0]).toMatchObject({ id: run.id, status: 'running' });
    const stored = await ctx.repository.get(run.id);
    expect(stored).toMatchObject({ status: 'success', output: WRAP_UP_OUTPUT });
    // Each stored step that ran keeps what it received and its times.
    for (const step of stored!.steps.filter((s) => s.status !== 'skipped')) {
      expect(step.input).toBeDefined();
      expect(Date.parse(step.startedAt!)).not.toBeNaN();
      expect(Date.parse(step.endedAt!)).toBeGreaterThanOrEqual(
        Date.parse(step.startedAt!),
      );
    }
  });
});

describe('WorkflowsController POST /workflows/:id/runs/stream (api.md 119)', () => {
  it('answers a refusal with its status before any stream, and streams SSE frames otherwise', async () => {
    const run = { id: 'r1', status: 'success' };
    const live = new LiveRuns();
    const runs = {
      prepare: jest.fn((id: string, body: { input?: { question?: string } }) =>
        id !== 'answer-business-question'
          ? Promise.reject(new NotFoundException(`Workflow "${id}" not found`))
          : body.input?.question
            ? Promise.resolve({ id })
            : Promise.reject(new BadRequestException('Question is required')),
      ),
      live,
      // The run starts detached (ADR-0048); the request follows its log.
      launch: jest.fn(() => {
        live.begin('r1');
        live.publish('r1', {
          type: 'run',
          runId: 'r1',
          workflowId: 'answer-business-question',
        });
        live.publish('r1', { type: 'text', content: 'Hi' });
        live.publish('r1', { type: 'done', run });
        live.end('r1');
        return Promise.resolve('r1');
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [
        { provide: WorkflowsService, useValue: {} },
        { provide: WorkflowRunsService, useValue: runs },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .post('/workflows/answer-business-question/runs/stream')
        .send({ input: {} })
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({ message: 'Question is required' }),
        );
      await request(server)
        .post('/workflows/agent%3Aassistant/runs/stream')
        .send({ input: { question: 'Hi' } })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Workflow "agent:assistant" not found',
          }),
        );
      expect(runs.launch).not.toHaveBeenCalled();
      const res = await request(server)
        .post('/workflows/answer-business-question/runs/stream')
        .send({ input: { question: 'Hi' } })
        .expect(200);
      expect(res.headers['content-type']).toBe(
        'text/event-stream; charset=utf-8',
      );
      expect(res.text).toBe(
        [
          'data: {"seq":1,"type":"run","runId":"r1","workflowId":"answer-business-question"}',
          'data: {"seq":2,"type":"text","content":"Hi"}',
          'data: {"seq":3,"type":"done","run":{"id":"r1","status":"success"}}',
        ]
          .map((frame) => `${frame}\n\n`)
          .join(''),
      );
      expect(runs.prepare).toHaveBeenLastCalledWith(
        'answer-business-question',
        {
          input: { question: 'Hi' },
        },
      );
    } finally {
      await app.close();
    }
  });
});

describe('WorkflowRunsService: Build visual (agents.md 5.11, workflows R41)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());
  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };
  const METADATA = {
    id: 'v-1',
    title: 'Wins per team',
    description: '',
    path: 'visuals/v-1',
    sourceMessageAt: 't',
    createdAt: 't',
    currentVersion: 1,
    versions: [],
  };

  it('logs the creation of the visual the step stored beside the answer', async () => {
    ctx = build(DATASETS, {
      visual: { visualId: 'v-1', title: 'Wins per team' },
    });
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.resolve({
        id: 'host',
        name: 'Insights Analyst',
        datasets: ['World Cup Core'],
        messages: [],
        visualizations: [METADATA],
        panelItems: [],
      } as never),
    );
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    expect(run.visualizations?.map((v) => v.id)).toEqual(['v-1']);
    expect(run.events).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Created interactive visual "Wins per team" (v1).',
        visual: {
          visualId: 'v-1',
          version: 1,
          title: 'Wins per team',
          action: 'created',
        },
      }),
    ]);
  });

  it('logs nothing when the step names a visual the host does not hold', async () => {
    ctx = build(DATASETS, { visual: { visualId: 'gone', title: 'Gone' } });
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    expect(run.events ?? []).toEqual([]);
  });

  it('logs nothing when the run built no visual', async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    expect(run.events ?? []).toEqual([]);
  });
});

describe('WorkflowRunsService: stored runs (data-model 3.16; plan 5.1, 5.3)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };

  it('stores a run when it starts, as running with its input and workflow', async () => {
    ctx = build();
    let atTurn: unknown;
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (hostId: string) => {
        atTurn = await ctx.repository.get(hostId.slice('run-'.length));
      },
    );
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    expect(atTurn).toMatchObject({
      id: run.id,
      workflowId: 'answer-business-question',
      workflowName: 'Answer a Business Question',
      input: ASK,
      status: 'running',
      steps: [],
      datasets: [],
      ownerId: 'local',
    });
    expect((atTurn as { startedAt?: string }).startedAt).toBe(run.startedAt);
  });

  it("stores the workflow's contractHash when the run starts, and done.run carries it (agents.md 5.12)", async () => {
    ctx = build();
    const { contractHash } = CODE_WORKFLOWS[0];
    expect(contractHash).toMatch(/^[0-9a-f]{12}$/);
    let atTurn: unknown;
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (hostId: string) => {
        atTurn = await ctx.repository.get(hostId.slice('run-'.length));
      },
    );
    const { run, events } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    expect(atTurn).toMatchObject({ contractHash });
    expect(run.contractHash).toBe(contractHash);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      run: { contractHash },
    });
    await expect(ctx.service.get(run.id)).resolves.toMatchObject({
      contractHash,
    });
  });

  it('stores a contract violation as the failed step and run error; later steps are skipped', async () => {
    const violation = new ContractViolationError(
      'Analyse',
      'output',
      'calls[2].rowCount',
      'Invalid input: expected number, received string',
    );
    ctx = build(DATASETS, { throws: violation });
    const failed = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const message =
      'Contract violation in Analyse: calls[2].rowCount Invalid input: expected number, received string';
    await expect(ctx.repository.get(failed.run.id)).resolves.toMatchObject({
      status: 'failed',
      error: message,
      steps: [
        { id: 'read-images', status: 'skipped' },
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'plan', status: 'success' },
        { id: 'analyse', status: 'failed', error: message },
        { id: 'validate', status: 'skipped' },
        { id: 'write-answer', status: 'skipped' },
        { id: 'build-visual', status: 'skipped' },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
  });

  it('updates it when it ends with the projection of the host; the derived views are not stored', async () => {
    ctx = build();
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.resolve({
        id: 'host',
        name: 'Data Readiness Agent',
        datasets: ['Claims'],
        messages: [
          { role: 'user', content: 'Assess Claims', at: 't1' },
          { role: 'assistant', content: 'Which client?', at: 't2' },
        ],
        agentKey: 'data-readiness',
        agentName: 'Data Readiness Agent',
        // A host shaped by an earlier version: its RFP id is not stored.
        rfpId: 'rfp-1',
        visualizations: [{ id: 'v1', title: 'Goals' }],
        panelItems: [
          {
            id: 'p1',
            kind: 'document',
            title: 'Notes',
            markdown: '#',
            shownAt: 't',
          },
        ],
        workflowState: { phases: [], updatedAt: 't' },
        workflow: { phases: [], source: 'agent' },
        agent: {
          id: 'data-readiness',
          name: 'Data Readiness Agent',
          deleted: false,
        },
        workflowRef: {
          id: 'agent:data-readiness',
          name: 'Data Readiness Agent',
          kind: 'agent',
          deleted: false,
        },
      } as never),
    );
    const { run, events } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const stored = await ctx.repository.get(run.id);
    expect(stored).toMatchObject({
      status: 'success',
      steps: [
        { id: 'read-images', status: 'skipped' },
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'plan', status: 'success' },
        { id: 'analyse', status: 'success' },
        { id: 'validate', status: 'success' },
        { id: 'write-answer', status: 'success' },
        { id: 'build-visual', status: 'skipped' },
        { id: 'wrap-up', status: 'success' },
      ],
      output: WRAP_UP_OUTPUT,
      question: 'Who won in 2002?',
      answer: { role: 'assistant', content: 'Which client?', at: 't2' },
      datasets: ['Claims'],
      agentKey: 'data-readiness',
      agentName: 'Data Readiness Agent',
      visualizations: [{ id: 'v1', title: 'Goals' }],
      panelItems: [{ id: 'p1', kind: 'document' }],
      workflowState: { phases: [], updatedAt: 't' },
    });
    expect(stored?.finishedAt).toBeDefined();
    expect(stored).not.toHaveProperty('rfpId');
    expect(stored).not.toHaveProperty('agent');
    expect(stored).not.toHaveProperty('workflow');
    expect(stored).not.toHaveProperty('workflowRef');
    // done.run is the stored run plus the derived views, read as GET reads it.
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(run).toMatchObject({
      id: stored?.id,
      agent: { id: 'insights-analyst' },
      workflow: { source: 'workflow' },
      panelItems: [{ id: 'p1' }],
    });
    expect(ctx.sessions.toView).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: `run-${run.id}`, run: true }),
    );
  });

  it('stores a failed run with its error, and a stopped one as stopped', async () => {
    ctx = build(DATASETS, { throws: new Error('Model error') });
    const failed = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await expect(ctx.repository.get(failed.run.id)).resolves.toMatchObject({
      status: 'failed',
      error: 'Model error',
      steps: [
        { id: 'read-images', status: 'skipped' },
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'plan', status: 'success' },
        { id: 'analyse', status: 'failed', error: 'Model error' },
        { id: 'validate', status: 'skipped' },
        { id: 'write-answer', status: 'skipped' },
        { id: 'build-visual', status: 'skipped' },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
    ctx.db.close();
    const abort = new AbortController();
    ctx = build(DATASETS, { abort });
    const stopped = await streamed(
      ctx,
      'answer-business-question',
      { input: ASK },
      abort.signal,
    );
    await expect(ctx.repository.get(stopped.run.id)).resolves.toMatchObject({
      status: 'stopped',
      steps: [
        { id: 'read-images', status: 'skipped' },
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'plan', status: 'success' },
        { id: 'analyse', status: 'stopped' },
        { id: 'validate', status: 'skipped' },
        { id: 'write-answer', status: 'skipped' },
        { id: 'build-visual', status: 'skipped' },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
  });

  it('stores the run as failed when ending the host throws, and rethrows', async () => {
    ctx = build();
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full')),
    );
    const prepared = await ctx.service.prepare('answer-business-question', {
      input: ASK,
    });
    let runId = '';
    await expect(
      ctx.service.stream(prepared, (event) => {
        if (event.type === 'run') runId = event.runId;
      }),
    ).rejects.toThrow('disk full');
    await expect(ctx.repository.get(runId)).resolves.toMatchObject({
      status: 'failed',
      error: 'disk full',
    });
  });

  it('takes a stored run as context after a restart (plan 5.4)', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const after = ctx.restarted();
    const prepared = await after.prepare('answer-business-question', {
      input: { question: 'And in 2014?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    expect(prepared.context).toEqual({
      fromRunId: first.run.id,
      question: 'Who won in 2002?',
      answer: 'Brazil won in 2002.',
    });
  });

  it('at start-up fails a run left running, deletes its memory thread and keeps its workspace; deletes orphan run workspaces', async () => {
    ctx = build();
    await ctx.repository.insert({
      id: 'left',
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      input: ASK,
      status: 'running',
      steps: [{ id: 'answer', title: 'Answer', status: 'running' }],
      datasets: [],
      startedAt: '2026-11-11T10:00:00.000Z',
    });
    await ctx.repository.insert({
      id: 'done',
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      input: ASK,
      status: 'success',
      steps: [],
      datasets: [],
      startedAt: '2026-11-11T09:00:00.000Z',
    });
    ctx.sessions.runHostWorkspaceIds.mockReturnValue([
      'run-left',
      'run-done',
      'run-orphan',
    ]);
    await ctx.service.onModuleInit();
    await expect(ctx.repository.get('left')).resolves.toMatchObject({
      status: 'failed',
      error: 'The app stopped before the run finished',
      steps: [
        {
          id: 'answer',
          status: 'failed',
          error: 'The app stopped before the run finished',
        },
      ],
    });
    await expect(ctx.repository.get('done')).resolves.toMatchObject({
      status: 'success',
    });
    // A failed run keeps its memory threads, as any finished run does.
    expect(ctx.deleteMemoryThread).not.toHaveBeenCalled();
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledTimes(1);
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
      'run-orphan',
    );
  });

  it('a start-up recovery that cannot list workspaces still fails the runs left running', async () => {
    ctx = build();
    await ctx.repository.insert({
      id: 'left',
      workflowId: 'seq-text-demo',
      workflowName: 'Sequential test workflow',
      input: { text: 'a' },
      status: 'running',
      steps: [],
      datasets: [],
      startedAt: 't',
    });
    ctx.sessions.runHostWorkspaceIds.mockImplementation(() => {
      throw new Error('no workspaces dir');
    });
    await ctx.service.onModuleInit();
    await expect(ctx.repository.get('left')).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

/** A run of the sequential test workflow an earlier version stored. */
const SEQ_RUN: WorkflowRunDoc = {
  id: 'old-seq',
  workflowId: 'seq-text-demo',
  workflowName: 'Sequential test workflow',
  input: { text: '  Hello world  ' },
  status: 'success',
  steps: [
    {
      id: 'clean-text',
      title: 'Clean text',
      status: 'success',
      input: { text: '  Hello world  ' },
      output: { text: 'Hello world' },
      startedAt: '2026-11-11T11:00:00.000Z',
      endedAt: '2026-11-11T11:00:00.500Z',
    },
  ],
  output: { summary: '2 words, 11 characters: "Hello world"' },
  datasets: [],
  startedAt: '2026-11-11T11:00:00.000Z',
  finishedAt: '2026-11-11T11:00:01.000Z',
};

/** A one-step Assistant run an earlier version stored. */
const ASSISTANT_RUN: WorkflowRunDoc = {
  id: 'old-assistant',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: { question: 'Who hosted in 2002?', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [{ id: 'answer', title: 'Answer', status: 'success' }],
  question: 'Who hosted in 2002?',
  answer: { role: 'assistant', content: 'Korea and Japan.', at: 't' },
  datasets: ['World Cup Core'],
  panelItems: [],
  visualizations: [],
  startedAt: '2026-11-11T10:00:00.000Z',
  finishedAt: '2026-11-11T10:00:05.000Z',
};

/** A deep analysis run an earlier version stored: its report is a file. */
const DEEP_RUN: WorkflowRunDoc = {
  id: 'old-deep',
  workflowId: 'deep-analysis',
  workflowName: 'Deep analysis',
  input: { question: 'Why did scoring fall?', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [
    { id: 'plan', title: 'Plan', status: 'success' },
    { id: 'assemble', title: 'Assemble', status: 'success' },
  ],
  output: { title: 'Scoring', executiveSummary: 'Defences got better.' },
  question: 'Why did scoring fall?',
  answer: {
    role: 'assistant',
    content: 'Defences got better.',
    at: 't',
    report: {
      jobId: 'old-deep',
      title: 'Scoring',
      path: 'reports/old-deep.md',
      angles: 3,
    },
  },
  datasets: ['World Cup Core'],
  panelItems: [
    {
      id: 'p1',
      kind: 'file',
      title: 'Scoring',
      path: 'reports/old-deep.md',
      bytes: 1200,
      shownAt: 't',
    },
  ],
  visualizations: [],
  startedAt: '2026-11-10T10:00:00.000Z',
  finishedAt: '2026-11-10T10:04:00.000Z',
};

describe('WorkflowRunsService: the run history (api.md 120-127)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };

  it('lists summaries newest first, filtered by workflow, titled from the question or the first text input', async () => {
    ctx = build();
    const v2 = await streamed(ctx, 'answer-business-question', { input: ASK });
    // Same-millisecond starts would tie: order by the stored startedAt.
    await ctx.repository.update(v2.run.id, {
      startedAt: '2026-11-11T12:00:00.000Z',
    });
    // Runs an earlier version stored of workflows removed in 1.23.35.
    await ctx.repository.insert(SEQ_RUN);
    await ctx.repository.insert(ASSISTANT_RUN);
    expect(await ctx.service.list()).toEqual([
      {
        id: v2.run.id,
        workflowId: 'answer-business-question',
        workflowName: 'Answer a Business Question',
        status: 'success',
        title: 'Who won in 2002?',
        startedAt: '2026-11-11T12:00:00.000Z',
        finishedAt: v2.run.finishedAt,
      },
      {
        id: 'old-seq',
        workflowId: 'seq-text-demo',
        workflowName: 'Sequential test workflow',
        status: 'success',
        title: 'Hello world',
        startedAt: '2026-11-11T11:00:00.000Z',
        finishedAt: '2026-11-11T11:00:01.000Z',
      },
      {
        id: 'old-assistant',
        workflowId: 'agent:assistant',
        workflowName: 'Assistant',
        status: 'success',
        title: 'Who hosted in 2002?',
        startedAt: '2026-11-11T10:00:00.000Z',
        finishedAt: '2026-11-11T10:00:05.000Z',
      },
    ]);
    expect(
      (await ctx.service.list('answer-business-question')).map((run) => run.id),
    ).toEqual([v2.run.id]);
    expect(
      (await ctx.service.list('seq-text-demo')).map((run) => run.id),
    ).toEqual(['old-seq']);
  });

  it('gets one run with its derived views, or 404 Run "<id>" not found', async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await expect(ctx.service.get(run.id)).resolves.toEqual(run);
    await expect(ctx.service.get('nope')).rejects.toThrow(
      new NotFoundException('Run "nope" not found'),
    );
  });

  describe('a stored run of a workflow removed in 1.23.35', () => {
    it('a sequential test run reads as stored: its steps and output, no agent views', async () => {
      ctx = build();
      await ctx.repository.insert(SEQ_RUN);
      const read = await ctx.service.get('old-seq');
      expect(read).toMatchObject({ ...SEQ_RUN, ownerId: 'local' });
      expect(read).not.toHaveProperty('agent');
      expect(ctx.sessions.toView).not.toHaveBeenCalled();
    });

    it.each([
      ['an Assistant run', () => ASSISTANT_RUN],
      ['a deep analysis run, its report kept as a file', () => DEEP_RUN],
    ])(
      '%s reads as a plain run, through its run-backed host',
      async (_label, stored) => {
        ctx = build();
        const doc = stored();
        await ctx.repository.insert(doc);
        const read = await ctx.service.get(doc.id);
        expect(read).toMatchObject({
          id: doc.id,
          workflowId: doc.workflowId,
          status: 'success',
          question: doc.question,
          answer: { content: doc.answer!.content },
        });
        expect(ctx.sessions.toView).toHaveBeenLastCalledWith(
          expect.objectContaining({
            id: `run-${doc.id}`,
            workflowId: doc.workflowId,
            run: true,
          }),
        );
        // Its files are served from its workspace, as before.
        await ctx.service.panelItemFile(doc.id, 'p1');
        expect(ctx.sessions.panelItemFileOf).toHaveBeenCalledWith(
          expect.objectContaining({ workspaceId: `session-run-${doc.id}` }),
          'p1',
        );
      },
    );

    it('cannot run again: a run request naming its workflow is not found', async () => {
      ctx = build();
      await ctx.repository.insert(DEEP_RUN);
      for (const id of ['deep-analysis', 'seq-text-demo', 'agent:assistant']) {
        await expect(
          ctx.service.prepare(id, {
            input: { question: 'Again', datasets: ['World Cup Core'] },
            context: { fromRunId: DEEP_RUN.id },
          }),
        ).rejects.toThrow(new NotFoundException(`Workflow "${id}" not found`));
      }
      expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
    });

    it('a v2 run may take its question and answer as context; one without an answer is refused clearly', async () => {
      ctx = build();
      await ctx.repository.insert(DEEP_RUN);
      await ctx.repository.insert(SEQ_RUN);
      const prepared = await ctx.service.prepare('answer-business-question', {
        input: { question: 'Why?', datasets: ['World Cup Core'] },
        context: { fromRunId: DEEP_RUN.id },
      });
      expect(prepared.context).toEqual({
        fromRunId: DEEP_RUN.id,
        question: DEEP_RUN.question,
        answer: DEEP_RUN.answer!.content,
      });
      const refusal = ctx.service.prepare('answer-business-question', {
        input: { question: 'Why?', datasets: ['World Cup Core'] },
        context: { fromRunId: 'old-seq' },
      });
      await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
      await expect(refusal).rejects.toThrow(
        'Run "old-seq" has no answer to continue from',
      );
    });

    it('deletes a run without a question without touching any workspace, and one with a question with its workspace', async () => {
      ctx = build();
      await ctx.repository.insert(SEQ_RUN);
      await ctx.repository.insert(DEEP_RUN);
      await ctx.service.delete('old-seq');
      expect(ctx.sessions.deleteRunHostResources).not.toHaveBeenCalled();
      await ctx.service.delete(DEEP_RUN.id);
      expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
        `run-${DEEP_RUN.id}`,
      );
      expect(await ctx.repository.list()).toEqual([]);
    });
  });

  it('reads a stored RFP Builder run as a plain run: its legacy rfpId is dropped', async () => {
    ctx = build();
    await ctx.repository.insert({
      id: 'old-rfp',
      workflowId: 'agent:rfp',
      workflowName: 'RFP Builder',
      input: { message: 'Start an RFP', rfpId: 'rfp-1' },
      status: 'success',
      steps: [],
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: '2026-11-01T10:01:00.000Z',
      question: 'Start an RFP',
      answer: { role: 'assistant', content: 'Which client?', at: 't2' },
      datasets: ['Intellify RFP API'],
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      rfpId: 'rfp-1',
      panelItems: [],
      visualizations: [],
    } as never);
    const read = await ctx.service.get('old-rfp');
    expect(read).toMatchObject({
      id: 'old-rfp',
      workflowId: 'agent:rfp',
      status: 'success',
      answer: { content: 'Which client?' },
    });
    expect(read).not.toHaveProperty('rfpId');
    expect((await ctx.service.list()).map((run) => run.id)).toContain(
      'old-rfp',
    );
  });

  it('deletes a run with its workspace and memory thread; refuses a running one and an unknown one', async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const said = {
      id: 'm1',
      role: 'user' as const,
      content: 'Why?',
      createdAt: 't',
    };
    await ctx.nodeChats.append(run.id, 'analyse', said);
    await ctx.nodeChats.append('another-run', 'analyse', said);
    await ctx.service.delete(run.id);
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
      `run-${run.id}`,
    );
    await expect(ctx.repository.get(run.id)).resolves.toBeNull();
    // Its node chats go with it (data-model 3.17), each with its memory
    // thread (agents.md 5.16); another run's stay.
    expect(ctx.deleteMemoryResource).toHaveBeenCalledWith(
      `run-${run.id}-node-analyse`,
    );
    expect(ctx.deleteMemoryResource).not.toHaveBeenCalledWith(
      'run-another-run-node-analyse',
    );
    await expect(ctx.nodeChats.get(run.id, 'analyse')).resolves.toBeNull();
    expect(await ctx.nodeChats.get('another-run', 'analyse')).not.toBeNull();
    await expect(ctx.service.delete(run.id)).rejects.toThrow(
      new NotFoundException(`Run "${run.id}" not found`),
    );
    await ctx.repository.insert({
      id: 'busy',
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      input: ASK,
      status: 'running',
      steps: [],
      datasets: [],
      startedAt: 't',
    });
    const refusal = ctx.service.delete('busy');
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow('Stop the run before deleting it');
    await expect(ctx.repository.get('busy')).resolves.not.toBeNull();
  });

  it("serves a run's files through the session file services, given its run-backed host", async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    const host = expect.objectContaining({
      id: `run-${run.id}`,
      run: true,
      workspaceId: `session-run-${run.id}`,
    }) as unknown;
    await ctx.service.panelItemFile(run.id, 'p1');
    expect(ctx.sessions.panelItemFileOf).toHaveBeenCalledWith(host, 'p1');
    await ctx.service.downloadPanelItem(run.id, 'p1', 'pdf');
    expect(ctx.sessions.downloadPanelItemOf).toHaveBeenCalledWith(
      host,
      'p1',
      'pdf',
    );
    await ctx.service.getVisualization(run.id, 'v1', 2);
    expect(ctx.sessions.getVisualizationOf).toHaveBeenCalledWith(host, 'v1', 2);
    await ctx.service.downloadVisualization(run.id, 'v1');
    expect(ctx.sessions.downloadVisualizationOf).toHaveBeenCalledWith(
      host,
      'v1',
      undefined,
    );
    await expect(ctx.service.panelItemFile('nope', 'p1')).rejects.toThrow(
      new NotFoundException('Run "nope" not found'),
    );
  });
});

describe('WorkflowRunsService: visual actions on a run (api.md 130-134; visuals R2, R12-R24)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };

  it('generates a visual from the answer: stores its metadata, panel item and a created card on the run', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won.' });
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });

    const result = await ctx.service.generateVisualization(run.id);

    expect(ctx.sessions.runVisualAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `run-${run.id}`,
        workspaceId: `session-run-${run.id}`,
      }),
      { kind: 'create', sourceMessageAt: run.answer?.at },
    );
    expect(ctx.sessions.getVisualizationOf).toHaveBeenLastCalledWith(
      expect.anything(),
      'vis-1',
      1,
    );
    expect(result.visualization.document).toBe('<html>');
    const stored = await ctx.service.get(run.id);
    expect(stored.visualizations).toEqual([
      expect.objectContaining({ id: 'vis-1' }),
    ]);
    expect(stored.panelItems).toEqual([
      expect.objectContaining({ id: 'visual:vis-1', kind: 'visual' }),
    ]);
    expect(stored.events).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Created interactive visual "Goals by team" (v1).',
        visual: {
          visualId: 'vis-1',
          version: 1,
          title: 'Goals by team',
          action: 'created',
        },
      }),
    ]);
    expect(result.run.events).toHaveLength(1);
    // The answer itself is untouched.
    expect(stored.answer?.content).toBe('Brazil won.');
  });

  it('tailors and reverts: each adds a card; refresh and repair add none and keep one visual entry', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won.' });
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await ctx.service.generateVisualization(run.id);

    await ctx.service.tailorVisualization(
      run.id,
      'vis-1',
      'Make the bars green',
    );
    expect(ctx.sessions.runVisualAction).toHaveBeenLastCalledWith(
      expect.anything(),
      { kind: 'tailor', visualId: 'vis-1', instruction: 'Make the bars green' },
    );
    await ctx.service.revertVisualization(run.id, 'vis-1', 1);
    await ctx.service.refreshVisualization(run.id, 'vis-1');
    await ctx.service.repairVisualization(run.id, 'vis-1', 'boom', 2);

    const stored = await ctx.service.get(run.id);
    expect(stored.visualizations).toHaveLength(1);
    expect(stored.panelItems?.filter((i) => i.kind === 'visual')).toHaveLength(
      1,
    );
    expect(stored.events?.map((e) => e.visual?.action)).toEqual([
      'created',
      'updated',
      'reverted',
    ]);
  });

  it('refuses a run that is still running, a code-only run, and an unknown run', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won.' });
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await ctx.repository.update(run.id, { status: 'running' });
    await expect(ctx.service.generateVisualization(run.id)).rejects.toThrow(
      new BadRequestException('Wait for the run to finish'),
    );
    await ctx.repository.update(run.id, {
      status: 'success',
      question: undefined,
    });
    await expect(ctx.service.generateVisualization(run.id)).rejects.toThrow(
      BadRequestException,
    );
    await expect(ctx.service.generateVisualization('nope')).rejects.toThrow(
      new NotFoundException('Run "nope" not found'),
    );
    expect(ctx.sessions.runVisualAction).not.toHaveBeenCalled();
  });
});

const RUN_VISUAL = {
  run: { id: 'r1' },
  visualization: { id: 'v1', document: '<html>', version: 2 },
};

describe('WorkflowRunsService: conversations with Avery (workflows R45; api.md 120, 159, 160)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const FIRST = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };
  const ORCHESTRATED = 'orchestrated-answer';

  /** A first message and a follow-up to it, both finished. */
  async function conversation() {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, ORCHESTRATED, { input: FIRST });
    const second = await streamed(ctx, ORCHESTRATED, {
      input: { question: 'And in 2006?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    return { first: first.run, second: second.run };
  }

  it('starts a conversation on a first message: its conversation is its own id', async () => {
    ctx = build();
    const { run } = await streamed(ctx, ORCHESTRATED, { input: FIRST });
    expect(run.conversationId).toBe(run.id);
    // Another workflow's run belongs to no conversation.
    const other = await streamed(ctx, 'answer-business-question', {
      input: FIRST,
    });
    expect(other.run.conversationId).toBeUndefined();
  });

  it("joins the earlier run's conversation on a follow-up, and Avery reads its turns", async () => {
    const { first, second } = await conversation();
    expect(second.conversationId).toBe(first.id);
    const spec = ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as {
      transcript?: { role: string; content: string }[];
    };
    expect(spec.transcript).toEqual([
      { role: 'user', content: 'Who won in 2002?' },
      { role: 'assistant', content: 'Brazil won in 2002.' },
    ]);
    // Avery holds the conversation: her team starts from no copied thread.
    expect(spec).not.toHaveProperty('continuesThreadsOf');

    const third = await streamed(ctx, ORCHESTRATED, {
      input: { question: 'And 2010?', datasets: ['World Cup Core'] },
      context: { fromRunId: second.id },
    });
    expect(third.run.conversationId).toBe(first.id);
    const next = ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as {
      transcript?: { role: string; content: string }[];
    };
    expect(next.transcript?.map((m) => m.content)).toEqual([
      'Who won in 2002?',
      'Brazil won in 2002.',
      'And in 2006?',
      'Brazil won in 2002.',
    ]);
  });

  it('archives every run of the conversation, and hides them from the list', async () => {
    const { first, second } = await conversation();
    expect(await ctx.service.list()).toHaveLength(2);
    expect(await ctx.service.archive(second.id)).toEqual({
      ok: true,
      conversationId: first.id,
      archived: 2,
    });
    for (const id of [first.id, second.id]) {
      expect((await ctx.repository.get(id))?.archivedAt).toEqual(
        expect.any(String),
      );
    }
    expect(await ctx.service.list()).toEqual([]);
    expect(
      (await ctx.service.list(undefined, true)).map((run) => run.id).sort(),
    ).toEqual([first.id, second.id].sort());
  });

  it('refuses to archive while a run of the conversation is running or waiting, and an unknown run is 404', async () => {
    const { first, second } = await conversation();
    await ctx.repository.update(second.id, { status: 'running' });
    await expect(ctx.service.archive(first.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await ctx.repository.update(second.id, { status: 'suspended' });
    await expect(ctx.service.archive(first.id)).rejects.toThrow(
      'The run is still running',
    );
    expect((await ctx.repository.get(first.id))?.archivedAt).toBeUndefined();
    await expect(ctx.service.archive('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("hands a follow-up the conversation's last dashboard, however many turns ago (agents.md 5.22)", async () => {
    const { first, second } = await conversation();
    const dashboard = {
      artifactId: 'a-1',
      version: 1,
      title: 'Goals by team',
      action: 'created' as const,
      widgetCount: 3,
      filterCount: 1,
      rowCount: 32,
    };
    // The first answer built it; the second carries none of its own.
    const answered = await ctx.repository.get(first.id);
    await ctx.repository.update(first.id, {
      answer: { ...answered!.answer!, dashboard },
    });
    await streamed(ctx, ORCHESTRATED, {
      input: { question: 'Add a stage filter', datasets: ['World Cup Core'] },
      context: { fromRunId: second.id },
    });
    const spec = ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as {
      contextDashboard?: string;
    };
    expect(spec.contextDashboard).toBe('a-1');

    // A later version replaces it as the one the next message changes.
    const latest = await ctx.repository.get(second.id);
    await ctx.repository.update(second.id, {
      answer: {
        ...latest!.answer!,
        dashboard: { ...dashboard, artifactId: 'a-2', version: 2 },
      },
    });
    await streamed(ctx, ORCHESTRATED, {
      input: { question: 'Make it dark', datasets: ['World Cup Core'] },
      context: { fromRunId: first.id },
    });
    expect(
      (
        ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as {
          contextDashboard?: string;
        }
      ).contextDashboard,
    ).toBe('a-2');
  });

  it('carries no dashboard into a conversation that has none, and an archived one still takes no message', async () => {
    const { second } = await conversation();
    await streamed(ctx, ORCHESTRATED, {
      input: { question: 'And 2010?', datasets: ['World Cup Core'] },
      context: { fromRunId: second.id },
    });
    expect(
      ctx.sessions.createRunHost.mock.calls.at(-1)?.[0],
    ).not.toHaveProperty('contextDashboard');
    const answered = await ctx.repository.get(second.id);
    await ctx.repository.update(second.id, {
      answer: {
        ...answered!.answer!,
        dashboard: {
          artifactId: 'a-1',
          version: 1,
          title: 'Goals',
          action: 'created',
          widgetCount: 1,
          filterCount: 0,
          rowCount: 1,
        },
      },
    });
    await ctx.service.archive(second.id);
    const hosts = ctx.sessions.createRunHost.mock.calls.length;
    await expect(
      ctx.service.prepare(ORCHESTRATED, {
        input: { question: 'More?', datasets: ['World Cup Core'] },
        context: { fromRunId: second.id },
      }),
    ).rejects.toThrow('This conversation is archived');
    expect(ctx.sessions.createRunHost.mock.calls).toHaveLength(hosts);
  });

  it('refuses a follow-up to an archived conversation (409)', async () => {
    const { second } = await conversation();
    await ctx.service.archive(second.id);
    const refusal = ctx.service.prepare(ORCHESTRATED, {
      input: { question: 'More?', datasets: ['World Cup Core'] },
      context: { fromRunId: second.id },
    });
    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    await expect(refusal).rejects.toThrow('This conversation is archived');
  });

  it('unarchive brings the conversation back: listed again and open to a new message', async () => {
    const { first, second } = await conversation();
    await ctx.service.archive(first.id);
    expect(await ctx.service.unarchive(second.id)).toEqual({
      ok: true,
      conversationId: first.id,
      unarchived: 2,
    });
    expect((await ctx.repository.get(first.id))?.archivedAt).toBeUndefined();
    expect(await ctx.service.list()).toHaveLength(2);
    expect(await ctx.service.list(undefined, true)).toEqual([]);
    const again = await streamed(ctx, ORCHESTRATED, {
      input: { question: 'More?', datasets: ['World Cup Core'] },
      context: { fromRunId: second.id },
    });
    expect(again.run.conversationId).toBe(first.id);
  });
});

describe('WorkflowRunsController /workflow-runs (api.md 120-127)', () => {
  it('lists, gets, deletes and serves the files of runs', async () => {
    const runs = {
      list: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      get: jest.fn((id: string) =>
        id === 'r1'
          ? Promise.resolve({ id: 'r1', status: 'success' })
          : Promise.reject(new NotFoundException(`Run "${id}" not found`)),
      ),
      archive: jest.fn().mockResolvedValue({
        ok: true,
        conversationId: 'r1',
        archived: 2,
      }),
      unarchive: jest.fn().mockResolvedValue({
        ok: true,
        conversationId: 'r1',
        unarchived: 2,
      }),
      delete: jest.fn((id: string) =>
        id === 'busy'
          ? Promise.reject(
              new BadRequestException('Stop the run before deleting it'),
            )
          : Promise.resolve(),
      ),
      getVisualization: jest
        .fn()
        .mockResolvedValue({ id: 'v1', document: '<html>', version: 2 }),
      generateVisualization: jest.fn().mockResolvedValue(RUN_VISUAL),
      tailorVisualization: jest.fn().mockResolvedValue(RUN_VISUAL),
      revertVisualization: jest.fn().mockResolvedValue(RUN_VISUAL),
      refreshVisualization: jest.fn().mockResolvedValue(RUN_VISUAL),
      repairVisualization: jest.fn().mockResolvedValue(RUN_VISUAL),
      downloadVisualization: jest.fn().mockResolvedValue({
        filename: 'goals-v2.zip',
        archive: Buffer.from('zip'),
      }),
      panelItemFile: jest.fn().mockResolvedValue({
        item: { id: 'p1' },
        contentType: 'text/markdown',
        text: '# Notes',
      }),
      downloadPanelItem: jest.fn().mockResolvedValue({
        filename: 'notes.md',
        contentType: 'text/markdown',
        body: Buffer.from('# Notes'),
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowRunsController],
      providers: [
        { provide: WorkflowRunsService, useValue: runs },
        { provide: WorkflowNodeChatsService, useValue: {} },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .get('/workflow-runs')
        .expect(200, { runs: [{ id: 'r1' }] });
      expect(runs.list).toHaveBeenLastCalledWith(undefined, false);
      await request(server)
        .get('/workflow-runs?workflowId=agent%3Aassistant')
        .expect(200);
      expect(runs.list).toHaveBeenLastCalledWith('agent:assistant', false);
      await request(server).get('/workflow-runs?archived=true').expect(200);
      expect(runs.list).toHaveBeenLastCalledWith(undefined, true);
      await request(server)
        .post('/workflow-runs/r1/archive')
        .expect(200, { ok: true, conversationId: 'r1', archived: 2 });
      expect(runs.archive).toHaveBeenCalledWith('r1');
      await request(server)
        .post('/workflow-runs/r1/unarchive')
        .expect(200, { ok: true, conversationId: 'r1', unarchived: 2 });
      expect(runs.unarchive).toHaveBeenCalledWith('r1');
      await request(server)
        .get('/workflow-runs/r1')
        .expect(200, { id: 'r1', status: 'success' });
      await request(server)
        .get('/workflow-runs/nope')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({ message: 'Run "nope" not found' }),
        );
      await request(server)
        .delete('/workflow-runs/r1')
        .expect(200, { ok: true, message: 'Run deleted' });
      await request(server)
        .delete('/workflow-runs/busy')
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Stop the run before deleting it',
          }),
        );
      await request(server)
        .get('/workflow-runs/r1/visualizations/v1?version=2')
        .expect(200, { id: 'v1', document: '<html>', version: 2 });
      expect(runs.getVisualization).toHaveBeenCalledWith('r1', 'v1', 2);
      await request(server)
        .post('/workflow-runs/r1/visualizations')
        .send({ sourceMessageAt: 't' })
        .expect(201, {
          ok: true,
          message: 'Interactive visual generated',
          ...RUN_VISUAL,
        });
      expect(runs.generateVisualization).toHaveBeenCalledWith('r1', 't');
      await request(server)
        .post('/workflow-runs/r1/visualizations/v1/tailor')
        .send({ instruction: 'Make the bars green' })
        .expect(201)
        .expect(({ body }) =>
          expect(body).toMatchObject({ message: 'Updated to version 2' }),
        );
      expect(runs.tailorVisualization).toHaveBeenCalledWith(
        'r1',
        'v1',
        'Make the bars green',
      );
      await request(server)
        .post('/workflow-runs/r1/visualizations/v1/revert')
        .send({ version: 1 })
        .expect(201);
      expect(runs.revertVisualization).toHaveBeenCalledWith('r1', 'v1', 1);
      await request(server)
        .post('/workflow-runs/r1/visualizations/v1/refresh')
        .expect(201);
      expect(runs.refreshVisualization).toHaveBeenCalledWith('r1', 'v1');
      await request(server)
        .post('/workflow-runs/r1/visualizations/v1/repair')
        .send({ error: 'blank', version: 2 })
        .expect(201);
      expect(runs.repairVisualization).toHaveBeenCalledWith(
        'r1',
        'v1',
        'blank',
        2,
      );
      const zip = await request(server)
        .get('/workflow-runs/r1/visualizations/v1/download?version=x')
        .expect(200);
      expect(runs.downloadVisualization).toHaveBeenCalledWith(
        'r1',
        'v1',
        undefined,
      );
      expect(zip.headers['content-type']).toBe('application/zip');
      expect(zip.headers['content-disposition']).toBe(
        'attachment; filename="goals-v2.zip"',
      );
      await request(server)
        .get('/workflow-runs/r1/panel-items/p1/file')
        .expect(200, {
          item: { id: 'p1' },
          contentType: 'text/markdown',
          text: '# Notes',
        });
      const md = await request(server)
        .get('/workflow-runs/r1/panel-items/p1/download?format=md')
        .expect(200);
      expect(runs.downloadPanelItem).toHaveBeenCalledWith('r1', 'p1', 'md');
      expect(md.headers['content-disposition']).toBe(
        'attachment; filename="notes.md"',
      );
      expect(md.text).toBe('# Notes');
      await request(server)
        .get('/workflow-runs/r1/panel-items/p1/download?format=docx')
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Unknown download format "docx": use pdf, md or csv',
          }),
        );
      // The RFP package route of the removed RFP Builder is gone.
      await request(server)
        .get(
          '/workflow-runs/r1/rfp-packages/rfp-1/download?file=rfp.md&draft=true',
        )
        .expect(404);
    } finally {
      await app.close();
    }
  });
});

describe('WorkflowRunsService: a draft run (api.md R12; agents-evals R60)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('runs the draft on a draft host, stores nothing and discards the host and workspace', async () => {
    ctx = build(DATASETS, {
      events: [{ type: 'text', content: 'Brazil won.' }],
    });
    const events: RunStreamEvent[] = [];
    const prepared = await ctx.service.prepareDraft('agent-1', {
      input: { question: '  Who won?  ' },
    });
    const run = await ctx.service.stream(prepared, (e) => events.push(e));

    expect(ctx.sessions.createRunHost).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        draftAgentId: 'agent-1',
        name: 'Sales helper',
      }),
    );
    expect(ctx.sessions.streamRunTurn).toHaveBeenCalledWith(
      `run-${run.id}`,
      'Who won?',
      expect.any(Function),
      expect.any(AbortSignal),
      false,
      expect.any(Function),
    );
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledWith(`run-${run.id}`);
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
      `run-${run.id}`,
    );
    expect(events.map((e) => e.type)).toEqual([
      'run',
      'step',
      'text',
      'step',
      'done',
    ]);
    expect(events[0]).toMatchObject({
      type: 'run',
      workflowId: 'agent:agent-1',
    });
    expect(run.status).toBe('success');
    expect(run.answer?.content).toBe('Brazil won.');
    // Not stored: neither the history nor the run's own route knows it.
    expect(await ctx.repository.get(run.id)).toBeNull();
    expect(await ctx.service.list()).toEqual([]);
  });

  it('refuses before anything runs: unknown agent, no existing dataset, blank question', async () => {
    ctx = build();
    await expect(
      ctx.service.prepareDraft('missing', { input: { question: 'hi' } }),
    ).rejects.toThrow('Agent "missing" not found');
    await expect(
      ctx.service.prepareDraft('no-data', { input: { question: 'hi' } }),
    ).rejects.toThrow('Select at least one dataset to preview');
    await expect(
      ctx.service.prepareDraft('agent-1', { input: { question: '   ' } }),
    ).rejects.toThrow('Question is required');
    await expect(ctx.service.prepareDraft('agent-1', {})).rejects.toThrow(
      'Question is required',
    );
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  });

  it('a failing turn sends the error and still discards the host and workspace', async () => {
    ctx = build(DATASETS, { throws: new Error('provider down') });
    const events: RunStreamEvent[] = [];
    const prepared = await ctx.service.prepareDraft('agent-1', {
      input: { question: 'Who won?' },
    });
    const run = await ctx.service.stream(prepared, (e) => events.push(e));
    expect(run.status).toBe('failed');
    expect(events.at(-1)).toEqual({ type: 'error', content: 'provider down' });
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledTimes(1);
    expect(await ctx.repository.get(run.id)).toBeNull();
  });

  describe('its finished run, held in memory for the query inspector (plan section 5)', () => {
    const SAMPLE = {
      tool: 'sample_rows',
      input: 'shop.public.returns',
      columns: ['id'],
      rows: [{ id: 1 }],
      rowCount: 10,
    };
    let now = Date.parse('2026-11-15T10:00:00.000Z');
    beforeEach(() => {
      now = Date.parse('2026-11-15T10:00:00.000Z');
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });
    afterEach(() => jest.restoreAllMocks());

    async function draftRun() {
      ctx = build(DATASETS, { data: [SAMPLE] });
      const prepared = await ctx.service.prepareDraft('agent-1', {
        input: { question: 'Show some returns' },
      });
      const events: RunStreamEvent[] = [];
      const run = await ctx.service.stream(prepared, (e) => events.push(e));
      return { run, events };
    }

    it('answers 139 and 140 for 30 minutes, writing to its copy in memory, then 404', async () => {
      const { run, events } = await draftRun();
      // The stream's first event carries the id 139-143 accept.
      expect(events[0]).toMatchObject({ type: 'run', runId: run.id });

      const prepared = await ctx.service.prepareEvidence(run.id);
      expect(prepared.id).toBe(run.id);
      expect(ctx.queryEvidence.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Brazil won.' }),
        ['World Cup Core'],
      );
      const explained = await ctx.service.explainQuery(run.id, 0);
      expect(explained.answer?.evidence?.[0].explanation?.steps.length).toBe(2);
      // The copy in memory keeps it: a second call reads it back.
      now += 29 * 60 * 1000;
      const again = await ctx.service.explainQuery(run.id, 0);
      expect(again.answer?.evidence?.[0].explanation).toEqual(
        explained.answer?.evidence?.[0].explanation,
      );
      expect(await ctx.repository.get(run.id)).toBeNull();

      now += 60 * 1000;
      await expect(ctx.service.prepareEvidence(run.id)).rejects.toThrow(
        `Run "${run.id}" not found`,
      );
      await expect(ctx.service.explainQuery(run.id, 0)).rejects.toThrow(
        `Run "${run.id}" not found`,
      );
    });

    it('is never listed, read or deleted through 120, 121 and 122', async () => {
      const { run } = await draftRun();
      expect(await ctx.service.list()).toEqual([]);
      await expect(ctx.service.get(run.id)).rejects.toThrow(
        `Run "${run.id}" not found`,
      );
      await expect(ctx.service.delete(run.id)).rejects.toThrow(
        `Run "${run.id}" not found`,
      );
      // Still held for the inspector.
      await expect(ctx.service.rerunQuery(run.id, 9)).rejects.toThrow(
        "Query 9 not found in the run's answer",
      );
    });

    it('SHALL NOT answer once its agent is gone: the rule of POST /agents/:id/draft-runs/stream', async () => {
      const { run } = await draftRun();
      ctx.sessions.draftRunTarget.mockImplementationOnce(() =>
        Promise.reject(new NotFoundException('Agent "agent-1" not found')),
      );
      await expect(ctx.service.prepareEvidence(run.id)).rejects.toThrow(
        `Run "${run.id}" not found`,
      );
      // Dropped: it stays not found.
      await expect(ctx.service.explainQuery(run.id, 0)).rejects.toThrow(
        `Run "${run.id}" not found`,
      );
    });
  });
});

describe('WorkflowRunsService: runs detached from their request (api.md 119, 138, 149, 150; ADR-0048)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };

  /** The next turn streams "Bra", then waits until released or stopped. */
  function holdTurn(): () => void {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const original = ctx.sessions.streamRunTurn.getMockImplementation()!;
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (hostId, question, emit, signal, careful, onStep) => {
        emit({ type: 'text', content: 'Bra' });
        if (!signal?.aborted) {
          await Promise.race([
            released,
            new Promise<void>((resolve) =>
              signal?.addEventListener('abort', () => resolve()),
            ),
          ]);
        }
        if (signal?.aborted) return;
        await original(hostId, question, emit, signal, careful, onStep);
      },
    );
    return release;
  }

  /** What a follower from `after` gets: `<seq>:<type>`, and whether it ended. */
  function follow(id: string, after = 0) {
    const got: string[] = [];
    const state = { ended: false };
    const leave = ctx.service.live.subscribe(id, after, {
      event: ({ seq, event }) => got.push(`${seq}:${event.type}`),
      end: () => (state.ended = true),
    });
    return { got, state, leave };
  }

  const launch = async () =>
    ctx.service.launch(
      await ctx.service.prepare('answer-business-question', { input: ASK }),
    );

  it('keeps running when its follower leaves: the run ends success and a later follower replays it from seq 0', async () => {
    ctx = build();
    const release = holdTurn();
    const id = await launch();
    const first = follow(id);
    expect(first.got[0]).toBe('1:run');
    first.leave!();
    expect((await ctx.service.get(id)).status).toBe('running');
    // The turn runs on the registry's signal, never the request's.
    const signal = ctx.sessions.streamRunTurn.mock.calls[0]?.[3];
    release();
    await ctx.service.live.whenEnded(id);
    expect(signal?.aborted).toBe(false);
    expect((await ctx.service.get(id)).status).toBe('success');
    const later = follow(id);
    expect(later.got[0]).toBe('1:run');
    // What streamed while nobody followed is in the log.
    expect(later.got.some((frame) => frame.endsWith(':text'))).toBe(true);
    expect(later.got.at(-1)).toMatch(/:done$/);
    expect(later.state.ended).toBe(true);
  });

  it('Stop (150) aborts a live run, stored stopped; a second Stop answers it as it is; an unknown run is 404', async () => {
    ctx = build();
    holdTurn();
    const id = await launch();
    const done: unknown[] = [];
    const watcher = follow(id);
    ctx.service.live.subscribe(id, 0, {
      event: ({ event }) => {
        if (event.type === 'done') done.push(event['run']);
      },
      end: () => undefined,
    });
    const stopped = await ctx.service.stop(id);
    expect(stopped.status).toBe('stopped');
    // A client still following sees the end: done with the stopped run.
    expect(watcher.state.ended).toBe(true);
    expect(watcher.got.at(-1)).toMatch(/:done$/);
    expect(done).toEqual([
      expect.objectContaining({ id, status: 'stopped' }) as unknown,
    ]);
    expect((await ctx.service.stop(id)).status).toBe('stopped');
    await expect(ctx.service.stop('nope')).rejects.toThrow(
      'Run "nope" not found',
    );
  });

  it('a failing turn logs error { content } and ends the log', async () => {
    ctx = build(DATASETS, { throws: new Error('The provider failed') });
    const id = await launch();
    await ctx.service.live.whenEnded(id);
    const replay = follow(id);
    expect(replay.got.at(-1)).toMatch(/:error$/);
    expect(replay.state.ended).toBe(true);
    expect((await ctx.service.get(id)).status).toBe('failed');
  });

  it('checks a run can be followed (149): 404 unknown, 404 "has no live events" for a run not held', async () => {
    ctx = build();
    await expect(ctx.service.checkLive('nope')).rejects.toThrow(
      'Run "nope" not found',
    );
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: ASK,
    });
    await expect(ctx.service.checkLive(run.id)).rejects.toThrow(
      `Run "${run.id}" has no live events`,
    );
    const id = await launch();
    await expect(ctx.service.checkLive(id)).resolves.toBeUndefined();
    await ctx.service.live.whenEnded(id);
  });

  describe('a run that waits for the user (138)', () => {
    function suspendingTurn() {
      const suspension = {
        stepId: 'plan',
        question: 'Which measure?',
        options: ['Goals', 'Wins'],
        resume: jest.fn(
          (_answer: string, io: { emit: (event: unknown) => void }) => {
            io.emit({ type: 'text', content: 'Brazil won.' });
            return Promise.resolve(undefined);
          },
        ),
        discard: jest.fn(() => Promise.resolve()),
      };
      ctx.sessions.streamRunTurn.mockImplementationOnce(() =>
        Promise.resolve(suspension as never),
      );
      Object.assign(ctx.sessions, {
        runHostView: jest.fn(() =>
          Promise.resolve({ datasets: ['World Cup Core'] }),
        ),
      });
      return suspension;
    }

    it('resumes detached on the same run: a fresh log whose numbers go on', async () => {
      ctx = build();
      suspendingTurn();
      const id = await launch();
      await ctx.service.live.whenEnded(id);
      const waiting = follow(id);
      expect(waiting.got.slice(-2).map((f) => f.split(':')[1])).toEqual([
        'input-required',
        'done',
      ]);
      const last = Number(waiting.got.at(-1)!.split(':')[0]);
      const prepared = await ctx.service.prepareResume(id, {
        stepId: 'plan',
        answer: 'Goals',
      });
      expect(ctx.service.resumeDetached(prepared)).toBe(id);
      await ctx.service.live.whenEnded(id);
      const resumed = follow(id);
      expect(resumed.got[0]).toBe(`${last + 1}:run`);
      expect(resumed.got.at(-1)).toMatch(/:done$/);
      expect((await ctx.service.get(id)).status).toBe('success');
    });

    it('Stop drops a waiting run: stored stopped with waitingFor expired, its turn discarded', async () => {
      ctx = build();
      const suspension = suspendingTurn();
      const id = await launch();
      await ctx.service.live.whenEnded(id);
      expect((await ctx.service.get(id)).status).toBe('suspended');
      const run = await ctx.service.stop(id);
      expect(run.status).toBe('stopped');
      expect(run.waitingFor?.expired).toBe(true);
      expect(suspension.discard).toHaveBeenCalledTimes(1);
    });
  });
});

describe('WorkflowRunsController /workflow-runs/:id/events/stream and /stop (api.md 149, 150)', () => {
  it('replays a held run after a seq and ends with it; 404 before any frame otherwise; Stop answers the stored run', async () => {
    const live = new LiveRuns();
    live.begin('r1');
    live.publish('r1', { type: 'run', runId: 'r1' });
    live.publish('r1', { type: 'text', content: 'Hi' });
    live.publish('r1', { type: 'done', run: { id: 'r1' } });
    live.end('r1');
    const runs = {
      live,
      checkLive: jest.fn((id: string) =>
        id === 'r1'
          ? Promise.resolve()
          : Promise.reject(
              new NotFoundException(`Run "${id}" has no live events`),
            ),
      ),
      stop: jest.fn((id: string) =>
        id === 'nope'
          ? Promise.reject(new NotFoundException(`Run "${id}" not found`))
          : Promise.resolve({
              id,
              status: id === 'r1' ? 'stopped' : 'success',
            }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowRunsController],
      providers: [
        { provide: WorkflowRunsService, useValue: runs },
        { provide: WorkflowNodeChatsService, useValue: {} },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get('/workflow-runs/r1/events/stream?after=1')
        .expect(200);
      expect(res.headers['content-type']).toBe(
        'text/event-stream; charset=utf-8',
      );
      expect(res.text).toBe(
        [
          'data: {"seq":2,"type":"text","content":"Hi"}',
          'data: {"seq":3,"type":"done","run":{"id":"r1"}}',
        ]
          .map((frame) => `${frame}\n\n`)
          .join(''),
      );
      const all = await request(server)
        .get('/workflow-runs/r1/events/stream?after=nonsense')
        .expect(200);
      expect(all.text.startsWith('data: {"seq":1,"type":"run"')).toBe(true);
      await request(server)
        .get('/workflow-runs/gone/events/stream')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Run "gone" has no live events',
          }),
        );
      await request(server)
        .post('/workflow-runs/r1/stop')
        .expect(200, {
          ok: true,
          message: 'Run stopped',
          run: { id: 'r1', status: 'stopped' },
        });
      await request(server)
        .post('/workflow-runs/r2/stop')
        .expect(200, {
          ok: true,
          message: 'Run already ended',
          run: { id: 'r2', status: 'success' },
        });
      await request(server).post('/workflow-runs/nope/stop').expect(404);
    } finally {
      await app.close();
    }
  });
});

describe('WorkflowRunsService: reference images (workflows R35; api.md 151)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  // Bytes that carry the PNG signature, as the input check requires.
  const png = (tail: string) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(tail),
    ]);
  const PNG = png('first');
  const url = (bytes: Buffer) =>
    `data:image/png;base64,${bytes.toString('base64')}`;

  /** Answer a Business Question with an `images` field (the catalogue's, once it has one). */
  function withImagesField() {
    const workflows = ctx.workflows;
    type Definition = Awaited<ReturnType<WorkflowsService['definition']>>;
    const real = workflows.definition.bind(workflows) as (
      id: string,
    ) => Promise<Definition>;
    jest.spyOn(workflows, 'definition').mockImplementation(async (id) => {
      const definition = await real(id);
      return {
        ...definition,
        input: [
          ...definition.input.filter((field) => field.name !== 'images'),
          {
            name: 'images',
            label: 'Reference images',
            type: 'images',
            required: false,
            max: 4,
            usedBy: [],
          },
        ],
      };
    });
  }

  const ASK = {
    question: 'What is in the chart?',
    datasets: ['World Cup Core'],
  };

  it('stores paths only in the input and hands every file to the host', async () => {
    ctx = build();
    withImagesField();
    const second = png('second');
    const { run } = await streamed(ctx, 'answer-business-question', {
      input: { ...ASK, images: [url(PNG), url(second)] },
    });
    expect(run.input.images).toEqual([
      'inputs/images/1.png',
      'inputs/images/2.png',
    ]);
    expect(ctx.sessions.createRunHost).toHaveBeenCalledWith(
      expect.objectContaining({
        inputFiles: [
          { path: 'inputs/images/1.png', data: PNG },
          { path: 'inputs/images/2.png', data: second },
        ],
        inputImages: ['inputs/images/1.png', 'inputs/images/2.png'],
      }),
    );
    // Not the recreate-dashboard single image.
    expect(ctx.sessions.createRunHost.mock.lastCall?.[0]).not.toHaveProperty(
      'image',
    );
  });

  it('a run without images sends no files', async () => {
    ctx = build();
    withImagesField();
    await streamed(ctx, 'answer-business-question', { input: ASK });
    const spec = ctx.sessions.createRunHost.mock.lastCall?.[0];
    expect(spec).not.toHaveProperty('inputFiles');
    expect(spec).not.toHaveProperty('inputImages');
  });

  it('a follow-up turns earlier paths into their files and leaves new images alone', async () => {
    ctx = build();
    withImagesField();
    const first = await streamed(ctx, 'answer-business-question', {
      input: { ...ASK, images: [url(PNG)] },
    });
    ctx.sessions.runHostImage.mockImplementation((_host, path) =>
      path === 'inputs/images/1.png'
        ? Promise.resolve({ data: PNG, mediaType: 'image/png' })
        : Promise.reject(new Error('gone')),
    );
    const fresh = png('fresh');
    await streamed(ctx, 'answer-business-question', {
      input: { ...ASK, images: ['inputs/images/1.png', url(fresh)] },
      context: { fromRunId: first.run.id },
    });
    expect(ctx.sessions.runHostImage).toHaveBeenCalledWith(
      `run-${first.run.id}`,
      'inputs/images/1.png',
    );
    const spec = ctx.sessions.createRunHost.mock.lastCall?.[0];
    expect(spec?.inputFiles).toEqual([
      { path: 'inputs/images/1.png', data: PNG },
      { path: 'inputs/images/2.png', data: fresh },
    ]);
  });

  it('a follow-up naming a path the earlier run does not hold, or a missing file, is refused by the input check', async () => {
    ctx = build();
    withImagesField();
    const first = await streamed(ctx, 'answer-business-question', {
      input: { ...ASK, images: [url(PNG)] },
    });
    await expect(
      ctx.service.prepare('answer-business-question', {
        input: { ...ASK, images: ['inputs/images/1.png'] }, // file is gone
        context: { fromRunId: first.run.id },
      }),
    ).rejects.toThrow('Reference images must be PNG, JPEG or WebP images');
  });

  describe('inputImage (151)', () => {
    it('serves a path of the stored input, and answers 404 for any other', async () => {
      ctx = build();
      withImagesField();
      const { run } = await streamed(ctx, 'answer-business-question', {
        input: { ...ASK, images: [url(PNG)] },
      });
      ctx.sessions.runHostImage.mockResolvedValue({
        data: PNG,
        mediaType: 'image/png',
      });
      await expect(
        ctx.service.inputImage(run.id, 'inputs/images/1.png'),
      ).resolves.toEqual({
        data: PNG,
        mediaType: 'image/png',
      });
      expect(ctx.sessions.runHostImage).toHaveBeenCalledWith(
        `run-${run.id}`,
        'inputs/images/1.png',
      );
      for (const path of [
        'inputs/images/2.png',
        '../x.png',
        'inputs/images/1.gif',
        '',
      ]) {
        await expect(ctx.service.inputImage(run.id, path)).rejects.toThrow(
          `Run "${run.id}" has no image "${path}"`,
        );
      }
      await expect(
        ctx.service.inputImage('nope', 'inputs/images/1.png'),
      ).rejects.toThrow('Run "nope" not found');
    });

    it('answers 404 when the file is gone', async () => {
      ctx = build();
      withImagesField();
      const { run } = await streamed(ctx, 'answer-business-question', {
        input: { ...ASK, images: [url(PNG)] },
      });
      await expect(
        ctx.service.inputImage(run.id, 'inputs/images/1.png'),
      ).rejects.toThrow(`Run "${run.id}" has no image "inputs/images/1.png"`);
    });
  });
});

describe('WorkflowRunsService: a follow-up that asks one agent (workflows R40; api.md 118; agents.md 5.21)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };
  const DATA = [
    {
      tool: 'run_readonly_sql',
      input: 'SELECT year, winner FROM wc.public.cups',
      columns: ['year', 'winner'],
      rows: [{ year: 2002, winner: 'Brazil' }],
      rowCount: 1,
      rationale: 'Every winner.',
    },
  ];

  async function earlier() {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.', data: DATA });
    return (await streamed(ctx, 'answer-business-question', { input: ASK }))
      .run;
  }

  it('runs Write answer alone on a host given the earlier answer, and stores the asked step', async () => {
    const first = await earlier();
    const second = await streamed(ctx, 'answer-business-question', {
      input: { question: 'Shorter, please', datasets: ['World Cup Core'] },
      context: { fromRunId: first.id, askStep: 'write-answer' },
    });
    const spec = ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as {
      ask?: {
        step: string;
        earlier?: { plan: unknown; records: { input?: string }[] };
      };
    };
    expect(spec).toMatchObject({
      runId: second.run.id,
      workflowId: 'answer-business-question',
      context: {
        question: 'Who won in 2002?',
        answer: 'Brazil won in 2002.',
      },
      continuesThreadsOf: `run-${first.id}`,
    });
    expect(spec.ask?.step).toBe('write-answer');
    expect(spec.ask?.earlier?.plan).toEqual(PLAN_OUTPUT.plan);
    expect(spec.ask?.earlier?.records.map((record) => record.input)).toEqual([
      DATA[0].input,
    ]);
    expect(second.run.context).toEqual({
      fromRunId: first.id,
      askStep: 'write-answer',
    });
  });

  it('asks the Analyst from copies of the run threads, with its step context block', async () => {
    const first = await earlier();
    const second = await streamed(ctx, 'answer-business-question', {
      input: { question: 'Why Brazil?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.id, askStep: 'analyse' },
    });
    const spec = ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(spec).toMatchObject({
      workflowId: 'answer-business-question',
      ask: { step: 'analyse' },
      continuesThreadsOf: `run-${first.id}`,
    });
    expect(spec['contextBlock']).toContain('step "Analyse" (analyse)');
    expect(spec['agentKey']).toBeUndefined();
    expect(
      (second.run.context as { askStep?: string } | undefined)?.askStep,
    ).toBe('analyse');
  });

  it.each([
    [{ askStep: 'validate' }, 'Step "validate" has no agent to ask'],
    [{ askStep: 'read-images' }, 'did not run in run'],
    // Check data quality left the workflow.
    [{ askStep: 'check-data-quality' }, 'has no agent to ask'],
  ])('refuses %j before anything runs', async (extra, message) => {
    const first = await earlier();
    ctx.sessions.createRunHost.mockClear();
    const refusal = ctx.service.prepare('answer-business-question', {
      input: ASK,
      context: { fromRunId: first.id, ...extra },
    });
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow(message);
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  });

  it("asks Ryan alone for a new visual of the earlier answer's rows, and logs the visual it stored", async () => {
    const script: TurnScript = { answer: 'Brazil won in 2002.', data: DATA };
    ctx = build(DATASETS, script);
    const first = (
      await streamed(ctx, 'answer-business-question', { input: ASK })
    ).run;
    // The follow-up's turn: Build visual stores Ryan's new visual.
    script.visual = { visualId: 'v-2', title: 'Winners by year' };
    script.answer = `Here's a new visual of the earlier answer: "Winners by year".`;
    const metadata = {
      id: 'v-2',
      title: 'Winners by year',
      description: '',
      path: 'visuals/v-2',
      sourceMessageAt: 't',
      createdAt: 't',
      currentVersion: 1,
      versions: [],
    };
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.resolve({
        id: 'host',
        name: 'Insights Analyst',
        datasets: ['World Cup Core'],
        messages: [],
        visualizations: [metadata],
        panelItems: [],
      } as never),
    );
    const second = await streamed(ctx, 'answer-business-question', {
      input: { question: 'As a line chart', datasets: ['World Cup Core'] },
      context: { fromRunId: first.id, askStep: 'build-visual' },
    });
    const spec = ctx.sessions.createRunHost.mock.calls.at(-1)?.[0] as {
      ask?: {
        step: string;
        earlier?: {
          question?: string;
          answer?: string;
          records: { input?: string }[];
        };
      };
    };
    expect(spec.ask?.step).toBe('build-visual');
    expect(spec.ask?.earlier).toMatchObject({
      question: 'Who won in 2002?',
      answer: 'Brazil won in 2002.',
    });
    expect(spec.ask?.earlier?.records.map((record) => record.input)).toEqual([
      DATA[0].input,
    ]);
    expect(second.run.context).toEqual({
      fromRunId: first.id,
      askStep: 'build-visual',
    });
    expect(second.run.events).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Created interactive visual "Winners by year" (v1).',
        visual: {
          visualId: 'v-2',
          version: 1,
          title: 'Winners by year',
          action: 'created',
        },
      }),
    ]);
  });

  it('refuses to ask Ryan when the earlier answer has no query rows to chart', async () => {
    ctx = build(DATASETS, {
      answer: 'No match was found.',
      data: [{ ...DATA[0], rows: [], rowCount: 0 }],
    });
    const first = (
      await streamed(ctx, 'answer-business-question', { input: ASK })
    ).run;
    ctx.sessions.createRunHost.mockClear();
    const refusal = ctx.service.prepare('answer-business-question', {
      input: ASK,
      context: { fromRunId: first.id, askStep: 'build-visual' },
    });
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow(
      'The earlier answer has no query rows to chart',
    );
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  });

  it('refuses an asked step with no earlier run', async () => {
    ctx = build();
    await expect(
      ctx.service.prepare('answer-business-question', {
        input: ASK,
        context: { askStep: 'plan' },
      }),
    ).rejects.toThrow('Asking one agent needs an earlier run');
  });
});

describe('WorkflowRunsService: progress stored as it happens (data-model 3.16; workflows R20)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };
  const TOOL_FRAME = {
    type: 'tool',
    content: JSON.stringify({ name: 'run_readonly_sql', input: 'select 1' }),
  };

  /** Let every pending write land. */
  const settled = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };

  const launch = async () =>
    ctx.service.launch(
      await ctx.service.prepare('answer-business-question', { input: ASK }),
    );

  /** The stored run's steps as `<id>:<status>`. */
  const storedTrail = async (id: string) =>
    ((await ctx.repository.get(id))?.steps ?? []).map(
      (step) => `${step.id}:${step.status}`,
    );

  /** A second repository over the test's store: the real writes under a spy. */
  const sameStore = () =>
    new WorkflowRunsRepository(new SqliteDocStore(ctx.db, 'workflow_runs'));

  /** The writes that carried only `steps`: the checkpoints. */
  const checkpoints = (
    update: jest.SpyInstance<
      Promise<WorkflowRunDoc | null>,
      [string, Partial<WorkflowRunDoc>]
    >,
  ) =>
    update.mock.calls.filter(
      ([, patch]) => Object.keys(patch).join() === 'steps',
    );

  /**
   * The next turn reports the steps before Analyse and a tool call, waits
   * for `next`, ends Analyse and starts Validate, then waits for `end`.
   */
  function stagedTurn() {
    let next!: () => void;
    let end!: () => void;
    const nextGate = new Promise<void>((resolve) => (next = resolve));
    const endGate = new Promise<void>((resolve) => (end = resolve));
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (_hostId, _question, emit, _signal, _careful, onStep) => {
        for (const step of V2_STEPS_BEFORE) onStep(step);
        emit(TOOL_FRAME);
        await nextGate;
        onStep(stepResult('analyse', ANALYSE_OUTPUT));
        onStep(stepStart('validate', ANALYSE_OUTPUT));
        await endGate;
      },
    );
    return { next, end };
  }

  it('stores each step change while the run runs, the running step included; a tool call rides along with the next step change', async () => {
    ctx = build();
    const update = jest.spyOn(ctx.repository, 'update');
    const turn = stagedTurn();
    const id = await launch();
    await settled();
    expect(await storedTrail(id)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success',
      'analyse:running',
    ]);
    // Nine step changes, coalesced: one write in flight, one queued.
    expect(checkpoints(update)).toHaveLength(2);
    // The tool call alone wrote nothing.
    const analyse = (await ctx.repository.get(id))?.steps.at(-1);
    expect(analyse).not.toHaveProperty('toolCalls');
    turn.next();
    await settled();
    // Two more step changes: one write, then the newer state.
    expect(checkpoints(update)).toHaveLength(4);
    const steps = (await ctx.repository.get(id))?.steps ?? [];
    expect(steps.slice(-2)).toEqual([
      expect.objectContaining({
        id: 'analyse',
        status: 'success',
        toolCalls: [{ tool: 'run_readonly_sql', input: 'select 1' }],
      }),
      expect.objectContaining({ id: 'validate', status: 'running' }),
    ]);
    turn.end();
    await ctx.service.live.whenEnded(id);
    expect((await ctx.repository.get(id))?.status).toBe('success');
  });

  it('a failed checkpoint write is logged and the run still ends success', async () => {
    ctx = build();
    const real = sameStore();
    jest
      .spyOn(ctx.repository, 'update')
      .mockImplementation((id, patch) =>
        Object.keys(patch).join() === 'steps'
          ? Promise.reject(new Error('disk full'))
          : real.update(id, patch),
      );
    const id = await launch();
    await ctx.service.live.whenEnded(id);
    expect((await ctx.repository.get(id))?.status).toBe('success');
  });

  it('the write that ends the run lands after a slow checkpoint, and no checkpoint overwrites it', async () => {
    ctx = build();
    const real = sameStore();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const order: string[] = [];
    let slowed = false;
    jest
      .spyOn(ctx.repository, 'update')
      .mockImplementation(async (id, patch) => {
        const checkpoint = Object.keys(patch).join() === 'steps';
        if (checkpoint && !slowed) {
          slowed = true;
          await gate;
        }
        order.push(checkpoint ? 'checkpoint' : String(patch.status));
        return real.update(id, patch);
      });
    const id = await launch();
    await settled();
    // The turn is over, but its end waits for the checkpoint in flight.
    expect(order).toEqual([]);
    expect((await ctx.repository.get(id))?.status).toBe('running');
    open();
    await ctx.service.live.whenEnded(id);
    expect(order).toEqual(['checkpoint', 'success']);
    const stored = await ctx.repository.get(id);
    expect(stored?.status).toBe('success');
    expect(stored?.steps.find((step) => step.id === 'wrap-up')?.status).toBe(
      'success',
    );
  });

  it('after a restart a run cut off mid-way is failed, keeps its finished steps, and its running step is failed', async () => {
    ctx = build();
    stagedTurn();
    const id = await launch();
    await settled();
    const fresh = ctx.restarted();
    await fresh.onModuleInit();
    const stored = await ctx.repository.get(id);
    expect(stored).toMatchObject({
      status: 'failed',
      error: 'The app stopped before the run finished',
    });
    expect(stored?.steps.map((step) => `${step.id}:${step.status}`)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success',
      'analyse:failed',
    ]);
    expect(stored?.steps.at(-1)?.error).toBe(
      'The app stopped before the run finished',
    );
  });

  it('after a restart a run whose checkpoint stored its step suspended, before the run was stored suspended, is failed with that step failed', async () => {
    ctx = build();
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (_hostId, _question, _emit, _signal, _careful, onStep) => {
        for (const step of V2_STEPS_BEFORE.slice(0, -3)) onStep(step);
        onStep(stepStart('plan', { question: 'Who won in 2002?' }));
        onStep({
          type: 'workflow-step-suspended',
          payload: {
            id: 'plan',
            status: 'suspended',
            suspendPayload: { question: 'Which measure?' },
          },
        });
        // The app stops here, before the end write stores `suspended`.
        await new Promise<void>(() => undefined);
      },
    );
    const id = await launch();
    await settled();
    expect((await storedTrail(id)).at(-1)).toBe('plan:suspended');
    expect((await ctx.repository.get(id))?.status).toBe('running');
    const fresh = ctx.restarted();
    await fresh.onModuleInit();
    const stored = await ctx.repository.get(id);
    expect(stored).toMatchObject({
      status: 'failed',
      error: 'The app stopped before the run finished',
    });
    expect(stored?.steps.at(-1)).toMatchObject({
      id: 'plan',
      status: 'failed',
      error: 'The app stopped before the run finished',
    });
    expect(stored?.steps.some((step) => step.status === 'suspended')).toBe(
      false,
    );
  });

  it('a run that throws while suspending is stored failed with its suspended step failed, not left suspended', async () => {
    ctx = build();
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (_hostId, _question, _emit, _signal, _careful, onStep) => {
        for (const step of V2_STEPS_BEFORE.slice(0, -3)) onStep(step);
        onStep(stepStart('plan', { question: 'Who won in 2002?' }));
        onStep({
          type: 'workflow-step-suspended',
          payload: {
            id: 'plan',
            status: 'suspended',
            suspendPayload: { question: 'Which measure?' },
          },
        });
        await settled();
        return {
          stepId: 'plan',
          question: 'Which measure?',
          options: ['Goals', 'Wins'],
          resume: jest.fn(() => Promise.resolve(undefined)),
          discard: jest.fn(() => Promise.resolve()),
        } as never;
      },
    );
    Object.assign(ctx.sessions, {
      runHostView: jest.fn(() => Promise.reject(new Error('host lost'))),
    });
    const id = await launch();
    await ctx.service.live.whenEnded(id);
    const stored = await ctx.repository.get(id);
    expect(stored).toMatchObject({ status: 'failed', error: 'host lost' });
    expect(stored?.steps.at(-1)).toMatchObject({
      id: 'plan',
      status: 'failed',
      error: 'host lost',
    });
    expect(
      stored?.steps.some(
        (step) => step.status === 'suspended' || step.status === 'running',
      ),
    ).toBe(false);
  });

  it('a run that throws while ending is stored failed with no step left running', async () => {
    ctx = build();
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (_hostId, _question, _emit, _signal, _careful, onStep) => {
        for (const step of V2_STEPS_BEFORE) onStep(step);
        await settled();
      },
    );
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.reject(new Error('host lost')),
    );
    const id = await launch();
    await ctx.service.live.whenEnded(id);
    const stored = await ctx.repository.get(id);
    expect(stored).toMatchObject({ status: 'failed', error: 'host lost' });
    expect(stored?.steps.map((step) => `${step.id}:${step.status}`)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success',
      // The turn ended with Analyse unfinished, so the tracker closed it;
      // the checkpoint had stored it running.
      'analyse:stopped',
    ]);
  });
});

describe('WorkflowRunsService: the cap on live runs (api.md 119 429, 138)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };
  const FULL =
    'Too many runs are in progress (1). Wait for one to finish, or stop one.';

  /** A service whose live runs hold one slot. */
  function buildCapped() {
    ctx = build();
    Object.assign(ctx.service, { live: new LiveRuns(undefined, undefined, 1) });
  }

  const prepared = () =>
    ctx.service.prepare('answer-business-question', { input: ASK });

  /** The next turn waits until released or stopped. */
  function holdTurn(): () => void {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (_hostId, _question, _emit, signal) => {
        await Promise.race([
          released,
          new Promise<void>((resolve) =>
            signal?.addEventListener('abort', () => resolve()),
          ),
        ]);
      },
    );
    return release;
  }

  const refusal = (failure: unknown) => ({
    status: (failure as { getStatus?: () => number }).getStatus?.(),
    message: (failure as Error).message,
  });

  it('two launches together with one slot free: one run, one 429, and nothing stored for the refused one', async () => {
    buildCapped();
    holdTurn();
    const [a, b] = [await prepared(), await prepared()];
    const results = await Promise.allSettled([
      ctx.service.launch(a),
      ctx.service.launch(b),
    ]);
    const started = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refusal(refused[0]?.reason)).toEqual({
      status: 429,
      message: FULL,
    });
    expect(await ctx.repository.list()).toHaveLength(1);
    expect(ctx.sessions.createRunHost).toHaveBeenCalledTimes(1);
  });

  it('the slot frees when the run ends, fails or is stopped', async () => {
    buildCapped();
    const ended = await ctx.service.launch(await prepared());
    await ctx.service.live.whenEnded(ended);
    holdTurn();
    const stopped = await ctx.service.launch(await prepared());
    await expect(ctx.service.launch(await prepared())).rejects.toThrow(FULL);
    await ctx.service.stop(stopped);
    ctx.sessions.streamRunTurn.mockImplementationOnce(() =>
      Promise.reject(new Error('The provider failed')),
    );
    const failed = await ctx.service.launch(await prepared());
    await ctx.service.live.whenEnded(failed);
    expect((await ctx.service.get(failed)).status).toBe('failed');
    const next = await ctx.service.launch(await prepared());
    await ctx.service.live.whenEnded(next);
  });

  it('a run waiting for the user holds no slot, and its resume is never refused', async () => {
    buildCapped();
    const suspension = {
      stepId: 'plan',
      question: 'Which measure?',
      options: ['Goals', 'Wins'],
      resume: jest.fn(() => Promise.resolve(undefined)),
      discard: jest.fn(() => Promise.resolve()),
    };
    ctx.sessions.streamRunTurn.mockImplementationOnce(() =>
      Promise.resolve(suspension as never),
    );
    Object.assign(ctx.sessions, {
      runHostView: jest.fn(() =>
        Promise.resolve({ datasets: ['World Cup Core'] }),
      ),
    });
    const waiting = await ctx.service.launch(await prepared());
    await ctx.service.live.whenEnded(waiting);
    expect((await ctx.service.get(waiting)).status).toBe('suspended');
    const release = holdTurn();
    const other = await ctx.service.launch(await prepared());
    const resume = await ctx.service.prepareResume(waiting, {
      stepId: 'plan',
      answer: 'Goals',
    });
    expect(ctx.service.resumeDetached(resume)).toBe(waiting);
    await ctx.service.live.whenEnded(waiting);
    release();
    await ctx.service.live.whenEnded(other);
  });

  it('a draft run (Try it) holds no slot', async () => {
    buildCapped();
    holdTurn();
    await ctx.service.launch(await prepared());
    const draft = await ctx.service.prepareDraft('sales-helper', {
      input: { question: 'Who won?' },
    });
    await expect(ctx.service.stream(draft, () => undefined)).resolves.toEqual(
      expect.objectContaining({ status: 'success' }),
    );
  });
});

/** The shared set-up of the watchdog and forced-stop specs below. */
function hangingRuns() {
  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };
  const MINUTE = 60_000;
  const state: { ctx?: ReturnType<typeof build> } = {};
  const ctx = () => state.ctx!;

  /**
   * The next turn reports the steps up to Analyse and "Bra", then waits for
   * `release` or, when it honours the abort, its abort; released, it ends
   * Analyse and returns. Its host then answers "Bra" (the partial answer).
   */
  function hangingTurn(honoursAbort = true) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const handle = {
      release: () => release(),
      emit: (() => undefined) as (event: unknown) => void,
      signal: undefined as AbortSignal | undefined,
    };
    ctx().sessions.streamRunTurn.mockImplementationOnce(
      async (_hostId, question, emit, signal, _careful, onStep) => {
        handle.emit = emit;
        handle.signal = signal;
        for (const step of V2_STEPS_BEFORE) onStep(step);
        emit({ type: 'text', content: 'Bra' });
        await Promise.race([
          released,
          ...(honoursAbort
            ? [
                new Promise<void>((resolve) =>
                  signal?.addEventListener('abort', () => resolve()),
                ),
              ]
            : []),
        ]);
        if (!signal?.aborted) onStep(stepResult('analyse', ANALYSE_OUTPUT));
        void question;
      },
    );
    const view = ctx().sessions.finishRunHost.getMockImplementation()!;
    ctx().sessions.finishRunHost.mockImplementationOnce(async () => ({
      ...(await view()),
      messages: [
        { role: 'user', content: ASK.question, at: 't' },
        { role: 'assistant', content: 'Bra', at: 't' },
      ],
    }));
    return handle;
  }

  /** What a follower from seq 0 gets: `<type>[:<content>]`, and its end. */
  function follow(id: string) {
    const got: string[] = [];
    const ended = { value: false };
    ctx().service.live.subscribe(id, 0, {
      event: ({ event }) =>
        got.push(
          typeof event['content'] === 'string'
            ? `${event.type}:${event['content']}`
            : event.type,
        ),
      end: () => (ended.value = true),
    });
    return { got, ended };
  }

  const launch = async () =>
    ctx().service.launch(
      await ctx().service.prepare('answer-business-question', { input: ASK }),
    );

  /** Let pending promise work (sqlite writes, the drive's awaits) land. */
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });
  afterEach(() => {
    jest.useRealTimers();
    state.ctx?.db.close();
  });

  return { ASK, MINUTE, state, ctx, hangingTurn, follow, launch, flush };
}

describe('WorkflowRunsService: a run that makes no progress is ended (workflows spec; ADR-0048 amendment)', () => {
  const t = hangingRuns();
  const STALLED = 'The run made no progress for 15 minutes and was stopped';

  it('a launched run that reports nothing for 15 minutes is failed: its work aborted, its running step failed, its partial answer kept, its host released; a follower sees error { content } and the end', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn();
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE - 1);
    expect(turn.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await t.ctx().service.live.whenEnded(id);
    expect(turn.signal?.aborted).toBe(true);
    // Told apart from a Stop by the abort's reason.
    expect((turn.signal?.reason as Error).message).toBe(STALLED);
    const stored = await t.ctx().repository.get(id);
    expect(stored).toMatchObject({ status: 'failed', error: STALLED });
    expect(stored?.finishedAt).toBeDefined();
    expect(stored?.steps.find((step) => step.id === 'analyse')).toMatchObject({
      status: 'failed',
      error: STALLED,
    });
    expect(stored?.answer?.content).toBe('Bra');
    expect(t.ctx().sessions.finishRunHost).toHaveBeenCalledWith(`run-${id}`);
    expect(watcher.got.at(-1)).toBe(`error:${STALLED}`);
    expect(watcher.got).not.toContain('done');
    expect(watcher.ended.value).toBe(true);
  });

  it('an event at minute 14 resets the clock', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn();
    const id = await t.launch();
    await t.flush();
    await jest.advanceTimersByTimeAsync(14 * t.MINUTE);
    turn.emit({ type: 'reasoning', content: 'thinking' });
    await jest.advanceTimersByTimeAsync(14 * t.MINUTE);
    expect((await t.ctx().repository.get(id))?.status).toBe('running');
    expect(turn.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(t.MINUTE);
    await t.ctx().service.live.whenEnded(id);
    expect((await t.ctx().repository.get(id))?.status).toBe('failed');
  });

  it('a run waiting for the user is never timed, and its resumed turn is', async () => {
    t.state.ctx = build();
    let resumedSignal: AbortSignal | undefined;
    const suspension = {
      stepId: 'plan',
      question: 'Which measure?',
      options: ['Goals', 'Wins'],
      resume: jest.fn(
        (_answer: string, io: { abortSignal?: AbortSignal }) =>
          new Promise<undefined>((resolve) => {
            resumedSignal = io.abortSignal;
            io.abortSignal?.addEventListener('abort', () => resolve(undefined));
          }),
      ),
      discard: jest.fn(() => Promise.resolve()),
    };
    t.ctx().sessions.streamRunTurn.mockImplementationOnce(() =>
      Promise.resolve(suspension as never),
    );
    Object.assign(t.ctx().sessions, {
      runHostView: jest.fn(() =>
        Promise.resolve({ datasets: ['World Cup Core'] }),
      ),
    });
    // What the watchdog calls when its clock runs out.
    const stall = jest.spyOn(
      t.ctx().service as unknown as { stall: () => void },
      'stall',
    );
    const id = await t.launch();
    await t.ctx().service.live.whenEnded(id);
    // Less than the 30-minute wait, more than the no-progress limit.
    await jest.advanceTimersByTimeAsync(20 * t.MINUTE);
    expect((await t.ctx().repository.get(id))?.status).toBe('suspended');
    // The clock was stopped when the run suspended, not merely ignored.
    expect(stall).not.toHaveBeenCalled();
    const prepared = await t.ctx().service.prepareResume(id, {
      stepId: 'plan',
      answer: 'Goals',
    });
    t.ctx().service.resumeDetached(prepared);
    await t.flush();
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    await t.ctx().service.live.whenEnded(id);
    expect(resumedSignal?.aborted).toBe(true);
    expect(await t.ctx().repository.get(id)).toMatchObject({
      status: 'failed',
      error: STALLED,
    });
  });

  it('a Stop during the wait stays stopped', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn();
    const id = await t.launch();
    await t.flush();
    await jest.advanceTimersByTimeAsync(5 * t.MINUTE);
    const run = await t.ctx().service.stop(id);
    expect(run.status).toBe('stopped');
    expect(run.error).toBeUndefined();
    await jest.advanceTimersByTimeAsync(30 * t.MINUTE);
    expect(turn.signal?.aborted).toBe(true);
    expect((await t.ctx().repository.get(id))?.status).toBe('stopped');
  });

  it('the progress checkpoints still land before the final write', async () => {
    t.state.ctx = build();
    const update = jest.spyOn(t.ctx().repository, 'update');
    t.hangingTurn();
    const id = await t.launch();
    await t.flush();
    expect(
      update.mock.calls.some(
        ([, patch]) => Object.keys(patch).join() === 'steps',
      ),
    ).toBe(true);
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    await t.ctx().service.live.whenEnded(id);
    const kinds = update.mock.calls.map(([, patch]) =>
      Object.keys(patch).join() === 'steps' ? 'checkpoint' : patch.status,
    );
    expect(kinds.at(-1)).toBe('failed');
    expect(kinds.slice(0, -1).every((kind) => kind === 'checkpoint')).toBe(
      true,
    );
  });

  it("Try it's streamed draft and the non-streamed 118 are watched too", async () => {
    t.state.ctx = build();
    t.hangingTurn();
    const draft = await t.ctx().service.prepareDraft('sales-helper', {
      input: { question: 'Who won?' },
    });
    const events: RunStreamEvent[] = [];
    const tried = t.ctx().service.stream(draft, (event) => events.push(event));
    await t.flush();
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    await expect(tried).resolves.toMatchObject({
      status: 'failed',
      error: STALLED,
    });
    expect(events.at(-1)).toEqual({ type: 'error', content: STALLED });

    t.hangingTurn();
    const answered = t.ctx().service.run('answer-business-question', {
      input: t.ASK,
    });
    await t.flush();
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    await expect(answered).resolves.toMatchObject({
      status: 'failed',
      error: STALLED,
    });
  });

  it('a stalled run whose work does not unwind is stored failed 10 s later, and its late unwind leaves it failed', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn(false);
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    expect((await t.ctx().repository.get(id))?.status).toBe('running');
    await jest.advanceTimersByTimeAsync(10_000);
    await t.ctx().service.live.whenEnded(id);
    expect(await t.ctx().repository.get(id)).toMatchObject({
      status: 'failed',
      error: STALLED,
    });
    expect(watcher.got.at(-1)).toBe(`error:${STALLED}`);
    expect(watcher.ended.value).toBe(true);
    turn.release();
    await t.flush();
    const stored = await t.ctx().repository.get(id);
    expect(stored).toMatchObject({ status: 'failed', error: STALLED });
    expect(stored?.answer?.content).toBe('Bra');
    expect(t.ctx().sessions.finishRunHost).toHaveBeenCalledTimes(1);
  });

  it("a Stop during a stalled run's 10-second grace wins: the run ends stopped, not failed, and its log ends with done { run }", async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn(false);
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    await jest.advanceTimersByTimeAsync(5_000);
    const answer = t.ctx().service.stop(id);
    await jest.advanceTimersByTimeAsync(10_000);
    const run = await answer;
    expect(run.status).toBe('stopped');
    expect(run.error).toBeUndefined();
    expect(await t.ctx().repository.get(id)).toMatchObject({
      status: 'stopped',
    });
    expect(watcher.got.at(-1)).toBe('done');
    expect(watcher.got).not.toContain(`error:${STALLED}`);
    expect(watcher.ended.value).toBe(true);
    turn.release();
    await t.flush();
    const stored = await t.ctx().repository.get(id);
    expect(stored?.status).toBe('stopped');
    expect(stored?.error).toBeUndefined();
  });
});

describe('WorkflowRunsService: Stop always ends the run (api.md 150; ADR-0048 amendment)', () => {
  const t = hangingRuns();

  /** Stop a run and let its 10-second wait pass. */
  async function stopAfterWait(id: string) {
    const answer = t.ctx().service.stop(id);
    await jest.advanceTimersByTimeAsync(10_000);
    return answer;
  }

  it('Stop whose work does not unwind stores the run stopped itself after 10 s: finishedAt set, its running step stopped, its log ended with done { run }; never running; a second Stop answers it as it is', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn(false);
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    const run = await stopAfterWait(id);
    expect(turn.signal?.aborted).toBe(true);
    expect(run.status).toBe('stopped');
    expect(run.finishedAt).toBeDefined();
    expect(run.steps.map((step) => `${step.id}:${step.status}`)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success',
      'analyse:stopped',
    ]);
    expect(watcher.got.at(-1)).toBe('done');
    expect(watcher.ended.value).toBe(true);
    expect(t.ctx().service.live.isRunning(id)).toBe(false);
    expect((await t.ctx().service.stop(id)).status).toBe('stopped');
  });

  it('the late unwind keeps it stopped, adds the partial answer, releases the host and sends nothing to the ended log', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn(false);
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    await stopAfterWait(id);
    const before = [...watcher.got];
    expect(t.ctx().sessions.finishRunHost).not.toHaveBeenCalled();
    turn.release();
    await t.flush();
    const stored = await t.ctx().repository.get(id);
    expect(stored?.status).toBe('stopped');
    expect(stored?.answer?.content).toBe('Bra');
    expect(t.ctx().sessions.finishRunHost).toHaveBeenCalledWith(`run-${id}`);
    expect(watcher.got).toEqual(before);
    expect(t.follow(id).got).toEqual(before);
  });

  it('a force-stopped run can be deleted; its late unwind stores nothing again and deletes its host resources', async () => {
    t.state.ctx = build();
    const turn = t.hangingTurn(false);
    const id = await t.launch();
    await t.flush();
    await stopAfterWait(id);
    await t.ctx().service.delete(id);
    expect(await t.ctx().repository.get(id)).toBeNull();
    const deletes = t.ctx().sessions.deleteRunHostResources.mock.calls.length;
    turn.release();
    await t.flush();
    expect(await t.ctx().repository.get(id)).toBeNull();
    expect(t.ctx().sessions.deleteRunHostResources).toHaveBeenCalledTimes(
      deletes + 1,
    );
    expect(t.ctx().sessions.deleteRunHostResources).toHaveBeenLastCalledWith(
      `run-${id}`,
    );
  });

  it('Stop whose work unwinds in time is stored by the work, as before', async () => {
    t.state.ctx = build();
    t.hangingTurn();
    const id = await t.launch();
    await t.flush();
    const run = await t.ctx().service.stop(id);
    expect(run.status).toBe('stopped');
    expect(run.answer?.content).toBe('Bra');
  });

  /**
   * The next run host is made only when `release` is called, so a test can
   * Stop (or stall) the run while it is being made.
   */
  function slowHost() {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const make = t.ctx().sessions.createRunHost.getMockImplementation()!;
    t.ctx().sessions.createRunHost.mockImplementationOnce(async (spec) => {
      await released;
      return make(spec);
    });
    return { release: () => release() };
  }

  it('a Stop while the run host is being made ends the run stopped through the normal path, its turn never started, without the 10-second wait', async () => {
    t.state.ctx = build();
    const host = slowHost();
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    const answer = t.ctx().service.stop(id);
    host.release();
    await t.flush();
    // No timer advanced: the run ended on its own, not by the forced stop.
    const run = await answer;
    expect(run.status).toBe('stopped');
    expect(run.finishedAt).toBeDefined();
    expect(t.ctx().sessions.streamRunTurn).not.toHaveBeenCalled();
    expect(t.ctx().sessions.finishRunHost).toHaveBeenCalledWith(`run-${id}`);
    expect(watcher.got.at(-1)).toBe('done');
    expect(watcher.ended.value).toBe(true);
    expect(t.ctx().service.live.isRunning(id)).toBe(false);
  });

  it("a stall while the run host is being made ends the run failed with the watchdog's error, its turn never started", async () => {
    t.state.ctx = build();
    const host = slowHost();
    const id = await t.launch();
    await t.flush();
    const watcher = t.follow(id);
    await jest.advanceTimersByTimeAsync(15 * t.MINUTE);
    host.release();
    await t.flush();
    await t.ctx().service.live.whenEnded(id);
    expect(await t.ctx().repository.get(id)).toMatchObject({
      status: 'failed',
      error: 'The run made no progress for 15 minutes and was stopped',
    });
    expect(t.ctx().sessions.streamRunTurn).not.toHaveBeenCalled();
    expect(t.ctx().sessions.finishRunHost).toHaveBeenCalledWith(`run-${id}`);
    expect(watcher.ended.value).toBe(true);
  });

  it('a Stop before a resume starts ends the run stopped without resuming its turn, the waiting turn dropped', async () => {
    t.state.ctx = build();
    const suspension = {
      stepId: 'plan',
      question: 'Which measure?',
      options: ['Goals', 'Wins'],
      resume: jest.fn(() => Promise.resolve(undefined)),
      discard: jest.fn(() => Promise.resolve()),
    };
    t.ctx().sessions.streamRunTurn.mockImplementationOnce(() =>
      Promise.resolve(suspension as never),
    );
    Object.assign(t.ctx().sessions, {
      runHostView: jest.fn(() =>
        Promise.resolve({ datasets: ['World Cup Core'] }),
      ),
    });
    const id = await t.launch();
    await t.ctx().service.live.whenEnded(id);
    const prepared = await t.ctx().service.prepareResume(id, {
      stepId: 'plan',
      answer: 'Goals',
    });
    // The Stop lands while the resume stores the run running again.
    let stored!: () => void;
    const storing = new Promise<void>((resolve) => (stored = resolve));
    const repository = t.ctx().repository;
    const update = jest
      .spyOn(repository, 'update')
      .mockImplementationOnce(async (...args) => {
        await storing;
        update.mockRestore();
        return repository.update(...args);
      });
    t.ctx().service.resumeDetached(prepared);
    const answer = t.ctx().service.stop(id);
    await t.flush();
    stored();
    await t.flush();
    const run = await answer;
    expect(run.status).toBe('stopped');
    expect(suspension.resume).not.toHaveBeenCalled();
    expect(suspension.discard).toHaveBeenCalledTimes(1);
    expect(t.ctx().sessions.finishRunHost).toHaveBeenCalledWith(`run-${id}`);
    expect(t.ctx().service.live.isRunning(id)).toBe(false);
  });
});
