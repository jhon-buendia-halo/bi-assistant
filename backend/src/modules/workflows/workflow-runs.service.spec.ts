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
    payload: { id: string; status?: string; output?: unknown; error?: unknown };
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
    rfp: fakeAgent('RFP Builder', ['create_rfp']),
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
    downloadVisualizationOf: jest.fn(() =>
      Promise.resolve({
        filename: 'goals-v1.zip',
        archive: Buffer.from('zip'),
      }),
    ),
    downloadRfpPackageOf: jest.fn(() =>
      Promise.resolve({
        filename: 'rfp-acme.zip',
        contentType: 'application/zip',
        body: Buffer.from('zip'),
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
const RFP_REQUIREMENT =
  'Load the "Intellify RFP API" sample in Settings → Testing Data first';

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
    ctx = build([
      ...DATASETS,
      { name: 'Intellify RFP API', datasourceKind: 'rest' },
    ]);
    await refuse('agent:data-readiness', body, message);
  });

  it('the Data Readiness Agent refuses a dataset of another kind', async () => {
    ctx = build([
      ...DATASETS,
      { name: 'Intellify RFP API', datasourceKind: 'rest' },
    ]);
    await refuse(
      'agent:data-readiness',
      { input: { dataset: 'Intellify RFP API' } },
      'Dataset "Intellify RFP API" is not a PostgreSQL or Databricks dataset',
    );
  });

  it('refuses a workflow while its run requirement holds', async () => {
    ctx = build([{ name: 'Intellify RFP API', datasourceKind: 'rest' }]);
    await refuse('agent:data-readiness', { input: {} }, READINESS_REQUIREMENT);
    ctx.db.close();
    ctx = build();
    await refuse('agent:rfp', { input: { message: 'Start' } }, RFP_REQUIREMENT);
  });

  it('the RFP Builder refuses a run without a message', async () => {
    ctx = build([
      ...DATASETS,
      { name: 'Intellify RFP API', datasourceKind: 'rest' },
    ]);
    await refuse(
      'agent:rfp',
      { input: { rfpId: 'r-1' } },
      'Message is required',
    );
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
    jest.spyOn(ctx.workflows, 'get').mockResolvedValue({
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
    });
    expect(events[4]).toEqual({
      type: 'step',
      id: 'answer',
      title: 'Answer',
      status: 'success',
      output: { calls: [], stopped: false },
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
      { id: 'answer', title: 'Answer', status: 'stopped' },
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

  it("an RFP Continue gives the run the RFP, the last proposal and the earlier run's stages (plan 4.3)", async () => {
    ctx = build(
      [...DATASETS, { name: 'Intellify RFP API', datasourceKind: 'rest' }],
      { answer: 'Stage 1: Orchard Manufacturing renews on 1 January 2027. Confirm?' },
    );
    const stages = {
      current: 1,
      done: [],
      updatedAt: '2026-11-11T10:00:00.000Z',
    };
    const finishView = ctx.sessions.finishRunHost.getMockImplementation()!;
    ctx.sessions.finishRunHost.mockImplementationOnce(async () => ({
      ...(await finishView()),
      rfpId: 'rfp-1',
      workflowState: stages,
    }));
    const first = await streamed(ctx, 'agent:rfp', {
      input: { message: 'Start an RFP for Orchard Manufacturing, plan year 2027' },
    });
    expect(first.run.rfpId).toBe('rfp-1');
    const second = await streamed(ctx, 'agent:rfp', {
      input: { message: 'yes', rfpId: 'rfp-1' },
      context: { fromRunId: first.run.id },
    });
    expect(ctx.sessions.createRunHost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: second.run.id,
        workflowId: 'agent:rfp',
        rfpId: 'rfp-1',
        workflowState: stages,
        context: {
          question: 'Start an RFP for Orchard Manufacturing, plan year 2027',
          answer:
            'Stage 1: Orchard Manufacturing renews on 1 January 2027. Confirm?',
        },
      }),
    );
    expect(second.run.question).toBe('yes');
    expect(second.run.input).toEqual({ message: 'yes', rfpId: 'rfp-1' });
  });

  it("a context run of another RFP, or none, does not carry the earlier run's stages", async () => {
    ctx = build(DATASETS, { answer: 'Brazil won in 2002.' });
    const finishView = ctx.sessions.finishRunHost.getMockImplementation()!;
    ctx.sessions.finishRunHost.mockImplementationOnce(async () => ({
      ...(await finishView()),
      workflowState: { current: 2, done: [1], updatedAt: 't' },
    }));
    const first = await streamed(ctx, 'agent:assistant', { input: ASK });
    await streamed(ctx, 'agent:assistant', {
      input: { question: 'And in 2014?', datasets: ['World Cup Core'] },
      context: { fromRunId: first.run.id },
    });
    expect(ctx.sessions.createRunHost.mock.lastCall?.[0]).not.toHaveProperty(
      'workflowState',
    );
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
        name: 'RFP Builder',
        datasets: ['Intellify RFP API'],
        messages: [
          { role: 'user', content: 'Start an RFP', at: 't1' },
          { role: 'assistant', content: 'Which client?', at: 't2' },
        ],
        agentKey: 'rfp',
        agentName: 'RFP Builder',
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
        agent: { id: 'rfp', name: 'RFP Builder', deleted: false },
        workflowRef: {
          id: 'agent:rfp',
          name: 'RFP Builder',
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
      datasets: ['Intellify RFP API'],
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      rfpId: 'rfp-1',
      visualizations: [{ id: 'v1', title: 'Goals' }],
      panelItems: [{ id: 'p1', kind: 'document' }],
      workflowState: { phases: [], updatedAt: 't' },
    });
    expect(stored?.finishedAt).toBeDefined();
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
    await ctx.service.downloadRfpPackage(run.id, 'rfp-1', 'rfp.md', true);
    expect(ctx.sessions.downloadRfpPackageOf).toHaveBeenCalledWith(
      host,
      'rfp-1',
      'rfp.md',
      true,
    );
    await expect(ctx.service.panelItemFile('nope', 'p1')).rejects.toThrow(
      new NotFoundException('Run "nope" not found'),
    );
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
      downloadRfpPackage: jest.fn().mockResolvedValue({
        filename: 'rfp-acme.zip',
        contentType: 'application/zip',
        body: Buffer.from('zip'),
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
      const pkg = await request(server)
        .get(
          '/workflow-runs/r1/rfp-packages/rfp-1/download?file=rfp.md&draft=true',
        )
        .expect(200);
      expect(runs.downloadRfpPackage).toHaveBeenCalledWith(
        'r1',
        'rfp-1',
        'rfp.md',
        true,
      );
      expect(pkg.headers['content-disposition']).toBe(
        'attachment; filename="rfp-acme.zip"',
      );
    } finally {
      await app.close();
    }
  });
});
