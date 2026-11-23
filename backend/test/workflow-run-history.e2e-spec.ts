/**
 * API-level proof of stored runs (ADR-0041; api.md 118-127; data-model
 * 3.16; workflows R18-R20): an Answer a Business Question (Avery + Michael)
 * run with the recording stub model is stored, listed, fetched and deleted with its
 * workspace; runs an earlier version stored of the workflows removed in
 * 1.23.35 (`seq-text-demo`, `deep-analysis`, `agent:assistant`) and
 * sessions bound to them still list and read as plain runs and sessions,
 * their files served from their workspace, and cannot run again; after the
 * backend restarts, a run it was killed in is queued again and starts from
 * scratch (its second attempt) until it succeeds, an orphan run workspace
 * is gone, and a stored run is still the context of a follow-up run; the
 * stored runs of the two removed question-answering workflows (and their
 * node chats, memory threads and workspaces) are deleted at every start
 * (data-model 6, M18).
 *
 * Needs no Postgres: the dataset points at a closed port, and the stub model
 * calls no tool. Set `WORKFLOW_RUN_HISTORY_TRANSCRIPT=<file>` to write the
 * HTTP transcript of the history routes there.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import {
  messageText,
  startLlmStub,
  STUB_ANSWER,
  type LlmStub,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import {
  ASK_WORKFLOW_ID,
  ASK_WORKFLOW_NAME,
} from '../../frontend/e2e/helpers/runs-api';
import { type Backend, boot, stop } from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-workflow-run-history-'));

jest.setTimeout(180_000);

interface Frame {
  type: string;
  runId?: string;
  run?: WireRun;
}

interface WireRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  attempts?: number;
  queuedAt?: string;
  question?: string;
  error?: string;
  answer?: { role: string; content: string };
  panelItems?: { id: string; kind: string; title: string; path?: string }[];
  steps: { id: string; status: string }[];
  output?: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
}

const REPORT_MD = '# Scoring\n\nDefences got better.';
const HOLD_QUESTION = 'Hold the first model call';

/** The frames of an SSE body (api.md 3.1 framing). */
function framesOf(text: string): Frame[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as Frame);
}

/** The latest user message's text. */
function lastQuestion(req: StubRequest): string {
  const user = [...req.messages].reverse().find((m) => m.role === 'user');
  return user ? messageText(user) : '';
}

/** A workspace of the backend's data dir (data-model 4.1). */
const workspace = (hostId: string) =>
  join(dataDir, 'workspaces', `session-${hostId}`);

/** Runs and sessions an earlier version stored, of workflows removed in 1.23.35. */
const OLD_RUNS = [
  {
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
        startedAt: '2026-11-01T09:00:00.000Z',
        endedAt: '2026-11-01T09:00:00.100Z',
      },
    ],
    output: { summary: '2 words, 11 characters: "Hello world"' },
    datasets: [],
    startedAt: '2026-11-01T09:00:00.000Z',
    finishedAt: '2026-11-01T09:00:01.000Z',
  },
  {
    id: 'old-deep',
    workflowId: 'deep-analysis',
    workflowName: 'Deep analysis',
    input: { question: 'Why did scoring fall?', datasets: ['World Cup Core'] },
    status: 'success',
    steps: [{ id: 'plan', title: 'Plan', status: 'success' }],
    question: 'Why did scoring fall?',
    answer: {
      role: 'assistant',
      content: 'Defences got better.',
      at: '2026-11-01T10:04:00.000Z',
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
        id: 'report',
        kind: 'file',
        title: 'Scoring',
        path: 'reports/old-deep.md',
        bytes: REPORT_MD.length,
        shownAt: '2026-11-01T10:04:00.000Z',
      },
    ],
    visualizations: [],
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:04:00.000Z',
  },
  {
    id: 'old-assistant',
    workflowId: 'agent:assistant',
    workflowName: 'Assistant',
    input: { question: 'Who hosted in 2002?', datasets: ['World Cup Core'] },
    status: 'success',
    steps: [{ id: 'answer', title: 'Answer', status: 'success' }],
    question: 'Who hosted in 2002?',
    answer: {
      role: 'assistant',
      content: 'Korea and Japan.',
      at: '2026-11-01T11:00:05.000Z',
    },
    datasets: ['World Cup Core'],
    panelItems: [],
    visualizations: [],
    startedAt: '2026-11-01T11:00:00.000Z',
    finishedAt: '2026-11-01T11:00:05.000Z',
  },
];

