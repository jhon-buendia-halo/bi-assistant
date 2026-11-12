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
// The sequential test workflow runs on the engine stand-in.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import { seqTextDemoWorkflow } from '../../mastra/workflows/seq-text-demo.workflow';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from '../agents/agents.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { WorkflowRun } from './workflow-run-steps';
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

type StubWorkflow = {
  createRun(): Promise<{
    stream(args: { inputData: unknown }): {
      fullStream: AsyncIterable<unknown>;
      result: Promise<unknown>;
    };
  }>;
};

const DATASETS = [
  { name: 'World Cup Core', datasourceKind: 'postgres' },
  { name: 'Claims', datasourceKind: 'databricks' },
];

/** What the fake run host's turn does. */
interface TurnScript {
  events?: { type: string; content?: string }[];
  steps?: {
    type: string;
    payload: {
      id: string;
      status?: string;
      payload?: unknown;
      output?: unknown;
      error?: unknown;
    };
  }[];
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
  const runWorkflow = jest.fn();
  const streamWorkflow = jest.fn(async (key: string, inputData: unknown) => {
    if (key !== 'seq-text-demo') throw new Error(`no stand-in for ${key}`);
    const workflow = seqTextDemoWorkflow as unknown as StubWorkflow;
    return (await workflow.createRun()).stream({ inputData });
  });
  const deleteMemoryThread = jest.fn().mockResolvedValue(undefined);
  const mastra = {
    listAgents: () => registry,
    runWorkflow,
    streamWorkflow,
    deleteMemoryThread,
  } as unknown as MastraService;
  const agents = new AgentsService(mastra, userAgents);
  const workflows = new WorkflowsService(agents);
  let hostMessages: { role: string; content: string; at: string }[] = [];
  const sessions = {
    createRunHost: jest.fn(
      (spec: {
        runId: string;
        context?: { question: string; answer: string };
      }) => {
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
        for (const step of script.steps ?? [
          { type: 'workflow-step-start', payload: { id: 'answer' } },
        ]) {
          onStep(step);
        }
        for (const event of script.events ?? []) emit(event);
        if (script.abort) {
          script.abort.abort();
          return;
        }
        if (script.throws) throw script.throws;
        onStep({
          type: 'workflow-step-result',
          payload: {
            id: 'answer',
            status: 'success',
            output: { calls: [], stopped: false },
          },
        });
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
        name: 'Assistant',
        datasets: ['World Cup Core'],
        messages: hostMessages,
        visualizations: [],
        panelItems: [],
        workflowRef: {
          id: 'agent:assistant',
          name: 'Assistant',
          kind: 'agent',
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
        workflow: { phases: [], source: 'agent' },
        agent: { id: 'assistant', name: 'Assistant', deleted: false },
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
    runWorkflow,
    streamWorkflow,
    workflows,
  };
}

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

const READINESS_REQUIREMENT = 'Add a PostgreSQL or Databricks dataset first';

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
    [{ input: { question: 'Who won?' } }, 'Select at least one dataset'],
    [
      { input: { question: 'Who won?', datasets: ['Nope'] } },
      'Dataset "Nope" not found',
    ],
    [
      { input: { question: 'Who won?', datasets: ['Claims'], careful: 'yes' } },
      'Careful: cross-check the result with an independent query must be true or false',
    ],
  ])('the Assistant refuses %p with %p', async (body, message) => {
    ctx = build();
    await refuse('agent:assistant', body, message);
  });

  it.each([
    [{ input: { datasets: ['Claims'] } }, 'Question is required'],
    [
      { input: { question: 'Who won?', datasets: [] } },
      'Select at least one dataset',
    ],
  ])('Questions to Insights v2 refuses %p with %p', async (body, message) => {
    ctx = build();
    await refuse('qti-v2-turn', body, message);
  });

  it.each([
    [{ input: {} }, 'Dataset is required'],
    [{ input: { dataset: 'Nope' } }, 'Dataset "Nope" not found'],
  ])('the Data Readiness Agent refuses %p with %p', async (body, message) => {
    ctx = build([...DATASETS, { name: 'Orders API', datasourceKind: 'rest' }]);
    await refuse('agent:data-readiness', body, message);
  });

  it('the Data Readiness Agent refuses a dataset of another kind', async () => {
    ctx = build([...DATASETS, { name: 'Orders API', datasourceKind: 'rest' }]);
    await refuse(
      'agent:data-readiness',
      { input: { dataset: 'Orders API' } },
      'Dataset "Orders API" is not a PostgreSQL or Databricks dataset',
    );
  });

