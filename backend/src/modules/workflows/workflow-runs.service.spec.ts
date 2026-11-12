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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from '../agents/agents.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { WorkflowRun, WorkflowRunDoc } from './workflow-run-steps';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import {
  WorkflowRunsService,
  type RunStreamEvent,
} from './workflow-runs.service';
import { WorkflowRunsController } from './workflow-runs.controller';
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

/** What the Analyse step of `qti-v2-turn` (and agent-turn's Answer) ends with. */
const ANALYSE_OUTPUT = { calls: [], stopped: false };
/** What Wrap up ends with: the run's output. */
const WRAP_UP_OUTPUT = { sqlQueries: 0, failedQueries: 0, rows: 0 };

/** The steps `qti-v2-turn` reports before its agent step's turn streams. */
const V2_STEPS_BEFORE: StepEvent[] = [
  stepStart('receive-question', {
    question: 'Who won in 2002?',
    datasets: ['World Cup Core'],
  }),
  stepResult('receive-question', { question: 'Who won in 2002?' }),
  stepStart('load-catalog', { question: 'Who won in 2002?' }),
  stepResult('load-catalog', { entities: 1 }),
  stepStart('analyse', { question: 'Who won in 2002?' }),
];

const DATASETS = [
  { name: 'World Cup Core', datasourceKind: 'postgres' },
  { name: 'Claims', datasourceKind: 'databricks' },
];

/**
 * What the fake run host's turn does. A `qti-v2-turn` host reports its four
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
    'assistant-v2': fakeAgent('Questions to Insights v2', ['run_readonly_sql']),
    'data-readiness': fakeAgent('Data Readiness Agent', ['assess_readiness']),
  };
  const deleteMemoryThread = jest.fn().mockResolvedValue(undefined);
  const mastra = {
    listAgents: () => registry,
    deleteMemoryThread,
  } as unknown as MastraService;
  const agents = new AgentsService(mastra, userAgents);
  const workflows = new WorkflowsService(agents);
  let hostMessages: { role: string; content: string; at: string }[] = [];
  let draftHost = false;
  const sessions = {
    createRunHost: jest.fn(
      (spec: {
        runId: string;
        draftAgentId?: string;
        context?: { question: string; answer: string };
      }) => {
        draftHost = !!spec.draftAgentId;
        hostMessages = spec.context
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
          onStep(stepStart('wrap-up', ANALYSE_OUTPUT));
          onStep(stepResult('wrap-up', WRAP_UP_OUTPUT));
        }
        hostMessages.push({
          role: 'assistant',
          content: script.answer ?? 'Brazil won.',
          at: 't',
        });
        emit({ type: 'done', session: { id: 'host' } });
        await Promise.resolve();
      },
    ),
    finishRunHost: jest.fn(() =>
      Promise.resolve({
        id: 'host',
        name: 'Questions to Insights v2',
        datasets: ['World Cup Core'],
        messages: hostMessages,
        visualizations: [],
        panelItems: [],
        workflowRef: {
          id: 'qti-v2-turn',
          name: 'Questions to Insights v2',
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
    // A run-backed host as the API shows it (api.md 2.1): derived fields.
    toView: jest.fn((host: { id: string; panelItems?: unknown[] }) =>
      Promise.resolve({
        ...host,
        panelItems: host.panelItems ?? [],
        workflow: { phases: [], source: 'workflow' },
        agent: {
          id: 'assistant-v2',
          name: 'Questions to Insights v2',
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
  const service = new WorkflowRunsService(
    workflows,
    sessions as unknown as SessionsService,
    datasetsRepository,
    mastra,
    repository,
  );
  return {
    db,
    service,
    repository,
    deleteMemoryThread,
    /** The same store and collaborators after a backend restart. */
    restarted: () =>
      new WorkflowRunsService(
        workflows,
        sessions as unknown as SessionsService,
        datasetsRepository,
        mastra,
        new WorkflowRunsRepository(new SqliteDocStore(db, 'workflow_runs')),
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
  ])('Questions to Insights v2 refuses %p with %p', async (body, message) => {
    ctx = build();
    await refuse('qti-v2-turn', body, message);
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
      'qti-v2-turn',
      {
        input: { question: 'And 2018?', datasets: ['Claims'] },
        context: { fromRunId: 'gone' },
      },
      'Run "gone" not found',
    );
  });
});

