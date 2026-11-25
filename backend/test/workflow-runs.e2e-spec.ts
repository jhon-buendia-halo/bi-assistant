/**
 * API-level proof of streamed runs (ADR-0041; api.md 118, 119; agents.md
 * 5.23; workflows R14-R16) of Answer a Business Question (Avery + Michael)
 * (`orchestrated-answer-michael`), the one question-answering workflow:
 * `POST /workflows/:id/runs/stream` runs its one step, Orchestrate, where
 * Avery briefs Michael through `answer_from_data` and his answer is the
 * run's, on a run host through the turn engine, so a run asks the stub
 * model with the agents' tools, streams `run`, the `step` with what it
 * received, its output and its times, the turn's events and `done { run }`,
 * waits when Michael asks the user (138), fails when the model fails,
 * refuses a bad request (and every removed workflow, `context.askStep`
 * included) with its real status before any stream, and keeps running when
 * the connection closes until Stop (150, ADR-0048). `POST
 * /workflows/:id/runs` (118) answers the stored run.
 *
 * Needs no Postgres but for the last describe (skipped when the World Cup
 * one is down): the datasources point at closed ports. The stub moves
 * Avery by herself (`averyAuto`: brief Michael, then close with no words),
 * so a spec scripts Michael only. Set `WORKFLOW_RUNS_TRANSCRIPT=<file>` to
 * write the SSE transcript of one run there.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import {
  averyAuto,
  averyToolResult,
  messageText,
  startLlmStub,
  STUB_ANSWER,
  type LlmStub,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import { type Backend, boot, stop } from './backend-process';
import { ASK_WORKFLOW_ID } from '../../frontend/e2e/helpers/runs-api';
import {
  WORLD_CUP_CONNECTION,
  runSql,
  worldCupIsUp,
  worldCupPool,
} from './world-cup';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-workflow-runs-'));

jest.setTimeout(180_000);

interface Frame {
  type: string;
  content?: string;
  runId?: string;
  workflowId?: string;
  id?: string;
  title?: string;
  status?: string;
  attempt?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  /** `input-required` (api.md 119, 138). */
  stepId?: string;
  question?: string;
  options?: string[];
  expiresAt?: string;
  run?: {
    id: string;
    workflowId: string;
    status: string;
    steps: {
      id: string;
      status: string;
      attempt?: number;
      input?: Record<string, unknown>;
      startedAt?: string;
      endedAt?: string;
    }[];
    question?: string;
    answer?: { role: string; content: string };
    datasets: string[];
    output?: Record<string, unknown>;
  };
}

/** What a run on the stub model streams: Avery's one step. */
const ORCHESTRATE_TRAIL = ['orchestrate:running', 'orchestrate:success'];

/** A step frame or stored step as `id:status[:attempt]`. */
const trail = (step: { id?: string; status?: string; attempt?: number }) =>
  `${step.id}:${step.status}${step.attempt ? `:${step.attempt}` : ''}`;

/** The frames of an SSE body (api.md 3.1 framing). */
function framesOf(text: string): Frame[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as Frame);
}

/**
 * The workspace a turn's file tools are scoped to names its session, so two
 * chats differ there too: `session-<id>` for a chat, `session-run-<id>` for
 * a run (agents.md 5.14). Everything else must be equal.
 */
const WORKSPACE_DIR = /workspaces[\\/]session-[A-Za-z0-9_-]+/g;

/** A model request as the provider sees it, for comparing two turns. */
function asSent(req: StubRequest) {
  return {
    path: req.path,
    stream: req.stream,
    messages: req.messages.map((message) =>
      typeof message.content === 'string'
        ? {
            ...message,
            content: message.content.replace(
              WORKSPACE_DIR,
              'workspaces/session-<host>',
            ),
          }
        : message,
    ),
    tools: req.tools,
    reasoningEffort: req.reasoningEffort,
    model: req.model,
    avery: req.avery === true,
  };
}

/** Whether a request is Michael's: his instructions open its system messages. */
function isMichaelRequest(req: { messages: StubRequest['messages'] }) {
  const system = req.messages.find((message) => message.role === 'system');
  return (
    !!system && messageText(system).startsWith('You are Questions to Insights')
  );
}

