// The run host is the sessions service's; here it is a fake.
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));
jest.mock('./workflows.service', () => ({ WorkflowsService: class {} }));

import { NotFoundException } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { QTI_V2_TURN_STEPS } from '../../mastra/workflows/qti-v2-turn.steps';
import type { SessionsService } from '../sessions/sessions.service';
import { WorkflowNodeChatsRepository } from './repositories/workflow-node-chats.repository';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import {
  WorkflowNodeChatsService,
  type NodeChatStreamEvent,
} from './workflow-node-chats.service';
import type { WorkflowRunDoc } from './workflow-run-steps';
import type { WorkflowsService } from './workflows.service';

const ANALYSE_INPUT = {
  question: 'How many goals in 2022?',
  catalog: [{ entity: 'world_cup.goals', dataset: 'World Cup Core' }],
};
const ANALYSE_OUTPUT = {
  calls: [{ tool: 'run_readonly_sql', rowCount: 1, failed: false }],
  stopped: false,
};

const RUN: WorkflowRunDoc = {
  id: 'r-1',
  workflowId: 'qti-v2-turn',
  workflowName: 'Questions to Insights v2',
  input: { question: 'How many goals in 2022?', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [
    { id: 'receive-question', title: 'Receive question', status: 'success' },
    { id: 'load-catalog', title: 'Load catalog', status: 'success' },
    {
      id: 'analyse',
      title: 'Analyse',
      status: 'success',
      input: ANALYSE_INPUT,
      output: ANALYSE_OUTPUT,
      toolCalls: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT count(*) FROM world_cup.goals',
          rowCount: 1,
        },
      ],
    },
    { id: 'wrap-up', title: 'Wrap up', status: 'skipped' },
  ],
  answer: { role: 'assistant', content: '172 goals.', at: 't' },
  question: 'How many goals in 2022?',
  datasets: ['World Cup Core'],
  startedAt: '2026-11-12T10:00:00.000Z',
  finishedAt: '2026-11-12T10:00:10.000Z',
};

/** The catalogue as the runs see it: `qti-v2-turn`, Analyse its agent step. */
const workflows = {
  definition: jest.fn((id: string) =>
    id === 'qti-v2-turn'
      ? Promise.resolve({
          id,
          name: 'Questions to Insights v2',
          steps: QTI_V2_TURN_STEPS.map((step) => ({
            ...step,
            input: [...step.input],
            output: [...step.output],
            exits: [...step.exits],
            ...(step.kind === 'agent'
              ? {
                  agent: {
                    name: 'Questions to Insights v2',
                    tools: ['run_readonly_sql'],
                    maxSteps: 8,
                    key: 'assistant-v2',
                  },
                }
              : {}),
          })),
        })
      : Promise.reject(new NotFoundException(`Workflow "${id}" not found`)),
  ),
} as unknown as WorkflowsService;

interface Script {
  events?: { type: string; content?: string }[];
  answer?: string;
  throws?: Error;
  abort?: AbortController;
}

const stepStart = (id: string, payload: unknown) => ({
  type: 'workflow-step-start',
  payload: { id, payload },
});

