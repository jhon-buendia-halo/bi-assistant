/**
 * API-level proof of stored runs (ADR-0041; api.md 118, 120-127;
 * data-model 3.16; workflows R18-R20): an Assistant run with the recording
 * stub model is stored, listed, fetched, its panel files downloaded from its
 * workspace, and deleted with that workspace; `POST /workflows/:id/runs`
 * stores a code-only run; after the backend restarts, a run it was killed in
 * is `failed`, an orphan run workspace is gone, and a stored run is still the
 * context of a follow-up run.
 *
 * Needs no Postgres: the dataset points at a closed port, and the stub model
 * only calls `show_in_panel`. Set `WORKFLOW_RUN_HISTORY_TRANSCRIPT=<file>`
 * to write the HTTP transcript of the history routes there.
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
import request from 'supertest';
import {
  messageText,
  startLlmStub,
  STUB_ANSWER,
  type LlmStub,
  type StubReply,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
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
  question?: string;
  error?: string;
  answer?: { role: string; content: string };
  panelItems?: { id: string; kind: string; title: string; path?: string }[];
  steps: { id: string; status: string }[];
  startedAt: string;
  finishedAt?: string;
}

const NOTES_MD = '# Summary notes\n\nGermany reached the final.';
const FINDINGS_MD = '# Findings\n\nBrazil scored most.';
const PANEL_QUESTION = 'Put the notes in the panel';

/** The frames of an SSE body (api.md 3.1 framing). */
function framesOf(text: string): Frame[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as Frame);
}

/** The latest user message's text and how many tool results follow it. */
function position(req: StubRequest): { question: string; step: number } {
  let index = -1;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') {
      index = i;
      break;
    }
  }
  if (index < 0) return { question: '', step: 0 };
  return {
    question: messageText(req.messages[index]),
    step: req.messages.slice(index + 1).filter((m) => m.role === 'tool').length,
  };
}