describe('Streamed runs of Answer a Business Question (Avery + Michael) (API)', () => {
  let backend: Backend | undefined;
  let stub: LlmStub;
  const http = () => request.agent(backend!.url);
  const transcript: string[] = [];
  const ask = (
    question: string,
    extra: Record<string, unknown> = {},
    datasets = ['World Cup Core'],
  ) => ({ input: { question, datasets, ...extra } });

  /** Every model request `act` made, in order. */
  const recorded = async (act: () => Promise<unknown>) => {
    const from = stub.requests.length;
    await act();
    return stub.requests.slice(from).map(asSent);
  };

  const runStream = async (id: string, body: object) => {
    const res = await fetch(
      `${backend!.url}/workflows/${encodeURIComponent(id)}/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    return { status: res.status, text, frames: framesOf(text) };
  };

  /** Answer a waiting run (138) and read its stream. */
  const resumeStream = async (runId: string, body: object) => {
    const res = await fetch(
      `${backend!.url}/workflow-runs/${encodeURIComponent(runId)}/resume/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      text,
      frames: res.status === 200 ? framesOf(text) : [],
    };
  };

  /** Run the workflow on `question` and read the stream. */
  const answer = (question: string, extra: Record<string, unknown> = {}) =>
    runStream(ASK_WORKFLOW_ID, ask(question, extra));

  const save = async (path: string, body: object) => {
    const saved = (await http().post(path).send(body)).body as {
      ok: boolean;
      message: string;
      datasource?: { id: string };
    };
    expect({ path, ok: saved.ok, message: saved.message }).toMatchObject({
      ok: true,
    });
    return saved;
  };

  beforeAll(async () => {
    stub = await startLlmStub();
    backend = await boot(dataDir);
    const saved = (
      await http().put('/llm/settings').send({
        provider: 'lenai',
        model: 'stub-deployment',
        baseUrl: stub.baseUrl,
        apiKey: 'sk-stub',
      })
    ).body as { ok: boolean };
    expect(saved).toMatchObject({ ok: true });
    const postgres = await save('/datasources', {
      kind: 'postgres',
      name: 'Closed port',
      config: {
        host: '127.0.0.1',
        port: 1,
        database: 'none',
        user: 'none',
        password: 'none',
        ssl: false,
      },
    });
    await save('/datasets', {
      name: 'World Cup Core',
      tables: ['world_cup.world_cup.matches'],
      entities: [
        {
          key: 'world_cup.world_cup.matches',
          columns: [{ name: 'match_number', type: 'integer', nullable: false }],
        },
      ],
      datasourceId: postgres.datasource!.id,
      datasourceKind: 'postgres',
    });
    const rest = await save('/datasources', {
      kind: 'rest',
      name: 'Closed REST API',
      config: {
        baseUrl: 'http://127.0.0.1:1',
        auth: { type: 'none' },
        endpoints: [{ name: 'orders', path: '/v1/orders' }],
      },
    });
    await save('/datasets', {
      name: 'Orders API',
      tables: ['rest.api.orders'],
      entities: [
        {
          key: 'rest.api.orders',
          columns: [{ name: 'id', type: 'text', nullable: false }],
        },
      ],
      datasourceId: rest.datasource!.id,
      datasourceKind: 'rest',
    });
  });

  afterEach(() => {
    stub.reply = () => ({ text: STUB_ANSWER });
    stub.averyReply = averyAuto;
    stub.intercept = undefined;
    stub.hold = undefined;
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
    const file = process.env['WORKFLOW_RUNS_TRANSCRIPT'];
    if (file && transcript.length) writeFileSync(file, transcript.join('\n'));
  });

  it("streams a run: run, Orchestrate's one step running then done, Avery's call of Michael, his answer, then done with the run (agents.md 5.23)", async () => {
    const question = 'How many matches were played?';
    const sent = await recorded(async () => {
      const res = await answer(question);
      expect(res.status).toBe(200);
      const types = res.frames.map((frame) => frame.type);
      expect(types[0]).toBe('run');
      expect(types.at(-1)).toBe('done');
      // Avery briefs Michael through `answer_from_data`; his answer is the
      // text the run streams.
      expect(types).toEqual(
        expect.arrayContaining(['tool', 'tool-result', 'text']),
      );
      expect(res.frames[0]).toMatchObject({ workflowId: ASK_WORKFLOW_ID });
      transcript.push(
        `# POST /workflows/${ASK_WORKFLOW_ID}/runs/stream  {"input":{"question":"${question}","datasets":["World Cup Core"]}}`,
        res.text,
      );
      const steps = res.frames.filter((frame) => frame.type === 'step');
      expect(steps.map(trail)).toEqual(ORCHESTRATE_TRAIL);
      // The step frame carries what the step received.
      expect(steps[0].input).toMatchObject({
        question,
        datasets: ['World Cup Core'],
      });
      for (const step of steps) {
        expect(step.startedAt).toEqual(expect.any(String));
      }
      expect(
        res.frames
          .filter((frame) => frame.type === 'text')
          .map((frame) => frame.content)
          .join(''),
      ).toBe(STUB_ANSWER);
      const run = res.frames.at(-1)!.run!;
      expect(run).toMatchObject({
        id: res.frames[0].runId,
        workflowId: ASK_WORKFLOW_ID,
        status: 'success',
        question,
        datasets: ['World Cup Core'],
        answer: { role: 'assistant', content: STUB_ANSWER },
        output: { answer: STUB_ANSWER },
        // A first message starts a conversation of its own.
        conversationId: run.id,
      });
      expect(run.steps.map(trail)).toEqual(['orchestrate:success']);
      // The step keeps what Avery asked of whom.
      expect((run.steps[0] as { toolCalls?: unknown[] }).toolCalls).toEqual([
        expect.objectContaining({
          tool: 'answer_from_data',
          teammate: 'insights-analyst',
          reply: STUB_ANSWER,
        }) as unknown,
      ]);
      // The run is never listed with the sessions.
      const sessions = (
        (await http().get('/sessions').expect(200)).body as {
          sessions: { id: string }[];
        }
      ).sessions;
      expect(sessions.some((session) => session.id.includes(run.id))).toBe(
        false,
      );
    });
    // Avery's two calls (brief Michael, then close) and Michael's one.
    expect(sent.filter((req) => req.avery)).toHaveLength(2);
    expect(sent.filter((req) => !req.avery)).toHaveLength(1);
  });

  it('archives a conversation with Avery: hidden from the list, listed under ?archived=true, closed to a follow-up, restored by unarchive (api.md 120, 159, 160)', async () => {
    const first = await answer('Archive me');
    const firstRun = first.frames.at(-1)!.run!;
    const follow = await runStream(ASK_WORKFLOW_ID, {
      ...ask('And a follow-up'),
      context: { fromRunId: firstRun.id },
    });
    const followRun = follow.frames.at(-1)!.run!;
    expect(followRun.status).toBe('success');
    const ids = async (query = '') =>
      (
        (await http().get(`/workflow-runs${query}`).expect(200)).body as {
          runs: { id: string; archivedAt?: string }[];
        }
      ).runs.map((run) => run.id);
    expect(await ids()).toEqual(
      expect.arrayContaining([firstRun.id, followRun.id]),
    );

    await http().post('/workflow-runs/nope/archive').expect(404);
    expect(
      (await http().post(`/workflow-runs/${followRun.id}/archive`).expect(200))
        .body,
    ).toEqual({ ok: true, conversationId: firstRun.id, archived: 2 });
    expect(await ids()).not.toContain(firstRun.id);
    expect(await ids()).not.toContain(followRun.id);
    const archived = await ids('?archived=true');
    expect(archived).toEqual(
      expect.arrayContaining([firstRun.id, followRun.id]),
    );
    expect(
      (await http().get(`/workflow-runs/${firstRun.id}`).expect(200)).body,
    ).toMatchObject({ archivedAt: expect.any(String) as string });

    const refused = await runStream(ASK_WORKFLOW_ID, {
      ...ask('Too late'),
      context: { fromRunId: followRun.id },
    });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain('This conversation is archived');

    expect(
      (await http().post(`/workflow-runs/${firstRun.id}/unarchive`).expect(200))
        .body,
    ).toEqual({ ok: true, conversationId: firstRun.id, unarchived: 2 });
    expect(await ids()).toEqual(
      expect.arrayContaining([firstRun.id, followRun.id]),
    );
    expect(await ids('?archived=true')).not.toContain(firstRun.id);
    expect(
      (await http().get(`/workflow-runs/${firstRun.id}`).expect(200)).body,
    ).not.toHaveProperty('archivedAt');
    const again = await runStream(ASK_WORKFLOW_ID, {
      ...ask('Back again'),
      context: { fromRunId: followRun.id },
    });
    expect(again.status).toBe(200);
  });

  it('each step frame and the stored run carry what the step received, its output and its times', async () => {
    const question = 'Who won the 2002 World Cup?';
    const res = await answer(question);
    const steps = res.frames.filter((frame) => frame.type === 'step');
    expect(steps).toHaveLength(2);
    // A running frame carries the input and the start; its ended frame the
    // same input and start, its output and its end.
    const [started, ended] = steps;
    expect(started).toMatchObject({
      id: 'orchestrate',
      status: 'running',
      startedAt: expect.any(String) as string,
      input: { question, datasets: ['World Cup Core'] },
    });
    expect(started).not.toHaveProperty('endedAt');
    expect(ended).toMatchObject({
      id: 'orchestrate',
      status: 'success',
      input: started.input,
      startedAt: started.startedAt,
      endedAt: expect.any(String) as string,
      output: { answer: STUB_ANSWER },
    });
    const done = res.frames.at(-1)!;
    expect(done.type).toBe('done');
    const stored = (
      await http().get(`/workflow-runs/${done.run!.id}`).expect(200)
    ).body as NonNullable<Frame['run']>;
    expect(stored.steps).toEqual(done.run!.steps);
    expect(stored.steps.map(trail)).toEqual(['orchestrate:success']);
    expect(stored.steps[0]).toMatchObject({
      input: started.input,
      startedAt: started.startedAt,
      endedAt: ended.endedAt,
    });
    expect(Date.parse(stored.steps[0].endedAt!)).toBeGreaterThanOrEqual(
      Date.parse(stored.steps[0].startedAt!),
    );
  });

  it(`POST /workflows/${ASK_WORKFLOW_ID}/runs (118) answers the stored run`, async () => {
    const res = await http()
      .post(`/workflows/${ASK_WORKFLOW_ID}/runs`)
      .send(ask('Who won in 1998?'))
      .expect(200);
    const run = res.body as NonNullable<Frame['run']>;
    expect(run).toMatchObject({
      workflowId: ASK_WORKFLOW_ID,
      status: 'success',
      question: 'Who won in 1998?',
      answer: { content: STUB_ANSWER },
    });
    const stored = (await http().get(`/workflow-runs/${run.id}`).expect(200))
      .body as unknown;
    expect(stored).toEqual(run);
  });

  it('GET /workflow-runs/:id/input-image (151) answers 404 for a path the run input does not hold, and for an unknown run', async () => {
    const run = (
      await http()
        .post(`/workflows/${ASK_WORKFLOW_ID}/runs`)
        .send(ask('Who won in 1998?'))
        .expect(200)
    ).body as { id: string };
    const path = 'inputs/images/1.png';
    await http()
      .get(`/workflow-runs/${run.id}/input-image`)
      .query({ path })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          message: `Run "${run.id}" has no image "${path}"`,
        }),
      );
    await http()
      .get('/workflow-runs/gone/input-image')
      .query({ path })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject({ message: 'Run "gone" not found' }),
      );
  });

  it("a run stores the workflow's contractHash (117), and its step's output keeps its declared contract", async () => {
    const detail = (
      await http().get(`/workflows/${ASK_WORKFLOW_ID}`).expect(200)
    ).body as {
      contractHash: string;
      steps: {
        id: string;
        outputSchema: { properties: object; required: string[] };
      }[];
    };
    const run = (
      await http()
        .post(`/workflows/${ASK_WORKFLOW_ID}/runs`)
        .send(ask('Who won in 2002?'))
        .expect(200)
    ).body as {
      id: string;
      contractHash?: string;
      steps: { id: string; status: string; output?: Record<string, unknown> }[];
    };
    expect(run.contractHash).toBe(detail.contractHash);
    const stored = (await http().get(`/workflow-runs/${run.id}`).expect(200))
      .body as { contractHash?: string };
    expect(stored.contractHash).toBe(detail.contractHash);
    // The one step passed on exactly the fields its schema requires.
    expect(run.steps.map((step) => step.id)).toEqual(['orchestrate']);
    for (const step of run.steps) {
      const declared = detail.steps.find((entry) => entry.id === step.id)!;
      expect(step.status).toBe('success');
      expect(Object.keys(step.output ?? {})).toEqual(
        expect.arrayContaining(declared.outputSchema.required),
      );
    }
  });

  it("asks Avery with the user's words and her tools, and Michael with her brief and his tools, the same each time", async () => {
    /** The last user message of a request, as the provider read it. */
    const lastUser = (req: ReturnType<typeof asSent>) =>
      messageText([...req.messages].reverse().find((m) => m.role === 'user')!);
    const question = 'Which stadium hosted the final?';
    const run = await recorded(() => answer(question));
    const avery = run.filter((req) => req.avery);
    const michael = run.filter((req) => !req.avery);
    expect(avery).toHaveLength(2);
    expect(michael).toHaveLength(1);
    expect(avery[0].tools).toEqual(
      expect.arrayContaining(['answer_from_data', 'ask_clarification']),
    );
    expect(lastUser(avery[0])).toBe(question);
    expect(isMichaelRequest(michael[0])).toBe(true);
    expect(michael[0].tools).toEqual(
      expect.arrayContaining([
        'list_entities',
        'describe_entity',
        'sample_rows',
        'run_readonly_sql',
        'ask_clarification',
      ]),
    );
    // Avery's brief is the question here, and it is the last thing he reads.
    expect(lastUser(michael[0])).toBe(question);
    // Two runs of the same input send Michael the same request.
    const again = await recorded(() => answer(question));
    expect(again.filter((req) => !req.avery)).toEqual(michael);
  });

  it("a follow-up run goes on from a copy of the earlier run's thread: Avery and Michael read the earlier exchange, then this question", async () => {
    const first = await answer('Who hosted in 2002?');
    const runId = first.frames[0].runId!;
    const sent = await recorded(() =>
      runStream(ASK_WORKFLOW_ID, {
        ...ask('And in 2006?'),
        context: { fromRunId: runId },
      }),
    );
    const dialogue = (req: StubRequest | ReturnType<typeof asSent>) =>
      req.messages
        .filter((message) => message.role !== 'system')
        .map((message) => [message.role, messageText(message)])
        .filter(([, text]) => text);
    const earlier = [
      // From the copied thread: the earlier question and its answer, then
      // this question.
      ['user', 'Who hosted in 2002?'],
      ['assistant', STUB_ANSWER],
      ['user', 'And in 2006?'],
    ];
    const michael = sent.find((req) => !req.avery)!;
    expect(dialogue(michael)).toEqual(earlier);
    const avery = sent.find((req) => req.avery)!;
    expect(dialogue(avery)).toEqual(earlier);
  });

  describe("a run's memory threads (agents.md 5.14; data-model 5)", () => {
    /** Rows of one table of the app's Mastra store, read while it runs. */
    const rowsOf = (table: string): Record<string, unknown>[] => {
      const db = new BetterSqlite3(join(dataDir, 'mastra.sqlite'), {
        readonly: true,
        fileMustExist: true,
      });
      try {
        return db.prepare(`SELECT * FROM "${table}"`).all() as Record<
          string,
          unknown
        >[];
      } finally {
        db.close();
      }
    };
    const threadsOf = (resource: string) =>
      rowsOf('mastra_threads')
        .filter((row) => (row['resourceId'] ?? row['resource_id']) === resource)
        .map((row) => String(row['id']))
        .sort();
    const rolesIn = (threadId: string) =>
      rowsOf('mastra_messages')
        .filter((row) => (row['thread_id'] ?? row['threadId']) === threadId)
        .sort((a, b) =>
          String(a['createdAt']).localeCompare(String(b['createdAt'])),
        )
        .map((row) => String(row['role']));

    it("keeps the run's one thread after it, the exchange recorded; a follow-up starts from a copy; deleting a run deletes its own", async () => {
      const first = await answer('Who hosted in 2010?');
      const firstId = first.frames[0].runId!;
      const host = `run-${firstId}`;
      // Michael's thread is the run's: no Plan and Write answer threads.
      expect(threadsOf(host)).toEqual([host]);
      expect(rolesIn(host)).toEqual(['user', 'assistant']);

      const second = await runStream(ASK_WORKFLOW_ID, {
        ...ask('And in 2014?'),
        context: { fromRunId: firstId },
      });
      const next = `run-${second.frames[0].runId!}`;
      expect(threadsOf(next)).toEqual([next]);
      // The copy goes on: the earlier exchange, then this run's.
      expect(rolesIn(next)).toEqual(['user', 'assistant', 'user', 'assistant']);

      await http().delete(`/workflow-runs/${firstId}`).expect(200);
      expect(threadsOf(host)).toEqual([]);
      // The follow-up's copy is its own.
      expect(threadsOf(next)).toEqual([next]);
    });
  });

  it("a run sends Michael his tools, his skills and the orientation, metrics, knowledge and catalog blocks, then Avery's brief, in order", async () => {
    // A dataset of its own, so no other test's requests change.
    const datasourceId = (
      (await http().get('/datasets').expect(200)).body as {
        datasets: { name: string; datasourceId?: string }[];
      }
    ).datasets.find((d) => d.name === 'World Cup Core')!.datasourceId!;
    await save('/datasets', {
      name: 'Analyst Goals',
      tables: ['world_cup.world_cup.goals'],
      entities: [
        {
          key: 'world_cup.world_cup.goals',
          columns: [{ name: 'goal_id', type: 'integer', nullable: false }],
        },
      ],
      datasourceId,
      datasourceKind: 'postgres',
    });
    await save('/metrics', {
      name: 'goals_total',
      label: 'Total goals',
      entity: 'world_cup.world_cup.goals',
      expression: 'COUNT(goal_id)',
      datasourceId,
    });
    await http()
      .post('/datasets/Analyst%20Goals/ontology')
      .send({
        kind: 'instruction',
        name: 'Own goals',
        description: 'Own goals count for the team that benefited.',
      })
      .expect(201);
    const question = 'How many goals were scored in total?';
    const sent = await recorded(() =>
      runStream(ASK_WORKFLOW_ID, ask(question, {}, ['Analyst Goals'])),
    );
    const turn = sent.find((req) => !req.avery && isMichaelRequest(req))!;
    const dump = process.env['V2_REQUEST_DUMP'];
    if (dump) writeFileSync(dump, JSON.stringify(turn, null, 2));
    expect(turn.tools).toEqual(
      expect.arrayContaining([
        'list_entities',
        'describe_entity',
        'sample_rows',
        'run_readonly_sql',
        'ask_clarification',
      ]),
    );
    for (const absent of [
      'create_visual',
      'show_in_panel',
      'update_workflow',
      'answer_from_data',
    ]) {
      expect(turn.tools).not.toContain(absent);
    }
    const system = turn.messages
      .filter((message) => message.role === 'system')
      .map((message) => messageText(message));
    const at = (start: string) =>
      system.findIndex((text) => text.startsWith(start));
    expect(at('You are Questions to Insights')).toBe(0);
    const orientation = at('Datasets for this session: Analyst Goals.');
    const metrics = at('Governed metric definitions');
    const knowledge = at('Curated dataset knowledge');
    const catalog = at('Catalog loaded for this turn: 1 entity.');
    const brief = at('Brief from Avery, the Chief of Staff: ');
    expect(orientation).toBeGreaterThan(0);
    expect(system[orientation]).toContain(
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    );
    expect(system[metrics]).toContain(
      'Total goals (goals_total) on world_cup.world_cup.goals: COUNT(goal_id)',
    );
    expect(system[knowledge]).toContain('[instruction] Own goals:');
    // The per-turn blocks keep the assistant's order, the catalog last, then
    // Avery's brief.
    expect(orientation).toBeLessThan(metrics);
    expect(metrics).toBeLessThan(knowledge);
    expect(knowledge).toBeLessThan(catalog);
    expect(catalog).toBeLessThan(brief);
    // The catalog lists the columns Load catalog loaded.
    expect(system[catalog]).toContain(
      'Columns of each entity (name type):\n- world_cup.world_cup.goals: goal_id integer',
    );
    expect(system[brief]).toContain(
      `Brief from Avery, the Chief of Staff: ${question}`,
    );
    expect(
      system.some((text) => text.startsWith('Queries an earlier attempt')),
    ).toBe(false);
    // His on-demand skills reach the model through the framework's catalog.
    const all = system.join('\n');
    for (const skill of [
      'curated-knowledge',
      'sql-analysis',
      'result-validation',
    ]) {
      expect(all).toContain(skill);
    }
  });

  describe('a clarifying question waits for the answer, and the same run goes on (agents.md 5.23; api.md 119, 138; ADR-0043)', () => {
    const ASKED = 'Which team performed best?';
    const CLARIFY = 'Which measure should decide the best team?';
    const OPTIONS = ['Most wins', 'Most goals — scored over all matches'];

    /** Michael asks `CLARIFY` for `ASKED` until he is answered. */
    const michaelAsks = (req: StubRequest) =>
      req.stream && lastUser(req) === ASKED
        ? {
            toolCall: {
              name: 'ask_clarification',
              arguments: { question: CLARIFY, options: OPTIONS.join('\n') },
            },
          }
        : { text: STUB_ANSWER };

    const lastUser = (req: StubRequest) =>
      messageText([...req.messages].reverse().find((m) => m.role === 'user')!);

    it('Michael asks mid-analysis: Avery relays it and the run suspends at Orchestrate; 138 runs them again with the question and the answer, to success', async () => {
      stub.reply = michaelAsks;
      const first = await answer(ASKED);
      expect(first.status).toBe(200);
      const runId = first.frames[0].runId!;
      // The waiting step, what it waits for, then done: the stream ends.
      const [step, required, done] = first.frames.slice(-3);
      expect(step).toMatchObject({
        type: 'step',
        id: 'orchestrate',
        status: 'suspended',
      });
      expect(required).toEqual({
        // Every frame carries its number in the run's log (ADR-0048).
        seq: expect.any(Number) as unknown,
        type: 'input-required',
        runId,
        stepId: 'orchestrate',
        title: 'Orchestrate',
        question: CLARIFY,
        options: OPTIONS,
        expiresAt: expect.any(String) as unknown,
      });
      expect(done.type).toBe('done');
      const waiting = done.run! as NonNullable<Frame['run']> & {
        waitingFor?: Record<string, unknown>;
        finishedAt?: string;
      };
      expect(waiting).toMatchObject({ id: runId, status: 'suspended' });
      expect(waiting.waitingFor).toEqual({
        stepId: 'orchestrate',
        title: 'Orchestrate',
        question: CLARIFY,
        options: OPTIONS,
        since: expect.any(String) as unknown,
        expiresAt: required.expiresAt,
      });
      expect(waiting.answer).toBeUndefined();
      expect(waiting.finishedAt).toBeUndefined();
      expect(waiting.steps.map(trail)).toEqual(['orchestrate:suspended']);
      // Stored and listed as waiting.
      expect(
        (
          (await http().get(`/workflow-runs/${runId}`)).body as {
            status: string;
          }
        ).status,
      ).toBe('suspended');
      const listed = (await http().get('/workflow-runs')).body as {
        runs: { id: string; status: string }[];
      };
      expect(listed.runs.find((run) => run.id === runId)?.status).toBe(
        'suspended',
      );

      const sent = await recorded(async () => {
        const second = await resumeStream(runId, {
          stepId: 'orchestrate',
          answer: 'Most wins',
        });
        expect(second.status).toBe(200);
        expect(second.frames[0]).toEqual({
          // The resume's fresh log goes on numbering (ADR-0048).
          seq: expect.any(Number) as unknown,
          type: 'run',
          runId,
          workflowId: ASK_WORKFLOW_ID,
        });
        expect(second.frames.some((f) => f.type === 'input-required')).toBe(
          false,
        );
        const end = second.frames.at(-1)!;
        expect(end.type).toBe('done');
        expect(end.run).toMatchObject({
          id: runId,
          status: 'success',
          answer: { role: 'assistant', content: STUB_ANSWER },
        });
        expect(end.run).not.toHaveProperty('waitingFor');
        expect(end.run!.steps.map(trail)).toEqual(['orchestrate:success']);
      });
      // Michael ran again with his question and the answer to it.
      const turns = sent.filter((req) => !req.avery);
      expect(turns).toHaveLength(1);
      expect(
        turns[0].messages
          .filter((message) => message.role !== 'system')
          .map((message) => [message.role, messageText(message)]),
      ).toEqual([
        ['user', ASKED],
        ['assistant', `${CLARIFY}\n- ${OPTIONS.join('\n- ')}`],
        ['user', 'Most wins'],
      ]);
      // Resumed once: it no longer waits.
      const again = await resumeStream(runId, {
        stepId: 'orchestrate',
        answer: 'Most goals',
      });
      expect(again.status).toBe(409);
      expect(JSON.parse(again.text)).toMatchObject({
        message: `Run "${runId}" is not waiting for an answer`,
      });
    });

    it('138 refuses before any stream (Style B): 404, 409, 400 answer, 400 step', async () => {
      const missing = await resumeStream('no-such-run', {
        stepId: 'orchestrate',
        answer: 'a',
      });
      expect(missing.status).toBe(404);
      expect(missing.contentType).toContain('application/json');
      expect(JSON.parse(missing.text)).toMatchObject({
        message: 'Run "no-such-run" not found',
      });

      const finished = await answer('How many matches?');
      const finishedId = finished.frames[0].runId!;
      const notWaiting = await resumeStream(finishedId, {
        stepId: 'orchestrate',
        answer: 'a',
      });
      expect(notWaiting.status).toBe(409);
      expect(JSON.parse(notWaiting.text)).toMatchObject({
        message: `Run "${finishedId}" is not waiting for an answer`,
      });

      stub.reply = michaelAsks;
      const waiting = await answer(ASKED);
      const waitingId = waiting.frames[0].runId!;
      const blank = await resumeStream(waitingId, {
        stepId: 'orchestrate',
        answer: '   ',
      });
      expect(blank.status).toBe(400);
      expect(blank.contentType).toContain('application/json');
      expect(JSON.parse(blank.text)).toMatchObject({
        message: 'Answer is required',
      });
      const wrongStep = await resumeStream(waitingId, {
        stepId: 'analyse',
        answer: 'A',
      });
      expect(wrongStep.status).toBe(400);
      expect(JSON.parse(wrongStep.text)).toMatchObject({
        message: 'Step "analyse" is not waiting for an answer',
      });
      // The refusals left it waiting.
      const stored = (await http().get(`/workflow-runs/${waitingId}`)).body as {
        status: string;
      };
      expect(stored.status).toBe('suspended');
    });
  });

  it("the run's answer is Michael's written answer whole, with Avery's closing words only after it", async () => {
    const written = 'Written: 64 matches.\n\nHow I got this: one count.';
    stub.reply = () => ({ text: written });
    stub.averyReply = (req) =>
      averyToolResult(req) === undefined
        ? averyAuto(req)
        : { text: 'Avery adds a closing note.' };
    const res = await answer('How many matches in all?');
    const run = res.frames.at(-1)!.run!;
    const full = `${written}\n\nAvery adds a closing note.`;
    expect(run.answer?.content).toBe(full);
    expect(run.output).toEqual({ answer: full });
    expect(
      res.frames
        .filter((frame) => frame.type === 'text')
        .map((frame) => frame.content)
        .join(''),
    ).toBe(full);
  });

  it('a model failure fails Orchestrate: the run is failed with no answer, and the stored run reads the same', async () => {
    stub.intercept = (req) =>
      req.avery
        ? { status: 400, message: 'The model refused the orchestrate call.' }
        : undefined;
    const res = await answer('Fail at orchestrate: how many matches?');
    expect(res.status).toBe(200);
    expect(res.frames.at(-1)).toMatchObject({
      type: 'error',
      content: 'The model refused the orchestrate call.',
    });
    const run = await http()
      .get(`/workflow-runs/${res.frames[0].runId}`)
      .expect(200)
      .then(
        ({ body }) =>
          body as {
            status: string;
            error?: string;
            answer?: unknown;
            steps: { id: string; status: string }[];
          },
      );
    expect(run.status).toBe('failed');
    expect(run.answer).toBeUndefined();
    expect(run.steps.map(trail)).toEqual(['orchestrate:failed']);
    expect(run.error).toContain('The model refused the orchestrate call.');
  });

  it("Michael's model failure fails Orchestrate too, naming him: the run is failed with no answer, not a success with an empty one", async () => {
    // Avery briefs Michael as usual (averyAuto); his own model call fails.
    stub.intercept = (req) =>
      req.stream && !req.avery && req.step === undefined
        ? { status: 400, message: 'The model refused the analysis call.' }
        : undefined;
    const res = await answer('Fail at Michael: how many matches?');
    expect(res.status).toBe(200);
    expect(stub.requests.some((req) => req.avery)).toBe(true);
    const message =
      'Michael (Insights Analyst) could not answer: The model refused the analysis call.';
    expect(res.frames.at(-1)).toMatchObject({
      type: 'error',
      content: message,
    });
    const run = await http()
      .get(`/workflow-runs/${res.frames[0].runId}`)
      .expect(200)
      .then(
        ({ body }) =>
          body as {
            status: string;
            error?: string;
            answer?: unknown;
            steps: { id: string; status: string; error?: string }[];
          },
      );
    expect(run.status).toBe('failed');
    expect(run.answer).toBeUndefined();
    expect(run.steps.map(trail)).toEqual(['orchestrate:failed']);
    expect(run.steps[0].error).toContain(message);
    expect(run.error).toContain(message);
  });

  it('closing the connection leaves the run running (ADR-0048); Stop (150) stops it with no answer to continue from', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.messages.some((m) => messageText(m).includes('Hold this one'))
        ? held
        : undefined;
    const controller = new AbortController();
    const res = await fetch(
      `${backend!.url}/workflows/${ASK_WORKFLOW_ID}/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ask('Hold this one')),
        signal: controller.signal,
      },
    );
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('"type":"run"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    const runId = framesOf(text)[0].runId!;
    // Wait until the model call is open, then stop.
    const deadline = Date.now() + 10_000;
    while (
      !stub.requests.some((r) =>
        r.messages.some((m) => messageText(m).includes('Hold this one')),
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    controller.abort();
    // Leaving is not stopping: the run still runs, and can be followed again.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      (
        (await http().get(`/workflow-runs/${runId}`).expect(200)).body as {
          status?: string;
        }
      ).status,
    ).toBe('running');
    // Stop answers once the run is stored stopped (sent now, read below).
    const stopping = http()
      .post(`/workflow-runs/${runId}/stop`)
      .then((answered) => answered);
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    stub.hold = undefined;
    const stopped = await stopping;
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({
      ok: true,
      message: 'Run stopped',
      run: { id: runId, status: 'stopped' },
    });
    // The stopped run is stored without an answer.
    let refusal: { status: number; message?: string } = { status: 0 };
    for (let i = 0; i < 40; i++) {
      const next = await http()
        .post(`/workflows/${ASK_WORKFLOW_ID}/runs/stream`)
        .send({ ...ask('Next'), context: { fromRunId: runId } });
      refusal = {
        status: next.status,
        message: (next.body as { message?: string }).message,
      };
      if (refusal.message !== `Run "${runId}" not found`) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(refusal).toEqual({
      status: 400,
      message: `Run "${runId}" has no answer to continue from`,
    });
  });

  describe('a conversation with Elena, outside any workflow (plan Elena 1.1, 1.3; api.md 117-119, 138, 159)', () => {
    const ELENA = 'agent:insights-lead';
    const ASKED = 'Which squad was the strongest?';
    const CLARIFY = 'Strongest by which measure?';
    const OPTIONS = ['Most wins', 'Most goals'];

    /** Whether a request is Elena's: her prompt opens its system messages. */
    const isElena = (req: StubRequest) =>
      req.messages.some(
        (message) =>
          message.role === 'system' &&
          messageText(message).startsWith('You are Elena'),
      );
    const lastUser = (req: StubRequest) =>
      messageText([...req.messages].reverse().find((m) => m.role === 'user')!);

    it('GET /workflows/agent:insights-lead (117) details her one Answer step, never listed by 116', async () => {
      const detail = (
        await http()
          .get(`/workflows/${encodeURIComponent(ELENA)}`)
          .expect(200)
      ).body as {
        id: string;
        conversational?: boolean;
        agents: { key: string; name: string; role: string }[];
        steps: { id: string }[];
      };
      expect(detail).toMatchObject({ id: ELENA, conversational: true });
      expect(detail.agents[0]).toMatchObject({
        key: 'insights-lead',
        name: 'Elena',
        role: 'Insights Lead',
      });
      expect(detail.steps.map((step) => step.id)).toEqual(['answer']);
      const listed = (await http().get('/workflows').expect(200)).body as {
        workflows: { id: string; conversational?: boolean }[];
      };
      expect(listed.workflows.map((workflow) => workflow.id)).not.toContain(
        ELENA,
      );
      // Avery's workflow is a conversation too (plan Elena 1.2).
      expect(
        listed.workflows.find((workflow) => workflow.id === ASK_WORKFLOW_ID),
      ).toMatchObject({ conversational: true });
    });

    it('streams a run of hers: the Answer step, her own model calls (no Avery), the answer, and GET /workflow-runs/:id shows step answer with its checks', async () => {
      const sent = await recorded(async () => {
        const res = await runStream(ELENA, ask('How many matches were there?'));
        expect(res.status).toBe(200);
        expect(res.frames[0]).toMatchObject({ type: 'run', workflowId: ELENA });
        const steps = res.frames.filter((f) => f.type === 'step').map(trail);
        expect(steps).toEqual(['answer:running', 'answer:success']);
        const run = res.frames.at(-1)!.run!;
        expect(run).toMatchObject({
          workflowId: ELENA,
          status: 'success',
          answer: { role: 'assistant', content: STUB_ANSWER },
        });
        const stored = (
          await http().get(`/workflow-runs/${run.id}`).expect(200)
        ).body as {
          conversationId?: string;
          steps: {
            id: string;
            status: string;
            output?: { attempts?: number };
          }[];
          answer?: { checks?: { check: string; passed: boolean }[] };
        };
        expect(stored.conversationId).toBe(run.id);
        expect(stored.steps.map(trail)).toEqual(['answer:success']);
        // The stub runs no query: one repair round, then the last checks.
        expect(stored.steps[0].output?.attempts).toBe(2);
        expect(
          stored.answer?.checks?.find((c) => c.check === 'Ran a query'),
        ).toMatchObject({ passed: false });
      });
      expect(sent.some((req) => req.avery)).toBe(false);
      expect(sent.length).toBeGreaterThanOrEqual(2);
    });

    it('joins a follow-up to the conversation: same conversationId, the earlier turn in her messages', async () => {
      const first = (
        await runStream(ELENA, ask('First question to Elena'))
      ).frames.at(-1)!.run!;
      const sent = await recorded(async () => {
        const follow = await runStream(ELENA, {
          ...ask('And the follow-up?'),
          context: { fromRunId: first.id },
        });
        expect(follow.status).toBe(200);
        const run = follow.frames.at(-1)!.run! as NonNullable<Frame['run']> & {
          conversationId?: string;
        };
        expect(run.status).toBe('success');
        const stored = (
          await http().get(`/workflow-runs/${run.id}`).expect(200)
        ).body as { conversationId?: string };
        expect(stored.conversationId).toBe(first.id);
      });
      const firstCall = sent.find((req) => !req.avery)!;
      expect(
        firstCall.messages
          .filter((message) => message.role !== 'system')
          .map((message) => [message.role, messageText(message)]),
      ).toEqual([
        ['user', 'First question to Elena'],
        ['assistant', STUB_ANSWER],
        ['user', 'And the follow-up?'],
      ]);
    });

    it('her clarifying question suspends the run at Answer; 138 runs her again with the answer, to success', async () => {
      stub.reply = (req) =>
        isElena(req) && req.stream && lastUser(req) === ASKED
          ? {
              toolCall: {
                name: 'ask_clarification',
                arguments: { question: CLARIFY, options: OPTIONS.join('\n') },
              },
            }
          : { text: STUB_ANSWER };
      const first = await runStream(ELENA, ask(ASKED));
      expect(first.status).toBe(200);
      const runId = first.frames[0].runId!;
      const [step, required, done] = first.frames.slice(-3);
      expect(step).toMatchObject({
        type: 'step',
        id: 'answer',
        status: 'suspended',
      });
      expect(required).toMatchObject({
        type: 'input-required',
        runId,
        stepId: 'answer',
        title: 'Answer',
        question: CLARIFY,
        options: OPTIONS,
      });
      expect(done.run).toMatchObject({ id: runId, status: 'suspended' });
      const resumed = await resumeStream(runId, {
        stepId: 'answer',
        answer: 'Most wins',
      });
      expect(resumed.status).toBe(200);
      const end = resumed.frames.at(-1)!;
      expect(end.run).toMatchObject({
        id: runId,
        status: 'success',
        answer: { role: 'assistant', content: STUB_ANSWER },
      });
      expect(end.run!.steps.map(trail)).toEqual(['answer:success']);
    });

    it('a message to an archived conversation with her answers 409; unarchived, it runs again', async () => {
      const first = (await runStream(ELENA, ask('Archive Elena'))).frames.at(
        -1,
      )!.run!;
      expect(
        (await http().post(`/workflow-runs/${first.id}/archive`).expect(200))
          .body,
      ).toEqual({ ok: true, conversationId: first.id, archived: 1 });
      const refused = await runStream(ELENA, {
        ...ask('Too late'),
        context: { fromRunId: first.id },
      });
      expect(refused.status).toBe(409);
      expect(refused.text).toContain('This conversation is archived');
      await http().post(`/workflow-runs/${first.id}/unarchive`).expect(200);
      const again = await runStream(ELENA, {
        ...ask('Back again'),
        context: { fromRunId: first.id },
      });
      expect(again.status).toBe(200);
    });
  });

  describe('refusals before any stream (Style B)', () => {
    const ASK = {
      question: 'Hi',
      datasets: ['World Cup Core'],
    };
    it.each([
      [
        ASK_WORKFLOW_ID,
        { input: { datasets: ['World Cup Core'] } },
        400,
        'Question is required',
      ],
      [
        ASK_WORKFLOW_ID,
        { input: { question: 'Hi' } },
        400,
        'Select at least one dataset',
      ],
      [
        ASK_WORKFLOW_ID,
        { input: { question: 'Hi', datasets: ['Nope'] } },
        400,
        'Dataset "Nope" not found',
      ],
      [
        ASK_WORKFLOW_ID,
        { input: ASK, context: { fromRunId: 'nope' } },
        400,
        'Run "nope" not found',
      ],
      // Asking one agent alone went with the removed workflow.
      [
        ASK_WORKFLOW_ID,
        { input: ASK, context: { askStep: 'plan' } },
        400,
        `Workflow "${ASK_WORKFLOW_ID}" can't ask one agent`,
      ],
      ['nope', { input: {} }, 404, 'Workflow "nope" not found'],
      // The two removed question-answering workflows are unknown.
      [
        'answer-business-question',
        { input: ASK },
        404,
        'Workflow "answer-business-question" not found',
      ],
      [
        'orchestrated-answer',
        { input: ASK },
        404,
        'Workflow "orchestrated-answer" not found',
      ],
      // The workflows removed in 1.23.35 are unknown.
      [
        'agent:assistant',
        { input: ASK },
        404,
        'Workflow "agent:assistant" not found',
      ],
      [
        'agent:data-readiness',
        { input: { dataset: 'World Cup Core' } },
        404,
        'Workflow "agent:data-readiness" not found',
      ],
      [
        'seq-text-demo',
        { input: { text: 'Hello' } },
        404,
        'Workflow "seq-text-demo" not found',
      ],
      [
        'deep-analysis',
        { input: ASK },
        404,
        'Workflow "deep-analysis" not found',
      ],
      // The RFP Builder was removed: its workflow is unknown.
      [
        'agent:rfp',
        { input: { message: 'Start', rfpId: 'rfp-1' } },
        404,
        'Workflow "agent:rfp" not found',
      ],
    ])('%s %p answers %d %p', async (id, body, status, message) => {
      const before = stub.requests.length;
      const res = await runStream(id, body);
      expect(res.status).toBe(status);
      expect((JSON.parse(res.text) as { message: string }).message).toBe(
        message,
      );
      expect(stub.requests.length).toBe(before);
    });

    it('a blank question and no datasets answer one JSON 400 with both errors, before any SSE frame; nothing is stored', async () => {
      const history = async () =>
        (
          (await http().get('/workflow-runs').expect(200)).body as {
            runs: { id: string }[];
          }
        ).runs.map((run) => run.id);
      const stored = await history();
      const before = stub.requests.length;
      const res = await fetch(
        `${backend!.url}/workflows/${ASK_WORKFLOW_ID}/runs/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { question: '   ', datasets: [] } }),
        },
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      const text = await res.text();
      expect(text).not.toContain('data:');
      expect(JSON.parse(text)).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Question is required',
        errors: [
          { field: 'question', message: 'Question is required' },
          { field: 'datasets', message: 'Select at least one dataset' },
        ],
      });
      expect(stub.requests.length).toBe(before);
      expect(await history()).toEqual(stored);
    });
  });
});

/**
 * An Avery + Michael answer on real rows (agents.md 5.23; api.md 121): the
 * queries Michael runs come back with the answer as `data` records, rows
 * and all. Runs on the World Cup Postgres on 55432 and skips, visibly,
 * when it is down (`docker compose up -d postgres`).
 */
const describeLive = worldCupIsUp() ? describe : describe.skip;

describeLive('An answer from real rows carries its data records (API)', () => {
  const liveDir = mkdtempSync(join(tmpdir(), 'qti-workflow-runs-live-'));
  const MATCHES = 'world_cup.world_cup.matches';
  const COUNT_SQL = `SELECT COUNT(*) AS matches FROM ${MATCHES}`;
  let backend: Backend | undefined;
  let stub: LlmStub;
  let totalMatches = 0;
  const http = () => request.agent(backend!.url);

  beforeAll(async () => {
    const pool = worldCupPool();
    try {
      const [row] = await runSql(pool, COUNT_SQL);
      totalMatches = Number(row['matches']);
    } finally {
      await pool.end();
    }
    expect(totalMatches).toBeGreaterThan(10);
    stub = await startLlmStub();
    backend = await boot(liveDir);
    expect(
      (
        await http().put('/llm/settings').send({
          provider: 'lenai',
          model: 'stub-deployment',
          baseUrl: stub.baseUrl,
          apiKey: 'sk-stub',
        })
      ).body,
    ).toMatchObject({ ok: true });
    const source = (
      await http()
        .post('/datasources')
        .send({
          kind: 'postgres',
          name: 'World Cup',
          config: { ...WORLD_CUP_CONNECTION, ssl: false },
        })
    ).body as { ok: boolean; datasource: { id: string } };
    expect(source.ok).toBe(true);
    expect(
      (
        await http()
          .post('/datasets')
          .send({
            name: 'World Cup Live',
            tables: [MATCHES],
            entities: [
              {
                key: MATCHES,
                columns: [
                  { name: 'match_number', type: 'integer', nullable: false },
                ],
              },
            ],
            datasourceId: source.datasource.id,
            datasourceKind: 'postgres',
          })
      ).body,
    ).toMatchObject({ ok: true });
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(liveDir, { recursive: true, force: true });
  });

  it("Michael's real query comes back with the answer as a data record, with its rows", async () => {
    // Michael runs the count once, then answers; Avery is the stub's.
    stub.reply = (req) =>
      req.messages.at(-1)?.role === 'tool'
        ? { text: STUB_ANSWER }
        : {
            toolCall: {
              name: 'run_readonly_sql',
              arguments: { sql: COUNT_SQL, rationale: 'Count the matches.' },
            },
          };
    const res = await fetch(
      `${backend!.url}/workflows/${ASK_WORKFLOW_ID}/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            question: 'How many matches were played?',
            datasets: ['World Cup Live'],
          },
        }),
      },
    );
    const run = framesOf(await res.text()).at(-1)!.run as unknown as {
      id: string;
      status: string;
      answer: {
        content: string;
        data?: {
          tool: string;
          input?: string;
          columns?: string[];
          rows?: Record<string, unknown>[];
          rowCount?: number;
        }[];
      };
    };
    expect(run.status).toBe('success');
    expect(run.answer.content).toBe(STUB_ANSWER);
    expect(run.answer.data).toEqual([
      expect.objectContaining({
        tool: 'run_readonly_sql',
        input: COUNT_SQL,
        columns: ['matches'],
        rowCount: 1,
      }) as unknown,
    ]);
    expect(Number(run.answer.data![0].rows![0]['matches'])).toBe(totalMatches);
    // The stored run keeps them.
    const stored = (await http().get(`/workflow-runs/${run.id}`).expect(200))
      .body as typeof run;
    expect(stored.answer.data).toEqual(run.answer.data);
  });
});