function build(script: Script = {}) {
  const db = new BetterSqlite3(':memory:');
  const runs = new WorkflowRunsRepository(
    new SqliteDocStore(db, 'workflow_runs'),
  );
  const chats = new WorkflowNodeChatsRepository(
    new SqliteDocStore(db, 'workflow_run_node_chats'),
  );
  let hostMessages: { role: string; content: string; at: string }[] = [];
  const sessions = {
    createRunHost: jest.fn(
      (spec: {
        runId: string;
        transcript?: { role: string; content: string }[];
      }) => {
        hostMessages = (spec.transcript ?? []).map((m) => ({ ...m, at: 't' }));
        return Promise.resolve({ id: `run-${spec.runId}` });
      },
    ),
    streamRunTurn: jest.fn(
      async (
        _hostId: string,
        question: string,
        emit: (event: { type: string; content?: string }) => void,
        _signal: AbortSignal | undefined,
        _careful: boolean,
        onStep: (event: unknown) => void,
      ) => {
        hostMessages.push({ role: 'user', content: question, at: 't' });
        // A node chat's turn is the step's agent alone, on agent-turn's one
        // Answer step (agents.md 5.16), never a run of the whole workflow.
        onStep(stepStart('answer', ANALYSE_INPUT));
        emit({ type: 'workflow', content: '{}' });
        for (const event of script.events ?? []) emit(event);
        if (script.abort) {
          script.abort.abort();
          return;
        }
        if (script.throws) throw script.throws;
        onStep({
          type: 'workflow-step-result',
          payload: { id: 'answer', status: 'success', output: {} },
        });
        hostMessages.push({
          role: 'assistant',
          content: script.answer ?? 'It is 172.',
          at: 't',
        });
        emit({ type: 'done' });
        await Promise.resolve();
      },
    ),
    finishRunHost: jest.fn(() =>
      Promise.resolve({ id: 'host', messages: hostMessages }),
    ),
    deleteRunHostResources: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WorkflowNodeChatsService(
    workflows,
    sessions as unknown as SessionsService,
    runs,
    chats,
  );
  return { db, runs, chats, sessions, service };
}

async function chat(
  ctx: ReturnType<typeof build>,
  content: string,
  signal?: AbortSignal,
) {
  const events: NodeChatStreamEvent[] = [];
  const prepared = await ctx.service.prepare('r-1', 'analyse', { content });
  const message = await ctx.service.stream(
    prepared,
    (event) => events.push(event),
    signal,
  );
  return { events, message };
}

describe('WorkflowNodeChatsService: refusals before any SSE frame (api.md 137)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(async () => {
    ctx = build();
    await ctx.runs.insert(RUN);
  });
  afterEach(() => ctx.db.close());

  const refusal = async (
    runId: string,
    stepId: string,
    body: unknown,
  ): Promise<{ status: number; message: string }> => {
    try {
      await ctx.service.prepare(runId, stepId, body);
    } catch (error) {
      const e = error as { getStatus(): number; message: string };
      return { status: e.getStatus(), message: e.message };
    }
    throw new Error('not refused');
  };

  it('refuses an unknown run, a blank message, a code step, an unknown step and a step that did not run', async () => {
    expect(await refusal('nope', 'analyse', { content: 'Why?' })).toEqual({
      status: 404,
      message: 'Run "nope" not found',
    });
    expect(await refusal('r-1', 'analyse', { content: '  \n ' })).toEqual({
      status: 400,
      message: 'Message is required',
    });
    expect(await refusal('r-1', 'analyse', {})).toEqual({
      status: 400,
      message: 'Message is required',
    });
    expect(await refusal('r-1', 'load-catalog', { content: 'Why?' })).toEqual({
      status: 400,
      message: 'Step "load-catalog" has no agent to chat with',
    });
    expect(await refusal('r-1', 'ghost', { content: 'Why?' })).toEqual({
      status: 400,
      message: 'Step "ghost" has no agent to chat with',
    });
    await ctx.runs.update('r-1', {
      steps: RUN.steps.map((step) =>
        step.id === 'analyse' ? { ...step, status: 'skipped' as const } : step,
      ),
    });
    expect(await refusal('r-1', 'analyse', { content: 'Why?' })).toEqual({
      status: 400,
      message: 'Step "analyse" did not run in this run',
    });
    await ctx.runs.update('r-1', { steps: [] });
    expect(await refusal('r-1', 'analyse', { content: 'Why?' })).toEqual({
      status: 400,
      message: 'Step "analyse" did not run in this run',
    });
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
    expect(await ctx.chats.get('r-1', 'analyse')).toBeNull();
  });

  it("accepts v2's agent steps Plan and Write answer, refuses its code steps Clarify and Validate, and reads a retried step's last attempt", async () => {
    await ctx.runs.update('r-1', {
      steps: [
        ...RUN.steps.slice(0, 2),
        { id: 'plan', title: 'Plan', status: 'success' },
        { id: 'clarify', title: 'Clarify', status: 'skipped' },
        { ...RUN.steps[2], attempt: 1, status: 'success' },
        { ...RUN.steps[2], attempt: 2, status: 'success' },
        { id: 'validate', title: 'Validate', status: 'success', attempt: 1 },
        { id: 'validate', title: 'Validate', status: 'success', attempt: 2 },
        { id: 'write-answer', title: 'Write answer', status: 'success' },
        RUN.steps[3],
      ],
    });
    for (const stepId of ['plan', 'write-answer']) {
      await expect(
        ctx.service.prepare('r-1', stepId, { content: 'Why?' }),
      ).resolves.toMatchObject({ step: { id: stepId } });
    }
    await expect(
      ctx.service.prepare('r-1', 'analyse', { content: 'Why?' }),
    ).resolves.toMatchObject({ step: { id: 'analyse', attempt: 2 } });
    for (const stepId of ['clarify', 'validate']) {
      expect(await refusal('r-1', stepId, { content: 'Why?' })).toEqual({
        status: 400,
        message: `Step "${stepId}" has no agent to chat with`,
      });
    }
  });

  it('refuses a running run with 409 and a run of a removed workflow with 404', async () => {
    await ctx.runs.update('r-1', { status: 'running' });
    expect(await refusal('r-1', 'analyse', { content: 'Why?' })).toEqual({
      status: 409,
      message: 'The run is still running',
    });
    await ctx.runs.insert({
      ...RUN,
      id: 'old',
      workflowId: 'deep-analysis',
      workflowName: 'Deep analysis',
    });
    expect(await refusal('old', 'analyse', { content: 'Why?' })).toEqual({
      status: 404,
      message: 'Workflow "deep-analysis" not found',
    });
  });
});