/** A workspace of the backend's data dir (data-model 4.1). */
const workspace = (hostId: string) =>
  join(dataDir, 'workspaces', `session-${hostId}`);

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
    return framesOf(await res.text());
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
    backend = await boot(dataDir, { env: { INTELLIFY_API: 'off' } });
    await configure();
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
    const file = process.env['WORKFLOW_RUN_HISTORY_TRANSCRIPT'];
    if (file && transcript.length) writeFileSync(file, transcript.join('\n'));
  });

  it('an Assistant run is stored: listed, fetched, its panel files downloaded, then deleted with its workspace', async () => {
    // The turn shows a document, then a workspace file, then answers.
    const calls = [
      {
        name: 'show_in_panel',
        arguments: {
          kind: 'document',
          title: 'Findings',
          markdown: FINDINGS_MD,
        },
      },
      {
        name: 'show_in_panel',
        arguments: { kind: 'file', path: 'notes/summary.md' },
      },
    ];
    stub.reply = (req): StubReply => {
      const { question, step } = position(req);
      if (!req.stream || !question.includes(PANEL_QUESTION)) {
        return { text: STUB_ANSWER };
      }
      if (step < calls.length) {
        const call = calls[step];
        const name =
          req.tools.find((tool) => tool === call.name) ??
          req.tools.find((tool) => tool.endsWith(call.name)) ??
          call.name;
        return { toolCall: { name, arguments: call.arguments } };
      }
      return { text: 'The notes are in the panel.' };
    };
    // Hold the turn's first model call until the file is in the run's
    // workspace, which exists once the run host does.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.stream && position(req).question.includes(PANEL_QUESTION)
        ? held
        : undefined;
    const pending = runStream('agent:assistant', {
      input: { question: PANEL_QUESTION, datasets: ['World Cup Core'] },
    });
    const deadline = Date.now() + 20_000;
    while (
      !stub.requests.some((req) =>
        position(req).question.includes(PANEL_QUESTION),
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
    mkdirSync(join(workspace(`run-${runId}`), 'notes'), { recursive: true });
    writeFileSync(
      join(workspace(`run-${runId}`), 'notes', 'summary.md'),
      NOTES_MD,
    );
    release();
    const frames = await pending;
    stub.hold = undefined;
    stub.reply = () => ({ text: STUB_ANSWER });
    const done = frames.at(-1)!;
    expect(done.type).toBe('done');
    const run = done.run!;
    expect(run).toMatchObject({
      id: runId,
      workflowId: 'agent:assistant',
      status: 'success',
      question: PANEL_QUESTION,
      answer: { role: 'assistant', content: 'The notes are in the panel.' },
    });
    const document = run.panelItems!.find((item) => item.kind === 'document')!;
    const file = run.panelItems!.find((item) => item.kind === 'file')!;
    expect(document).toMatchObject({ title: 'Findings' });
    expect(file).toMatchObject({ path: 'notes/summary.md' });

    // Listed, newest first, with its title; filtered by workflow.
    const list = (await http().get('/workflow-runs').expect(200)).body as {
      runs: unknown[];
    };
    note('GET /workflow-runs', list);
    expect(list.runs).toEqual([
      {
        id: runId,
        workflowId: 'agent:assistant',
        workflowName: 'Assistant',
        status: 'success',
        title: PANEL_QUESTION,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
    ]);
    const other = (
      await http().get('/workflow-runs?workflowId=seq-text-demo').expect(200)
    ).body as { runs: unknown[] };
    expect(other.runs).toEqual([]);

    // Fetched as the stream ended it.
    const fetched = (await http().get(`/workflow-runs/${runId}`).expect(200))
      .body as WireRun;
    note(`GET /workflow-runs/${runId}`, fetched);
    expect(fetched).toEqual(run);

    // Its files, from its workspace.
    const text = (
      await http()
        .get(
          `/workflow-runs/${runId}/panel-items/${encodeURIComponent(file.id)}/file`,
        )
        .expect(200)
    ).body as { contentType: string; text: string };
    note(`GET /workflow-runs/${runId}/panel-items/${file.id}/file`, text);
    expect(text).toMatchObject({
      contentType: 'text/markdown',
      text: NOTES_MD,
    });
    const download = await http()
      .get(
        `/workflow-runs/${runId}/panel-items/${encodeURIComponent(file.id)}/download`,
      )
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    note(`GET /workflow-runs/${runId}/panel-items/${file.id}/download`, {
      'content-disposition': download.headers['content-disposition'],
      body: (download.body as Buffer).toString('utf8'),
    });
    expect(download.headers['content-disposition']).toBe(
      'attachment; filename="summary.md"',
    );
    expect((download.body as Buffer).toString('utf8')).toBe(NOTES_MD);
    const doc = await http()
      .get(
        `/workflow-runs/${runId}/panel-items/${encodeURIComponent(document.id)}/download`,
      )
      .expect(200);
    expect(doc.headers['content-disposition']).toBe(
      'attachment; filename="findings.md"',
    );
    expect(doc.text).toBe(FINDINGS_MD);
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
    note(`GET /workflow-runs/${runId} (after delete)`, gone.body);
    expect((gone.body as { message: string }).message).toBe(
      `Run "${runId}" not found`,
    );
  });

  it('POST /workflows/:id/runs (118) stores a code-only run and answers its runId', async () => {
    const res = await http()
      .post('/workflows/seq-text-demo/runs')
      .send({ input: { text: '  Hello   workflow   world  ' } })
      .expect(200);
    const answer = res.body as { runId: string; status: string };
    expect(answer).toMatchObject({
      workflowId: 'seq-text-demo',
      status: 'success',
      runId: expect.any(String) as string,
    });
    const stored = (
      await http().get(`/workflow-runs/${answer.runId}`).expect(200)
    ).body as WireRun;
    expect(stored).toMatchObject({
      id: answer.runId,
      workflowId: 'seq-text-demo',
      workflowName: 'Sequential test workflow',
      status: 'success',
      output: { summary: '3 words, 20 characters: "Hello workflow world"' },
    });
    const listed = (
      await http().get('/workflow-runs?workflowId=seq-text-demo').expect(200)
    ).body as { runs: { id: string; title: string }[] };
    expect(listed.runs).toEqual([
      expect.objectContaining({
        id: answer.runId,
        title: 'Hello   workflow   world',
      }),
    ]);
  });

  it('after a restart: a run the app was killed in is failed, an orphan run workspace is gone, and a stored run is still context', async () => {
    const first = await runStream('agent:assistant', {
      input: { question: 'Who hosted in 2002?', datasets: ['World Cup Core'] },
    });
    const firstId = first[0].runId!;
    expect(first.at(-1)!.type).toBe('done');

    // Kill the backend while a run's model call is open.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.stream && position(req).question.includes('Hold this one')
        ? held
        : undefined;
    const controller = new AbortController();
    const pending = fetch(
      `${backend!.url}/workflows/agent%3Aassistant/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { question: 'Hold this one', datasets: ['World Cup Core'] },
        }),
        signal: controller.signal,
      },
    ).catch(() => undefined);
    const deadline = Date.now() + 20_000;
    while (
      !stub.requests.some((req) =>
        position(req).question.includes('Hold this one'),
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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

    backend = await boot(dataDir, { env: { INTELLIFY_API: 'off' } });

    const recovered = (await http().get(`/workflow-runs/${cut.id}`).expect(200))
      .body as WireRun;
    note(`GET /workflow-runs/${cut.id} (after a restart)`, recovered);
    expect(recovered).toMatchObject({
      status: 'failed',
      error: 'The app stopped before the run finished',
    });
    expect(recovered.finishedAt).toBeDefined();
    expect(existsSync(workspace(`run-${cut.id}`))).toBe(true);
    expect(existsSync(workspace('run-orphan'))).toBe(false);

    const before = stub.requests.length;
    const followUp = await runStream('agent:assistant', {
      input: { question: 'And in 2006?', datasets: ['World Cup Core'] },
      context: { fromRunId: firstId },
    });
    expect(followUp.at(-1)!.type).toBe('done');
    const turn = stub.requests.slice(before).find((req) => req.stream)!;
    expect(
      turn.messages
        .filter((message) => message.role !== 'system')
        .map((message) => [message.role, messageText(message)]),
    ).toEqual([
      ['user', 'Who hosted in 2002?'],
      ['assistant', STUB_ANSWER],
      ['user', 'And in 2006?'],
    ]);
  });
});