const OLD_SESSIONS = ['deep-analysis', 'seq-text-demo', 'agent:assistant'].map(
  (workflowId, i) => ({
    id: `old-session-${i}`,
    name: `Old ${workflowId}`,
    datasets: ['World Cup Core'],
    workflowId,
    messages: [],
    visualizations: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }),
);

describe('Stored runs: the run history API (API)', () => {
  let backend: Backend | undefined;
  let stub: LlmStub;
  const http = () => request.agent(backend!.url);
  const transcript: string[] = [];

  /** Record one history call for the evidence transcript. */
  const note = (line: string, body: unknown) =>
    transcript.push(`# ${line}`, JSON.stringify(body, null, 2), '');

  const runStream = async (id: string, body: object) => {
    const res = await fetch(
      `${backend!.url}/workflows/${encodeURIComponent(id)}/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return { status: res.status, frames: framesOf(await res.text()) };
  };

  const waitForModelCall = async (question: string) => {
    const deadline = Date.now() + 20_000;
    while (
      !stub.requests.some((req) => lastQuestion(req).includes(question)) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const configure = async () => {
    const saved = (
      await http().put('/llm/settings').send({
        provider: 'lenai',
        model: 'stub-deployment',
        baseUrl: stub.baseUrl,
        apiKey: 'sk-stub',
      })
    ).body as { ok: boolean };
    expect(saved).toMatchObject({ ok: true });
    const postgres = (
      await http()
        .post('/datasources')
        .send({
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
        })
    ).body as { ok: boolean; datasource?: { id: string } };
    expect(postgres).toMatchObject({ ok: true });
    const dataset = (
      await http()
        .post('/datasets')
        .send({
          name: 'World Cup Core',
          tables: ['world_cup.world_cup.matches'],
          entities: [
            {
              key: 'world_cup.world_cup.matches',
              columns: [
                { name: 'match_number', type: 'integer', nullable: false },
              ],
            },
          ],
          datasourceId: postgres.datasource!.id,
          datasourceKind: 'postgres',
        })
    ).body as { ok: boolean };
    expect(dataset).toMatchObject({ ok: true });
  };

  beforeAll(async () => {
    stub = await startLlmStub();
    backend = await boot(dataDir);
    await configure();
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
    const file = process.env['WORKFLOW_RUN_HISTORY_TRANSCRIPT'];
    if (file && transcript.length) writeFileSync(file, transcript.join('\n'));
  });

  it('an Avery + Michael run is stored: listed while it runs, fetched as it ended, then deleted with its workspace', async () => {
    // Hold the turn's first model call while the run is listed.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.stream && lastQuestion(req).includes(HOLD_QUESTION)
        ? held
        : undefined;
    const pending = runStream(ASK_WORKFLOW_ID, {
      input: {
        question: HOLD_QUESTION,
        datasets: ['World Cup Core'],
      },
    });
    await waitForModelCall(HOLD_QUESTION);
    const listedWhileRunning = (
      (await http().get('/workflow-runs').expect(200)).body as {
        runs: { id: string; status: string }[];
      }
    ).runs;
    expect(listedWhileRunning).toHaveLength(1);
    const runId = listedWhileRunning[0].id;
    expect(listedWhileRunning[0].status).toBe('running');
    // A running run can't be deleted.
    const busy = await http().delete(`/workflow-runs/${runId}`).expect(400);
    expect((busy.body as { message: string }).message).toBe(
      'Stop the run before deleting it',
    );
    release();
    const { frames } = await pending;
    stub.hold = undefined;
    const done = frames.at(-1)!;
    expect(done.type).toBe('done');
    const run = done.run!;
    expect(run).toMatchObject({
      id: runId,
      workflowId: ASK_WORKFLOW_ID,
      status: 'success',
      question: HOLD_QUESTION,
      answer: { role: 'assistant', content: STUB_ANSWER },
      panelItems: [],
      output: { answer: STUB_ANSWER },
    });

    // Listed, newest first, with its title; filtered by workflow.
    const list = (await http().get('/workflow-runs').expect(200)).body as {
      runs: unknown[];
    };
    note('GET /workflow-runs', list);
    expect(list.runs).toEqual([
      {
        id: runId,
        workflowId: ASK_WORKFLOW_ID,
        workflowName: ASK_WORKFLOW_NAME,
        // A first message starts a conversation of its own.
        conversationId: runId,
        status: 'success',
        title: HOLD_QUESTION,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        // Accepted queued, then started once (api.md 119).
        queuedAt: run.queuedAt,
        attempts: 1,
      },
    ]);
    expect(run.queuedAt).toEqual(expect.any(String));
    const other = (
      await http().get('/workflow-runs?workflowId=seq-text-demo').expect(200)
    ).body as { runs: unknown[] };
    expect(other.runs).toEqual([]);

    // Fetched as the stream ended it.
    const fetched = (await http().get(`/workflow-runs/${runId}`).expect(200))
      .body as WireRun;
    note(`GET /workflow-runs/${runId}`, fetched);
    expect(fetched).toEqual(run);
    const missing = await http()
      .get(`/workflow-runs/${runId}/panel-items/nope/file`)
      .expect(404);
    expect((missing.body as { message: string }).message).toBe(
      'Panel item "nope" not found',
    );

    // Deleted with its workspace.
    expect(existsSync(workspace(`run-${runId}`))).toBe(true);
    const removed = (await http().delete(`/workflow-runs/${runId}`).expect(200))
      .body as unknown;
    note(`DELETE /workflow-runs/${runId}`, removed);
    expect(removed).toEqual({ ok: true, message: 'Run deleted' });
    expect(existsSync(workspace(`run-${runId}`))).toBe(false);
    const gone = await http().get(`/workflow-runs/${runId}`).expect(404);
    expect((gone.body as { message: string }).message).toBe(
      `Run "${runId}" not found`,
    );
  });

  describe('runs and sessions of the workflows removed in 1.23.35', () => {
    beforeAll(async () => {
      // Written into the store as an earlier version left them.
      await stop(backend);
      const db = new BetterSqlite3(join(dataDir, 'app.sqlite'));
      const insertRun = db.prepare(
        `INSERT INTO workflow_runs (doc) VALUES (?)`,
      );
      for (const run of OLD_RUNS) {
        insertRun.run(JSON.stringify({ ...run, ownerId: 'local' }));
      }
      const insertSession = db.prepare(`INSERT INTO sessions (doc) VALUES (?)`);
      for (const session of OLD_SESSIONS) {
        insertSession.run(JSON.stringify({ ...session, ownerId: 'local' }));
      }
      db.close();
      mkdirSync(join(workspace('run-old-deep'), 'reports'), {
        recursive: true,
      });
      writeFileSync(
        join(workspace('run-old-deep'), 'reports', 'old-deep.md'),
        REPORT_MD,
      );
      backend = await boot(dataDir);
    });

    afterAll(async () => {
      for (const run of OLD_RUNS) {
        await http().delete(`/workflow-runs/${run.id}`).expect(200);
      }
    });

    it('list as plain runs, titled from their question or first text input', async () => {
      const runs = (
        (await http().get('/workflow-runs').expect(200)).body as {
          runs: { id: string; workflowId: string; title: string }[];
        }
      ).runs;
      note('GET /workflow-runs (stored runs of removed workflows)', runs);
      expect(
        runs.map(({ id, workflowId, title }) => [id, workflowId, title]),
      ).toEqual([
        ['old-assistant', 'agent:assistant', 'Who hosted in 2002?'],
        ['old-deep', 'deep-analysis', 'Why did scoring fall?'],
        ['old-seq', 'seq-text-demo', 'Hello world'],
      ]);
      const filtered = (
        await http().get('/workflow-runs?workflowId=deep-analysis').expect(200)
      ).body as { runs: { id: string }[] };
      expect(filtered.runs.map((run) => run.id)).toEqual(['old-deep']);
    });

    it('read as stored, a deep analysis report served from its workspace', async () => {
      const seq = (await http().get('/workflow-runs/old-seq').expect(200))
        .body as WireRun;
      expect(seq).toMatchObject({
        workflowId: 'seq-text-demo',
        status: 'success',
        steps: [{ id: 'clean-text', status: 'success' }],
        output: { summary: '2 words, 11 characters: "Hello world"' },
      });
      const deep = (await http().get('/workflow-runs/old-deep').expect(200))
        .body as WireRun & { workflow?: unknown; agent?: unknown };
      note('GET /workflow-runs/old-deep', deep);
      expect(deep).toMatchObject({
        workflowId: 'deep-analysis',
        question: 'Why did scoring fall?',
        answer: { content: 'Defences got better.' },
        panelItems: [{ id: 'report', kind: 'file' }],
      });
      const file = (
        await http()
          .get('/workflow-runs/old-deep/panel-items/report/file')
          .expect(200)
      ).body as { contentType: string; text: string };
      expect(file).toMatchObject({
        contentType: 'text/markdown',
        text: REPORT_MD,
      });
      const download = await http()
        .get('/workflow-runs/old-deep/panel-items/report/download')
        .expect(200);
      expect(download.headers['content-disposition']).toBe(
        'attachment; filename="old-deep.md"',
      );
      const assistant = (
        await http().get('/workflow-runs/old-assistant').expect(200)
      ).body as WireRun;
      expect(assistant).toMatchObject({
        workflowId: 'agent:assistant',
        answer: { content: 'Korea and Japan.' },
      });
    });

    it.each(['deep-analysis', 'seq-text-demo', 'agent:assistant'])(
      'cannot run %s again, with or without the stored run as context',
      async (id) => {
        const before = stub.requests.length;
        for (const body of [
          { input: { question: 'Again', datasets: ['World Cup Core'] } },
          {
            input: { question: 'Again', datasets: ['World Cup Core'] },
            context: { fromRunId: 'old-deep' },
          },
        ]) {
          const res = await fetch(
            `${backend!.url}/workflows/${encodeURIComponent(id)}/runs/stream`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
          );
          expect(res.status).toBe(404);
          expect(((await res.json()) as { message: string }).message).toBe(
            `Workflow "${id}" not found`,
          );
        }
        expect(stub.requests.length).toBe(before);
      },
    );

    it('an Avery + Michael run may continue from one with an answer; one without is refused clearly', async () => {
      const followUp = await runStream(ASK_WORKFLOW_ID, {
        input: {
          question: 'And why now?',
          datasets: ['World Cup Core'],
        },
        context: { fromRunId: 'old-deep' },
      });
      expect(followUp.status).toBe(200);
      expect(followUp.frames.at(-1)!.type).toBe('done');
      await http()
        .delete(`/workflow-runs/${followUp.frames[0].runId}`)
        .expect(200);
      const refused = await http()
        .post(`/workflows/${ASK_WORKFLOW_ID}/runs/stream`)
        .send({
          input: {
            question: 'And?',
            datasets: ['World Cup Core'],
          },
          context: { fromRunId: 'old-seq' },
        })
        .expect(400);
      expect((refused.body as { message: string }).message).toBe(
        'Run "old-seq" has no answer to continue from',
      );
    });

    it('sessions bound to them read as plain Assistant sessions', async () => {
      const sessions = (
        (await http().get('/sessions').expect(200)).body as {
          sessions: {
            id: string;
            workflowRef?: { id: string; name: string; deleted: boolean };
          }[];
        }
      ).sessions;
      for (const old of OLD_SESSIONS) {
        expect(sessions.find((s) => s.id === old.id)?.workflowRef).toEqual({
          id: 'agent:assistant',
          name: 'Assistant',
          kind: 'agent',
          deleted: false,
        });
        await http().get(`/sessions/${old.id}`).expect(200);
      }
    });
  });

  it('after a restart: a run the app was killed in starts again from scratch and succeeds, an orphan run workspace is gone, and a stored run is still context', async () => {
    const first = await runStream(ASK_WORKFLOW_ID, {
      input: {
        question: 'Who hosted in 2002?',
        datasets: ['World Cup Core'],
      },
    });
    const firstId = first.frames[0].runId!;
    expect(first.frames.at(-1)!.type).toBe('done');

    // Kill the backend while a run's model call is open.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.stream && lastQuestion(req).includes('Hold this one')
        ? held
        : undefined;
    const controller = new AbortController();
    const pending = fetch(
      `${backend!.url}/workflows/${ASK_WORKFLOW_ID}/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            question: 'Hold this one',
            datasets: ['World Cup Core'],
          },
        }),
        signal: controller.signal,
      },
    ).catch(() => undefined);
    await waitForModelCall('Hold this one');
    const cut = (
      (await http().get('/workflow-runs').expect(200)).body as {
        runs: { id: string; status: string }[];
      }
    ).runs.find((run) => run.status === 'running')!;
    expect(cut).toBeDefined();
    const child = backend!.process;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
    controller.abort();
    await pending;
    release();
    stub.hold = undefined;
    mkdirSync(workspace('run-orphan'), { recursive: true });

    const asked = stub.requests.length;
    backend = await boot(dataDir);

    // Queued again at start-up, it starts once the app is up and runs to
    // its end on its second attempt.
    const read = async () =>
      (await http().get(`/workflow-runs/${cut.id}`).expect(200))
        .body as WireRun;
    let recovered = await read();
    const deadline = Date.now() + 30_000;
    while (
      (recovered.status === 'queued' || recovered.status === 'running') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      recovered = await read();
    }
    note(`GET /workflow-runs/${cut.id} (after a restart)`, recovered);
    expect(recovered).toMatchObject({
      id: cut.id,
      status: 'success',
      attempts: 2,
      question: 'Hold this one',
    });
    expect(recovered.error).toBeUndefined();
    expect(recovered.queuedAt).toBeDefined();
    expect(recovered.finishedAt).toBeDefined();
    expect(
      stub.requests
        .slice(asked)
        .some((req) => lastQuestion(req).includes('Hold this one')),
    ).toBe(true);
    expect(existsSync(workspace(`run-${cut.id}`))).toBe(true);
    expect(existsSync(workspace('run-orphan'))).toBe(false);

    const before = stub.requests.length;
    const followUp = await runStream(ASK_WORKFLOW_ID, {
      input: {
        question: 'And in 2006?',
        datasets: ['World Cup Core'],
      },
      context: { fromRunId: firstId },
    });
    expect(followUp.frames.at(-1)!.type).toBe('done');
    const turn = stub.requests
      .slice(before)
      .find((req) => req.stream && !req.avery)!;
    expect(
      turn.messages
        .filter((message) => message.role !== 'system')
        .map((message) => [message.role, messageText(message)]),
    ).toEqual([
      // The earlier run's threads survived the restart: Michael goes on
      // from a copy of his thread (agents.md 5.14), then this question.
      ['user', 'Who hosted in 2002?'],
      ['assistant', STUB_ANSWER],
      ['user', 'And in 2006?'],
    ]);
  });
});

