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
import {
  HELD_RUNS,
  WorkflowRunsService,
  type RunStreamEvent,
} from './workflow-runs.service';
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
  const mastra = {
    listAgents: () => registry,
    runWorkflow,
    streamWorkflow,
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
  };
  const datasetsRepository = {
    list: jest.fn().mockResolvedValue(datasets),
  } as unknown as DatasetsRepository;
  const service = new WorkflowRunsService(
    workflows,
    sessions as unknown as SessionsService,
    datasetsRepository,
    mastra,
  );
  return {
    db,
    service,
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
    expect(ctx.service.held(run.id)).toEqual(run);
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

  it('forgets the oldest run beyond the held ones, with its workspace', async () => {
    ctx = build();
    const ids: string[] = [];
    for (let i = 0; i <= HELD_RUNS; i++) {
      ids.push((await streamed(ctx, 'agent:assistant', { input: ASK })).run.id);
    }
    expect(ctx.service.held(ids[0])).toBeUndefined();
    expect(ctx.service.held(ids[1])).toBeDefined();
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledTimes(1);
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
      `run-${ids[0]}`,
    );
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
    await expect(
      ctx.service.run('seq-text-demo', { input: { text: ' a ', extra: 1 } }),
    ).resolves.toBe(outcome);
    expect(ctx.runWorkflow).toHaveBeenCalledWith('seq-text-demo', {
      text: ' a ',
    });
    await expect(ctx.service.run('seq-text-demo', {})).rejects.toThrow(
      'Text is required',
    );
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