  it('refuses a workflow while its run requirement holds', async () => {
    ctx = build([{ name: 'Orders API', datasourceKind: 'rest' }]);
    await refuse('agent:data-readiness', { input: {} }, READINESS_REQUIREMENT);
  });

  it("answers the removed RFP Builder's workflow as not found", async () => {
    ctx = build();
    const refusal = ctx.service.prepare('agent:rfp', {
      input: { message: 'Start', rfpId: 'r-1' },
    });
    await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
    await expect(refusal).rejects.toThrow('Workflow "agent:rfp" not found');
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  });

  it('a user agent refuses a run while none of its datasets exist, and one without a question', async () => {
    ctx = build();
    const gone = await ctx.userAgents.create({
      name: 'Gone',
      description: '',
      instructions: '',
      datasets: ['Nowhere'],
      starterQuestions: [],
    });
    await ctx.userAgents.publish(gone.id);
    await refuse(
      `agent:${gone.id}`,
      { input: { question: 'Hi' } },
      "None of this agent's datasets exist",
    );
    const live = await ctx.userAgents.create({
      name: 'Historian',
      description: '',
      instructions: '',
      datasets: ['World Cup Core'],
      starterQuestions: [],
    });
    await ctx.userAgents.publish(live.id);
    await refuse(`agent:${live.id}`, { input: {} }, 'Question is required');
  });

  it('answers 404 for a workflow the catalogue does not list', async () => {
    ctx = build();
    for (const id of ['nope', 'agent:sql-fixer', 'agent-turn']) {
      await expect(ctx.service.prepare(id, { input: {} })).rejects.toThrow(
        new NotFoundException(`Workflow "${id}" not found`),
      );
    }
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
      'agent:assistant',
      {
        input: { question: 'And 2018?', datasets: ['Claims'] },
        context: { fromRunId: 'gone' },
      },
      'Run "gone" not found',
    );
  });
});