/**
 * M18 (data-model 6): the stored runs of the two removed question-answering
 * workflows are deleted at every start, with their node chats, memory
 * threads and run workspace; Answer a Business Question (Avery + Michael)
 * keeps its runs. Seeded in the store as an earlier version left them (they
 * can no longer be made), the backend booted twice.
 */
describe('Runs of the removed question-answering workflows (API)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qti-workflow-removed-runs-'));
  const REMOVED = [
    { id: 'm18-abq', workflowId: 'answer-business-question', step: 'analyse' },
    {
      id: 'm18-orch',
      workflowId: 'orchestrated-answer',
      step: 'orchestrate',
    },
    {
      id: 'm18-orch-waiting',
      workflowId: 'orchestrated-answer',
      step: 'orchestrate',
    },
  ];
  const KEPT = {
    id: 'm18-avery',
    workflowId: ASK_WORKFLOW_ID,
    step: 'orchestrate',
  };
  const ALL = [...REMOVED, KEPT];
  const hostOf = (id: string) => join(dir, 'workspaces', `session-run-${id}`);
  let backend: Backend | undefined;

  const runDoc = (run: (typeof ALL)[number], status: string) => ({
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowId,
    input: { question: `Question of ${run.id}`, datasets: ['World Cup Core'] },
    status,
    steps: [{ id: run.step, title: run.step, status: 'success' }],
    question: `Question of ${run.id}`,
    answer: {
      role: 'assistant',
      content: `Answer of ${run.id}`,
      at: '2026-11-01T10:04:00.000Z',
    },
    datasets: ['World Cup Core'],
    panelItems: [],
    visualizations: [],
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:04:00.000Z',
    ownerId: 'local',
  });

  /** The threads (by resource) of the app's Mastra store, as a sorted list. */
  const threads = () => {
    const db = new BetterSqlite3(join(dir, 'mastra.sqlite'), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      return (
        db.prepare('SELECT id FROM "mastra_threads"').all() as { id: string }[]
      )
        .map((row) => row.id)
        .sort();
    } finally {
      db.close();
    }
  };

  /** The run ids that still have a node chat in the store. */
  const chatRuns = () => {
    const db = new BetterSqlite3(join(dir, 'app.sqlite'), { readonly: true });
    try {
      return (
        db.prepare('SELECT doc FROM workflow_run_node_chats').all() as {
          doc: string;
        }[]
      )
        .map((row) => (JSON.parse(row.doc) as { runId: string }).runId)
        .sort();
    } finally {
      db.close();
    }
  };

  /** What the start left behind, for comparing two starts. */
  const state = async () => ({
    runs: (
      (await request.agent(backend!.url).get('/workflow-runs').expect(200))
        .body as { runs: { id: string }[] }
    ).runs
      .map((run) => run.id)
      .sort(),
    threads: threads(),
    chats: chatRuns(),
    workspaces: ALL.filter((run) => existsSync(hostOf(run.id))).map(
      (run) => run.id,
    ),
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes them with their node chats, memory threads and workspaces at the start, keeps an Avery + Michael run, and changes nothing at the next start', async () => {
    // A first start makes the stores; the seeds go in while it is stopped.
    backend = await boot(dir);
    await stop(backend);

    const mastra = new BetterSqlite3(join(dir, 'mastra.sqlite'));
    const columns = (
      mastra.prepare('PRAGMA table_info("mastra_threads")').all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    const now = '2026-11-01T10:00:00.000Z';
    const insertThread = (id: string, resourceId: string) => {
      const values: Record<string, string> = {
        id,
        resourceId,
        title: id,
        metadata: '{}',
        createdAt: now,
        updatedAt: now,
        createdAtZ: now,
        updatedAtZ: now,
      };
      const names = columns.filter((name) => name in values);
      mastra
        .prepare(
          `INSERT INTO "mastra_threads" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        )
        .run(...names.map((name) => values[name]));
    };

    const app = new BetterSqlite3(join(dir, 'app.sqlite'));
    const insertRun = app.prepare('INSERT INTO workflow_runs (doc) VALUES (?)');
    const insertChat = app.prepare(
      'INSERT INTO workflow_run_node_chats (doc) VALUES (?)',
    );
    for (const run of ALL) {
      insertRun.run(
        JSON.stringify(
          runDoc(run, run.id === 'm18-orch-waiting' ? 'failed' : 'success'),
        ),
      );
      insertChat.run(
        JSON.stringify({
          id: `chat-${run.id}`,
          runId: run.id,
          stepId: run.step,
          messages: [
            {
              id: `message-${run.id}`,
              role: 'user',
              content: 'Why?',
              createdAt: now,
            },
          ],
          ownerId: 'local',
        }),
      );
      insertThread(`run-${run.id}`, `run-${run.id}`);
      insertThread(`run-${run.id}:analysis-planner`, `run-${run.id}`);
      insertThread(
        `run-${run.id}-node-${run.step}`,
        `run-${run.id}-node-${run.step}`,
      );
      mkdirSync(hostOf(run.id), { recursive: true });
      writeFileSync(join(hostOf(run.id), 'notes.md'), run.id);
    }
    app.close();
    mastra.close();
    // Everything is in the store before the start that cleans it.
    expect(threads()).toHaveLength(ALL.length * 3);
    expect(chatRuns()).toHaveLength(ALL.length);

    backend = await boot(dir);
    const http = () => request.agent(backend!.url);
    const first = await state();
    // Only the Avery + Michael run is left, with all it had.
    expect(first).toEqual({
      runs: [KEPT.id],
      threads: [
        `run-${KEPT.id}`,
        `run-${KEPT.id}-node-${KEPT.step}`,
        `run-${KEPT.id}:analysis-planner`,
      ].sort(),
      chats: [KEPT.id],
      workspaces: [KEPT.id],
    });
    for (const run of REMOVED) {
      await http().get(`/workflow-runs/${run.id}`).expect(404);
    }
    expect(
      (await http().get(`/workflow-runs/${KEPT.id}`).expect(200)).body,
    ).toMatchObject({ id: KEPT.id, workflowId: ASK_WORKFLOW_ID });
    await http()
      .get(`/workflow-runs/${KEPT.id}/node-chats/${KEPT.step}`)
      .expect(200)
      .expect(({ body }) =>
        expect((body as { messages: unknown[] }).messages).toHaveLength(1),
      );
    // The two workflows are no workflows of the catalogue any more.
    for (const id of ['answer-business-question', 'orchestrated-answer']) {
      await http().get(`/workflows/${id}`).expect(404);
    }

    // The next start finds none of them: nothing changes.
    await stop(backend);
    backend = await boot(dir);
    expect(await state()).toEqual(first);
  });
});