describe('WorkflowNodeChatsService: a chat turn (api.md 136, 137; agents.md 5.16)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('runs the step agent on its own host with the context block, streams the turn events, then done with the stored message', async () => {
    ctx = build({
      events: [
        { type: 'reasoning', content: 'thinking' },
        {
          type: 'tool',
          content: JSON.stringify({
            name: 'run_readonly_sql',
            input: 'SELECT 1',
          }),
        },
        {
          type: 'tool-result',
          content: JSON.stringify({
            tool: 'run_readonly_sql',
            input: 'SELECT 1',
            rowCount: 1,
          }),
        },
        { type: 'text', content: 'It is ' },
        { type: 'text', content: '172.' },
      ],
    });
    await ctx.runs.insert(RUN);
    const { events, message } = await chat(ctx, '  Why 172?  ');
    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'tool',
      'tool-result',
      'text',
      'text',
      'done',
    ]);
    const spec = ctx.sessions.createRunHost.mock.calls[0][0] as unknown as {
      runId: string;
      workflowId: string;
      datasets: string[];
      transcript: unknown[];
      contextBlock: string;
    };
    expect(spec).toMatchObject({
      runId: 'r-1-node-analyse',
      workflowId: 'qti-v2-turn',
      datasets: ['World Cup Core'],
      transcript: [],
    });
    expect(spec.contextBlock).toContain('step "Analyse" (analyse) of run r-1');
    expect(spec.contextBlock).toContain('SELECT count(*) FROM world_cup.goals');
    expect(ctx.sessions.streamRunTurn.mock.calls[0][1]).toBe('Why 172?');
    expect(message).toMatchObject({
      role: 'assistant',
      content: 'It is 172.',
      toolCalls: [{ tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 1 }],
    });
    expect(message.stopped).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: 'done', message });
    // The host, its memory thread and its workspace are gone.
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledWith(
      'run-r-1-node-analyse',
    );
    expect(ctx.sessions.deleteRunHostResources).toHaveBeenCalledWith(
      'run-r-1-node-analyse',
    );
    // Stored: the user message, then the assistant's; the run unchanged.
    const stored = await ctx.service.messages('r-1', 'analyse');
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Why 172?'],
      ['assistant', 'It is 172.'],
    ]);
    expect(stored[1]).toEqual(message);
    const run = await ctx.runs.get('r-1');
    expect({ ...run, createdAt: undefined, updatedAt: undefined }).toEqual({
      ...RUN,
      ownerId: 'local',
      createdAt: undefined,
      updatedAt: undefined,
    });
  });

  it('replays the earlier messages as the transcript of the next turn', async () => {
    ctx = build();
    await ctx.runs.insert(RUN);
    await chat(ctx, 'First?');
    await chat(ctx, 'Second?');
    const spec = ctx.sessions.createRunHost.mock.calls[1][0] as unknown as {
      transcript: unknown[];
    };
    expect(spec.transcript).toEqual([
      { role: 'user', content: 'First?' },
      { role: 'assistant', content: 'It is 172.' },
    ]);
    expect(
      (await ctx.service.messages('r-1', 'analyse')).map((m) => m.content),
    ).toEqual(['First?', 'It is 172.', 'Second?', 'It is 172.']);
  });

  it('stores a failed turn with its error and sends error', async () => {
    ctx = build({
      events: [{ type: 'text', content: 'Part' }],
      throws: new Error('Model error'),
    });
    await ctx.runs.insert(RUN);
    const { events, message } = await chat(ctx, 'Why?');
    expect(events.at(-1)).toEqual({ type: 'error', content: 'Model error' });
    expect(message).toMatchObject({
      role: 'assistant',
      content: 'Part',
      error: 'Model error',
    });
    expect((await ctx.service.messages('r-1', 'analyse'))[1]).toEqual(message);
  });

  it('stores a stopped turn with what came, marked stopped, and sends nothing more', async () => {
    const abort = new AbortController();
    ctx = build({ events: [{ type: 'text', content: 'Half an' }], abort });
    await ctx.runs.insert(RUN);
    const { events, message } = await chat(ctx, 'Why?', abort.signal);
    expect(events.map((event) => event.type)).toEqual(['text']);
    expect(message).toMatchObject({ content: 'Half an', stopped: true });
    expect((await ctx.service.messages('r-1', 'analyse'))[1]).toEqual(message);
  });

  it('answers an empty list for a step nobody chatted with, and 404 for an unknown run', async () => {
    ctx = build();
    await ctx.runs.insert(RUN);
    await expect(ctx.service.messages('r-1', 'analyse')).resolves.toEqual([]);
    await expect(ctx.service.messages('nope', 'analyse')).rejects.toThrow(
      'Run "nope" not found',
    );
  });
});