describe('WorkflowRunsService: an agent workflow run (agents.md 5.14)', () => {
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
    const { events, run } = await streamed(ctx, 'agent:assistant', {
      input: { ...ASK, careful: true, extra: 'ignored' },
    });

    expect(ctx.sessions.createRunHost).toHaveBeenCalledWith({
      runId: run.id,
      workflowId: 'agent:assistant',
      name: 'Assistant',
      datasets: ['World Cup Core'],
    });
    expect(ctx.sessions.streamRunTurn).toHaveBeenCalledWith(
      `run-${run.id}`,
      'Who won in 2002?',
      expect.any(Function),
      undefined,
      true,
      expect.any(Function),
    );
    // The host is discarded once, after the turn.
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledTimes(1);
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledWith(`run-${run.id}`);
    expect(events.map((event) => event.type)).toEqual([
      'run',
      'step',
      'tool',
      'text',
      'step',
      'done',
    ]);
    expect(events[0]).toEqual({
      type: 'run',
      runId: run.id,
      workflowId: 'agent:assistant',
    });
    expect(events[1]).toEqual({
      type: 'step',
      id: 'answer',
      title: 'Answer',
      status: 'running',
      startedAt: expect.any(String) as string,
    });
    expect(events[4]).toEqual({
      type: 'step',
      id: 'answer',
      title: 'Answer',
      status: 'success',
      output: { calls: [], stopped: false },
      startedAt: expect.any(String) as string,
      endedAt: expect.any(String) as string,
      // The turn's `tool` event is the step's call; no result came for it.
      toolCalls: [{ tool: 'run_readonly_sql' }],
    });
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(run).toMatchObject({
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      input: {
        question: '  Who won in 2002?  ',
        datasets: ['World Cup Core'],
        careful: true,
      },
      status: 'success',
      steps: [
        {
          id: 'answer',
          title: 'Answer',
          status: 'success',
          output: { calls: [], stopped: false },
        },
      ],
      output: { calls: [], stopped: false },
      question: 'Who won in 2002?',
      answer: { role: 'assistant', content: 'Brazil won.' },
      datasets: ['World Cup Core'],
      panelItems: [],
      visualizations: [],
    });
    expect(run.finishedAt).toBeDefined();
    await expect(ctx.service.get(run.id)).resolves.toEqual(run);
  });

  it("attaches the turn's tool calls to its running agent step, in the step events and the stored run", async () => {
    ctx = build(DATASETS, {
      steps: [
        {
          type: 'workflow-step-start',
          payload: {
            id: 'answer',
            payload: { question: 'Who won?', datasets: ['World Cup Core'] },
          },
        },
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
    const { events, run } = await streamed(ctx, 'agent:assistant', {
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
    const steps = events.filter((event) => event.type === 'step');
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
    expect(run.steps[0].toolCalls).toEqual(calls);
    const stored = await ctx.repository.get(run.id);
    expect(stored?.steps[0]).toMatchObject({
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
    const { events, run } = await streamed(ctx, 'agent:assistant', {
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
        {
          id: 'answer',
          status: 'failed',
          error: 'The endpoint rejected the API key (401)',
        },
      ],
    });
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
      'agent:assistant',
      { input: ASK },
      abort.signal,
    );
    // What streamed before the stop was sent; nothing after it.
    expect(events.map((event) => event.type)).toEqual(['run', 'step', 'text']);
    expect(run.status).toBe('stopped');
    expect(run.steps).toEqual([
      {
        id: 'answer',
        title: 'Answer',
        status: 'stopped',
        startedAt: expect.any(String) as string,
        endedAt: expect.any(String) as string,
      },
    ]);
    expect(ctx.sessions.streamRunTurn.mock.calls[0][3]).toBe(abort.signal);
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledTimes(1);
  });

  it("gives a later run the earlier run's question and answer as context (plan 5.4)", async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const first = await streamed(ctx, 'agent:assistant', { input: ASK });
    const second = await streamed(ctx, 'agent:assistant', {
      input: { question: 'And in 2014?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    expect(ctx.sessions.createRunHost).toHaveBeenLastCalledWith({
      runId: second.run.id,
      workflowId: 'agent:assistant',
      name: 'Assistant',
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
    const first = await streamed(ctx, 'agent:assistant', { input: ASK });

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
      'agent:assistant',
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
    const first = await streamed(ctx, 'agent:assistant', { input: ASK });
    await streamed(ctx, 'agent:assistant', {
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
      'agent:assistant',
      { input: ASK },
      abort.signal,
    );
    await expect(
      ctx.service.prepare('agent:assistant', {
        input: ASK,
        context: { fromRunId: stopped.run.id },
      }),
    ).rejects.toThrow(`Run "${stopped.run.id}" has no answer to continue from`);
  });

  it('POST /runs (118) answers an agent run as the stream ends it', async () => {
    ctx = build();
    const run = (await ctx.service.run('agent:assistant', {
      input: ASK,
    })) as WorkflowRun;
    expect(run).toMatchObject({
      workflowId: 'agent:assistant',
      status: 'success',
      answer: { content: 'Brazil won.' },
    });
    expect(ctx.runWorkflow).not.toHaveBeenCalled();
  });
});

describe('WorkflowRunsService: a code-only workflow run (api.md 118, 119)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('118 runs it once on its checked input, as before', async () => {
    ctx = build();
    const outcome = {
      workflowId: 'seq-text-demo',
      status: 'success',
      steps: [],
    };
    ctx.runWorkflow.mockResolvedValue(outcome);
    const answer = (await ctx.service.run('seq-text-demo', {
      input: { text: ' a ', extra: 1 },
    })) as typeof outcome & { runId: string };
    expect(answer).toEqual({
      ...outcome,
      runId: expect.any(String) as string,
    });
    expect(ctx.runWorkflow).toHaveBeenCalledWith('seq-text-demo', {
      text: ' a ',
    });
    await expect(ctx.service.run('seq-text-demo', {})).rejects.toThrow(
      'Text is required',
    );
    // 118 stores the run too (plan 5.1), and a refusal stores nothing.
    const stored = await ctx.repository.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: answer.runId,
      workflowId: 'seq-text-demo',
      workflowName: 'Sequential test workflow',
      input: { text: ' a ' },
      status: 'success',
      steps: [],
      datasets: [],
    });
    expect(stored[0].finishedAt).toBeDefined();
  });

  it('118 stores a code-only run as failed when its engine throws, and rethrows', async () => {
    ctx = build();
    ctx.runWorkflow.mockRejectedValue(new Error('engine down'));
    await expect(
      ctx.service.run('seq-text-demo', { input: { text: 'a' } }),
    ).rejects.toThrow('engine down');
    const [stored] = await ctx.repository.list();
    expect(stored).toMatchObject({ status: 'failed', error: 'engine down' });
  });

  it('119 stores a code-only run when it starts and when it ends', async () => {
    ctx = build();
    const atStart: unknown[] = [];
    const prepared = await ctx.service.prepare('seq-text-demo', {
      input: { text: 'Hello world' },
    });
    const run = await ctx.service.stream(prepared, (event) => {
      if (event.type === 'run') {
        void ctx.repository.get(event.runId).then((doc) => atStart.push(doc));
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(atStart[0]).toMatchObject({ id: run.id, status: 'running' });
    await expect(ctx.repository.get(run.id)).resolves.toMatchObject({
      status: 'success',
      output: { summary: '2 words, 11 characters: "Hello world"' },
    });
  });

  it('119 streams each step and ends with done', async () => {
    ctx = build();
    const { events, run } = await streamed(ctx, 'seq-text-demo', {
      input: { text: '  Hello   workflow   world  ' },
    });
    expect(
      events.map((event) =>
        event.type === 'step' ? `${event.id}:${event.status}` : event.type,
      ),
    ).toEqual([
      'run',
      'clean-text:running',
      'clean-text:success',
      'count-words:running',
      'count-words:success',
      'format-result:running',
      'format-result:success',
      'done',
    ]);
    expect(run).toMatchObject({
      workflowId: 'seq-text-demo',
      status: 'success',
      output: { summary: '3 words, 20 characters: "Hello workflow world"' },
      datasets: [],
    });
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  });

  it('119 step events and the stored run carry what each step received, its output and its times', async () => {
    ctx = build();
    const { events, run } = await streamed(ctx, 'seq-text-demo', {
      input: { text: ' Hi  there ' },
    });
    const steps = events.filter((event) => event.type === 'step');
    expect(steps[0]).toEqual({
      type: 'step',
      id: 'clean-text',
      title: 'Clean text',
      status: 'running',
      input: { text: ' Hi  there ' },
      startedAt: expect.any(String) as string,
    });
    expect(steps[1]).toMatchObject({
      id: 'clean-text',
      status: 'success',
      input: { text: ' Hi  there ' },
      output: { text: 'Hi there' },
    });
    // Each step receives the one before it's output.
    expect(steps[2]).toMatchObject({
      id: 'count-words',
      status: 'running',
      input: { text: 'Hi there' },
    });
    const stored = await ctx.repository.get(run.id);
    for (const step of stored!.steps) {
      expect(step.input).toBeDefined();
      expect(Date.parse(step.startedAt!)).not.toBeNaN();
      expect(Date.parse(step.endedAt!)).toBeGreaterThanOrEqual(
        Date.parse(step.startedAt!),
      );
    }
  });

  it('119 reports a failed step, skips the rest, and still ends with done', async () => {
    ctx = build();
    const { events, run } = await streamed(ctx, 'seq-text-demo', {
      input: { text: '   ' },
    });
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(run.status).toBe('failed');
    expect(run.error).toBe('The text is empty');
    expect(run.steps.map((step) => [step.id, step.status, step.error])).toEqual(
      [
        ['clean-text', 'failed', 'The text is empty'],
        ['count-words', 'skipped', undefined],
        ['format-result', 'skipped', undefined],
      ],
    );
  });
});

describe('WorkflowsController POST /workflows/:id/runs/stream (api.md 119)', () => {
  it('answers a refusal with its status before any stream, and streams SSE frames otherwise', async () => {
    const run = { id: 'r1', status: 'success' };
    const runs = {
      prepare: jest.fn((id: string) =>
        id === 'agent:assistant'
          ? Promise.resolve({ id })
          : Promise.reject(new BadRequestException('Question is required')),
      ),
      stream: jest.fn((_prepared: unknown, emit: (event: unknown) => void) => {
        emit({ type: 'run', runId: 'r1', workflowId: 'agent:assistant' });
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
      expect(runs.stream).not.toHaveBeenCalled();
      const res = await request(server)
        .post('/workflows/agent%3Aassistant/runs/stream')
        .send({ input: { question: 'Hi' } })
        .expect(200);
      expect(res.headers['content-type']).toBe(
        'text/event-stream; charset=utf-8',
      );
      expect(res.text).toBe(
        [
          'data: {"type":"run","runId":"r1","workflowId":"agent:assistant"}',
          'data: {"type":"text","content":"Hi"}',
          'data: {"type":"done","run":{"id":"r1","status":"success"}}',
        ]
          .map((frame) => `${frame}\n\n`)
          .join(''),
      );
      expect(runs.prepare).toHaveBeenLastCalledWith('agent:assistant', {
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

  it('stores an agent run when it starts, as running with its input and workflow', async () => {
    ctx = build();
    let atTurn: unknown;
    ctx.sessions.streamRunTurn.mockImplementationOnce(
      async (hostId: string) => {
        atTurn = await ctx.repository.get(hostId.slice('run-'.length));
      },
    );
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });
    expect(atTurn).toMatchObject({
      id: run.id,
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      input: { ...ASK, careful: false },
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
    const { run, events } = await streamed(ctx, 'agent:assistant', {
      input: ASK,
    });
    const stored = await ctx.repository.get(run.id);
    expect(stored).toMatchObject({
      status: 'success',
      steps: [{ id: 'answer', status: 'success' }],
      output: { calls: [], stopped: false },
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
      agent: { id: 'assistant' },
      workflow: { source: 'agent' },
      panelItems: [{ id: 'p1' }],
    });
    expect(ctx.sessions.toView).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: `run-${run.id}`, run: true }),
    );
  });

  it('stores a failed run with its error, and a stopped one as stopped', async () => {
    ctx = build(DATASETS, { throws: new Error('Model error') });
    const failed = await streamed(ctx, 'agent:assistant', { input: ASK });
    await expect(ctx.repository.get(failed.run.id)).resolves.toMatchObject({
      status: 'failed',
      error: 'Model error',
      steps: [{ id: 'answer', status: 'failed', error: 'Model error' }],
    });
    ctx.db.close();
    const abort = new AbortController();
    ctx = build(DATASETS, { abort });
    const stopped = await streamed(
      ctx,
      'agent:assistant',
      { input: ASK },
      abort.signal,
    );
    await expect(ctx.repository.get(stopped.run.id)).resolves.toMatchObject({
      status: 'stopped',
      steps: [{ id: 'answer', status: 'stopped' }],
    });
  });

  it('stores the run as failed when ending the host throws, and rethrows', async () => {
    ctx = build();
    ctx.sessions.finishRunHost.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full')),
    );
    const prepared = await ctx.service.prepare('agent:assistant', {
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
    const first = await streamed(ctx, 'agent:assistant', { input: ASK });
    const after = ctx.restarted();
    const prepared = await after.prepare('agent:assistant', {
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

describe('WorkflowRunsService: the run history (api.md 120-127)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  const ASK = { question: 'Who won in 2002?', datasets: ['World Cup Core'] };

  it('lists summaries newest first, filtered by workflow, titled from the question or the first text input', async () => {
    ctx = build();
    const agent = await streamed(ctx, 'agent:assistant', { input: ASK });
    const code = await streamed(ctx, 'seq-text-demo', {
      input: { text: '  Hello world  ' },
    });
    // Same-millisecond starts would tie: order by the stored startedAt.
    await ctx.repository.update(agent.run.id, {
      startedAt: '2026-11-11T10:00:00.000Z',
    });
    await ctx.repository.update(code.run.id, {
      startedAt: '2026-11-11T11:00:00.000Z',
    });
    const all = await ctx.service.list();
    expect(all).toEqual([
      {
        id: code.run.id,
        workflowId: 'seq-text-demo',
        workflowName: 'Sequential test workflow',
        status: 'success',
        title: 'Hello world',
        startedAt: '2026-11-11T11:00:00.000Z',
        finishedAt: code.run.finishedAt,
      },
      {
        id: agent.run.id,
        workflowId: 'agent:assistant',
        workflowName: 'Assistant',
        status: 'success',
        title: 'Who won in 2002?',
        startedAt: '2026-11-11T10:00:00.000Z',
        finishedAt: agent.run.finishedAt,
      },
    ]);
    expect(
      (await ctx.service.list('agent:assistant')).map((run) => run.id),
    ).toEqual([agent.run.id]);
  });

  it('gets one run with its derived views, or 404 Run "<id>" not found', async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });
    await expect(ctx.service.get(run.id)).resolves.toEqual(run);
    await expect(ctx.service.get('nope')).rejects.toThrow(
      new NotFoundException('Run "nope" not found'),
    );
    const code = await streamed(ctx, 'seq-text-demo', { input: { text: 'a' } });
    const fetched = await ctx.service.get(code.run.id);
    expect(fetched).toEqual(code.run);
    expect(fetched).not.toHaveProperty('agent');
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
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });
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

  it('deletes a code-only run without touching any workspace', async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'seq-text-demo', {
      input: { text: 'a' },
    });
    await ctx.service.delete(run.id);
    expect(ctx.sessions.deleteRunHostResources).not.toHaveBeenCalled();
    await expect(ctx.repository.get(run.id)).resolves.toBeNull();
  });

  it("serves a run's files through the session file services, given its run-backed host", async () => {
    ctx = build();
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });
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
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });

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
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });
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
    const { run } = await streamed(ctx, 'agent:assistant', { input: ASK });
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