describe('WorkflowRunsService: a Questions to Insights v2 run (agents.md 5.14)', () => {
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
    const { events, run } = await streamed(ctx, 'qti-v2-turn', {
      input: { ...ASK, careful: true, extra: 'ignored' },
    });

    expect(ctx.sessions.createRunHost).toHaveBeenCalledWith({
      runId: run.id,
      workflowId: 'qti-v2-turn',
      name: 'Questions to Insights v2',
      datasets: ['World Cup Core'],
    });
    // Careful is no field of v2's input: the turn runs without it.
    expect(ctx.sessions.streamRunTurn).toHaveBeenCalledWith(
      `run-${run.id}`,
      'Who won in 2002?',
      expect.any(Function),
      undefined,
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
      'analyse:running',
      'tool',
      'text',
      'analyse:success',
      'wrap-up:running',
      'wrap-up:success',
      'done',
    ]);
    expect(events[0]).toEqual({
      type: 'run',
      runId: run.id,
      workflowId: 'qti-v2-turn',
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
    expect(events[8]).toEqual({
      type: 'step',
      id: 'analyse',
      title: 'Analyse',
      status: 'success',
      input: { question: 'Who won in 2002?' },
      output: ANALYSE_OUTPUT,
      startedAt: expect.any(String) as string,
      endedAt: expect.any(String) as string,
      // The turn's `tool` event is the step's call; no result came for it.
      toolCalls: [{ tool: 'run_readonly_sql' }],
    });
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(run).toMatchObject({
      workflowId: 'qti-v2-turn',
      workflowName: 'Questions to Insights v2',
      input: {
        question: '  Who won in 2002?  ',
        datasets: ['World Cup Core'],
      },
      status: 'success',
      steps: [
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success', output: { entities: 1 } },
        {
          id: 'analyse',
          title: 'Analyse',
          status: 'success',
          output: ANALYSE_OUTPUT,
        },
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
    // Every step has its start and end times, the end never before the start.
    for (const step of run.steps) {
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
    const { events, run } = await streamed(ctx, 'qti-v2-turn', {
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
    const { events, run } = await streamed(ctx, 'qti-v2-turn', {
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
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        {
          id: 'analyse',
          status: 'failed',
          error: 'The endpoint rejected the API key (401)',
        },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
    expect(stepTrail(events).slice(-2)).toEqual([
      'analyse:failed',
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
      'qti-v2-turn',
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
      'analyse:running',
      'text',
    ]);
    expect(run.status).toBe('stopped');
    expect(run.steps.slice(2)).toEqual([
      {
        id: 'analyse',
        title: 'Analyse',
        status: 'stopped',
        input: { question: 'Who won in 2002?' },
        startedAt: expect.any(String) as string,
        endedAt: expect.any(String) as string,
      },
      { id: 'wrap-up', title: 'Wrap up', status: 'skipped' },
    ]);
    expect(ctx.sessions.streamRunTurn.mock.calls[0][3]).toBe(abort.signal);
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledTimes(1);
  });

  it("gives a later run the earlier run's question and answer as context (plan 5.4)", async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, 'qti-v2-turn', { input: ASK });
    const second = await streamed(ctx, 'qti-v2-turn', {
      input: { question: 'And in 2014?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    expect(ctx.sessions.createRunHost).toHaveBeenLastCalledWith({
      runId: second.run.id,
      workflowId: 'qti-v2-turn',
      name: 'Questions to Insights v2',
      datasets: ['World Cup Core'],
      context: {
        question: 'Who won in 2002?',
        answer: 'Brazil won in 2002.',
      },
    });
    expect(second.run.context).toEqual({ fromRunId: first.run.id });
    // The answer is this run's, never the context's.
    expect(second.run.answer?.content).toBe('Brazil won in 2002.');
    expect(second.run.question).toBe('And in 2014?');
  });

  it('rates the stored answer of a run (api.md 128)', async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, 'qti-v2-turn', { input: ASK });

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
      'qti-v2-turn',
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
    const first = await streamed(ctx, 'qti-v2-turn', { input: ASK });
    await streamed(ctx, 'qti-v2-turn', {
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
      'qti-v2-turn',
      { input: ASK },
      abort.signal,
    );
    await expect(
      ctx.service.prepare('qti-v2-turn', {
        input: ASK,
        context: { fromRunId: stopped.run.id },
      }),
    ).rejects.toThrow(`Run "${stopped.run.id}" has no answer to continue from`);
  });

  it('POST /runs (118) answers the run as the stream ends it, and stores it', async () => {
    ctx = build();
    const run = await ctx.service.run('qti-v2-turn', { input: ASK });
    expect(run).toMatchObject({
      workflowId: 'qti-v2-turn',
      status: 'success',
      answer: { content: 'Brazil won.' },
      output: WRAP_UP_OUTPUT,
    });
    await expect(ctx.service.get(run.id)).resolves.toEqual(run);
    // A refusal stores nothing.
    await expect(ctx.service.run('qti-v2-turn', {})).rejects.toThrow(
      'Question is required',
    );
    expect(await ctx.repository.list()).toHaveLength(1);
  });

  it('stores a run when it starts, as running, and step by step as it ends', async () => {
    ctx = build();
    const atStart: unknown[] = [];
    const prepared = await ctx.service.prepare('qti-v2-turn', { input: ASK });
    const run = await ctx.service.stream(prepared, (event) => {
      if (event.type === 'run') {
        void ctx.repository.get(event.runId).then((doc) => atStart.push(doc));
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(atStart[0]).toMatchObject({ id: run.id, status: 'running' });
    const stored = await ctx.repository.get(run.id);
    expect(stored).toMatchObject({ status: 'success', output: WRAP_UP_OUTPUT });
    // Each stored step keeps what it received and its times.
    for (const step of stored!.steps) {
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
    const runs = {
      prepare: jest.fn((id: string, body: { input?: { question?: string } }) =>
        id !== 'qti-v2-turn'
          ? Promise.reject(new NotFoundException(`Workflow "${id}" not found`))
          : body.input?.question
            ? Promise.resolve({ id })
            : Promise.reject(new BadRequestException('Question is required')),
      ),
      stream: jest.fn((_prepared: unknown, emit: (event: unknown) => void) => {
        emit({ type: 'run', runId: 'r1', workflowId: 'qti-v2-turn' });
        emit({ type: 'text', content: 'Hi' });
        emit({ type: 'done', run });
        return Promise.resolve(run);
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
        .post('/workflows/qti-v2-turn/runs/stream')
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
      expect(runs.stream).not.toHaveBeenCalled();
      const res = await request(server)
        .post('/workflows/qti-v2-turn/runs/stream')
        .send({ input: { question: 'Hi' } })
        .expect(200);
      expect(res.headers['content-type']).toBe(
        'text/event-stream; charset=utf-8',
      );
      expect(res.text).toBe(
        [
          'data: {"type":"run","runId":"r1","workflowId":"qti-v2-turn"}',
          'data: {"type":"text","content":"Hi"}',
          'data: {"type":"done","run":{"id":"r1","status":"success"}}',
        ]
          .map((frame) => `${frame}\n\n`)
          .join(''),
      );
      expect(runs.prepare).toHaveBeenLastCalledWith('qti-v2-turn', {
        input: { question: 'Hi' },
      });
    } finally {
      await app.close();
    }
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
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });
    expect(atTurn).toMatchObject({
      id: run.id,
      workflowId: 'qti-v2-turn',
      workflowName: 'Questions to Insights v2',
      input: ASK,
      status: 'running',
      steps: [],
      datasets: [],
      ownerId: 'local',
    });
    expect((atTurn as { startedAt?: string }).startedAt).toBe(run.startedAt);
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
    const { run, events } = await streamed(ctx, 'qti-v2-turn', {
      input: ASK,
    });
    const stored = await ctx.repository.get(run.id);
    expect(stored).toMatchObject({
      status: 'success',
      steps: [
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'analyse', status: 'success' },
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
      agent: { id: 'assistant-v2' },
      workflow: { source: 'workflow' },
      panelItems: [{ id: 'p1' }],
    });
    expect(ctx.sessions.toView).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: `run-${run.id}`, run: true }),
    );
  });

  it('stores a failed run with its error, and a stopped one as stopped', async () => {
    ctx = build(DATASETS, { throws: new Error('Model error') });
    const failed = await streamed(ctx, 'qti-v2-turn', { input: ASK });
    await expect(ctx.repository.get(failed.run.id)).resolves.toMatchObject({
      status: 'failed',
      error: 'Model error',
      steps: [
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'analyse', status: 'failed', error: 'Model error' },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
    ctx.db.close();
    const abort = new AbortController();
    ctx = build(DATASETS, { abort });
    const stopped = await streamed(
      ctx,
      'qti-v2-turn',
      { input: ASK },
      abort.signal,
    );
    await expect(ctx.repository.get(stopped.run.id)).resolves.toMatchObject({
      status: 'stopped',
      steps: [
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'analyse', status: 'stopped' },
        { id: 'wrap-up', status: 'skipped' },
      ],
    });
  });

  it('stores the run as failed when ending the host throws, and rethrows', async () => {
    ctx = build();
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full')),
    );
    const prepared = await ctx.service.prepare('qti-v2-turn', {
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
    const first = await streamed(ctx, 'qti-v2-turn', { input: ASK });
    const after = ctx.restarted();
    const prepared = await after.prepare('qti-v2-turn', {
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
    expect(ctx.deleteMemoryThread).toHaveBeenCalledWith('run-left');
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
    const v2 = await streamed(ctx, 'qti-v2-turn', { input: ASK });
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
        workflowId: 'qti-v2-turn',
        workflowName: 'Questions to Insights v2',
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
      (await ctx.service.list('qti-v2-turn')).map((run) => run.id),
    ).toEqual([v2.run.id]);
    expect(
      (await ctx.service.list('seq-text-demo')).map((run) => run.id),
    ).toEqual(['old-seq']);
  });

  it('gets one run with its derived views, or 404 Run "<id>" not found', async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });
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
      const prepared = await ctx.service.prepare('qti-v2-turn', {
        input: { question: 'Why?', datasets: ['World Cup Core'] },
        context: { fromRunId: DEEP_RUN.id },
      });
      expect(prepared.context).toEqual({
        fromRunId: DEEP_RUN.id,
        question: DEEP_RUN.question,
        answer: DEEP_RUN.answer!.content,
      });
      const refusal = ctx.service.prepare('qti-v2-turn', {
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
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });
    await ctx.service.delete(run.id);
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
      `run-${run.id}`,
    );
    await expect(ctx.repository.get(run.id)).resolves.toBeNull();
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
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });
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
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });

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
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });
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
    const { run } = await streamed(ctx, 'qti-v2-turn', { input: ASK });
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

describe('WorkflowRunsController /workflow-runs (api.md 120-127)', () => {
  it('lists, gets, deletes and serves the files of runs', async () => {
    const runs = {
      list: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      get: jest.fn((id: string) =>
        id === 'r1'
          ? Promise.resolve({ id: 'r1', status: 'success' })
          : Promise.reject(new NotFoundException(`Run "${id}" not found`)),
      ),
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
      providers: [{ provide: WorkflowRunsService, useValue: runs }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .get('/workflow-runs')
        .expect(200, { runs: [{ id: 'r1' }] });
      expect(runs.list).toHaveBeenLastCalledWith(undefined);
      await request(server)
        .get('/workflow-runs?workflowId=agent%3Aassistant')
        .expect(200);
      expect(runs.list).toHaveBeenLastCalledWith('agent:assistant');
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
      undefined,
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
});
