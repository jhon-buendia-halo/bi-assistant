/**
 * API-level proof of streamed runs of agent workflows (ADR-0041; api.md 119;
 * agents.md 5.14; workflows R14-R16): `POST /workflows/:id/runs/stream`
 * runs one agent turn on a run host through today's turn path, so a run's
 * model request equals a chat turn's for the same input (the Assistant,
 * Questions to Insights v2, the Data Readiness Agent and the RFP Builder,
 * recorded by the stub model), streams `run`, `step`, the turn's events and
 * `done { run }`, refuses a bad request with its real status before any
 * stream, and stops when the connection closes. The sequential test workflow
 * still runs through `POST /workflows/:id/runs` (118).
 *
 * Needs no Postgres: the datasources point at closed ports, and the stub
 * model never calls a tool. Set `WORKFLOW_RUNS_TRANSCRIPT=<file>` to write
 * the SSE transcript of one Assistant run and one v2 run there.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  messageText,
  startLlmStub,
  STUB_ANSWER,
  type LlmStub,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import { type Backend, boot, stop } from './backend-process';

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
  output?: Record<string, unknown>;
  error?: string;
  run?: {
    id: string;
    workflowId: string;
    status: string;
    steps: { id: string; status: string }[];
    question?: string;
    answer?: { role: string; content: string };
    datasets: string[];
    output?: Record<string, unknown>;
  };
}

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
  };
}

describe('Streamed runs of agent workflows (API)', () => {
  let backend: Backend | undefined;
  let stub: LlmStub;
  const http = () => request.agent(backend!.url);
  const transcript: string[] = [];

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

  const chatTurn = async (sessionId: string, content: string) => {
    const res = await fetch(
      `${backend!.url}/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
    );
    return framesOf(await res.text());
  };

  const createSession = async (body: object) => {
    const answer = (await http().post('/sessions').send(body)).body as {
      ok: boolean;
      message: string;
      session?: { id: string; datasets: string[] };
    };
    expect(answer).toMatchObject({ ok: true });
    return answer.session!;
  };

  const save = async (path: string, body: object) => {
    const answer = (await http().post(path).send(body)).body as {
      ok: boolean;
      message: string;
      datasource?: { id: string };
    };
    expect({ path, ok: answer.ok, message: answer.message }).toMatchObject({
      ok: true,
    });
    return answer;
  };

  beforeAll(async () => {
    stub = await startLlmStub();
    backend = await boot(dataDir, { env: { INTELLIFY_API: 'off' } });
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
        endpoints: [{ name: 'rfps', path: '/v1/rfps' }],
      },
    });
    await save('/datasets', {
      name: 'Intellify RFP API',
      tables: ['rest.api.rfps'],
      entities: [
        {
          key: 'rest.api.rfps',
          columns: [{ name: 'id', type: 'text', nullable: false }],
        },
      ],
      datasourceId: rest.datasource!.id,
      datasourceKind: 'rest',
    });
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
    const file = process.env['WORKFLOW_RUNS_TRANSCRIPT'];
    if (file && transcript.length) writeFileSync(file, transcript.join('\n'));
  });

  it('streams an Assistant run: run, the Answer step, the answer, then done with the run', async () => {
    const question = 'Who won the 2002 World Cup?';
    const res = await runStream('agent:assistant', {
      input: { question, datasets: ['World Cup Core'] },
    });
    expect(res.status).toBe(200);
    transcript.push(
      `# POST /workflows/agent%3Aassistant/runs/stream  {"input":{"question":"${question}","datasets":["World Cup Core"]}}`,
      res.text,
    );
    const types = res.frames.map((frame) => frame.type);
    expect(types[0]).toBe('run');
    expect(types.at(-1)).toBe('done');
    expect(res.frames[0]).toMatchObject({ workflowId: 'agent:assistant' });
    const steps = res.frames.filter((frame) => frame.type === 'step');
    expect(steps.map((step) => `${step.id}:${step.status}`)).toEqual([
      'answer:running',
      'answer:success',
    ]);
    expect(types).toContain('text');
    const run = res.frames.at(-1)!.run!;
    expect(run).toMatchObject({
      id: res.frames[0].runId,
      workflowId: 'agent:assistant',
      status: 'success',
      question,
      datasets: ['World Cup Core'],
      answer: { role: 'assistant', content: STUB_ANSWER },
      steps: [{ id: 'answer', status: 'success' }],
    });
    // The run is never listed with the sessions.
    const sessions = (
      (await http().get('/sessions').expect(200)).body as {
        sessions: { id: string }[];
      }
    ).sessions;
    expect(sessions.some((session) => session.id.includes(run.id))).toBe(false);
  });

  it('streams a v2 run: four steps, each running then done', async () => {
    const question = 'How many matches were played?';
    const res = await runStream('qti-v2-turn', {
      input: { question, datasets: ['World Cup Core'] },
    });
    transcript.push(
      `# POST /workflows/qti-v2-turn/runs/stream  {"input":{"question":"${question}","datasets":["World Cup Core"]}}`,
      res.text,
    );
    const steps = res.frames.filter((frame) => frame.type === 'step');
    expect(steps.map((step) => `${step.id}:${step.status}`)).toEqual([
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'analyse:running',
      'analyse:success',
      'wrap-up:running',
      'wrap-up:success',
    ]);
    const run = res.frames.at(-1)!.run!;
    expect(run).toMatchObject({
      workflowId: 'qti-v2-turn',
      status: 'success',
      answer: { content: STUB_ANSWER },
      output: { sqlQueries: 0, failedQueries: 0, rows: 0 },
    });
  });

  describe("a run's model request equals a chat turn's for the same input", () => {
    it('the Assistant', async () => {
      const question = 'Which team scored most in 2014?';
      const session = await createSession({
        name: 'Parity',
        datasets: ['World Cup Core'],
      });
      const chat = await recorded(() => chatTurn(session.id, question));
      const run = await recorded(() =>
        runStream('agent:assistant', {
          input: { question, datasets: ['World Cup Core'] },
        }),
      );
      expect(chat.length).toBeGreaterThan(0);
      expect(run).toEqual(chat);
    });

    it('Questions to Insights v2', async () => {
      const question = 'Which stadium hosted the final?';
      const session = await createSession({
        agentId: 'assistant-v2',
        name: 'Parity v2',
        datasets: ['World Cup Core'],
      });
      const chat = await recorded(() => chatTurn(session.id, question));
      const run = await recorded(() =>
        runStream('qti-v2-turn', {
          input: { question, datasets: ['World Cup Core'] },
        }),
      );
      expect(chat.length).toBeGreaterThan(0);
      expect(run).toEqual(chat);
    });

    it('the Data Readiness Agent', async () => {
      const question = 'What are the worst data-quality problems?';
      const session = await createSession({ agentId: 'data-readiness' });
      expect(session.datasets).toEqual(['World Cup Core']);
      const chat = await recorded(() => chatTurn(session.id, question));
      const run = await recorded(() =>
        runStream('agent:data-readiness', {
          input: { dataset: 'World Cup Core', question },
        }),
      );
      expect(chat.length).toBeGreaterThan(0);
      expect(run).toEqual(chat);
    });

    it('the RFP Builder', async () => {
      const message = 'Start an RFP for Acme, plan year 2027';
      const session = await createSession({ agentId: 'rfp' });
      const chat = await recorded(() => chatTurn(session.id, message));
      const run = await recorded(() =>
        runStream('agent:rfp', { input: { message } }),
      );
      expect(chat.length).toBeGreaterThan(0);
      expect(run).toEqual(chat);
    });
  });

  it("a follow-up run sends the earlier run's question and answer first", async () => {
    const first = await runStream('agent:assistant', {
      input: { question: 'Who hosted in 2002?', datasets: ['World Cup Core'] },
    });
    const runId = first.frames[0].runId!;
    const sent = await recorded(() =>
      runStream('agent:assistant', {
        input: { question: 'And in 2006?', datasets: ['World Cup Core'] },
        context: { fromRunId: runId },
      }),
    );
    const turn = sent.find((req) => req.stream)!;
    const dialogue = turn.messages
      .filter((message) => message.role !== 'system')
      .map((message) => [message.role, messageText(message)]);
    expect(dialogue).toEqual([
      ['user', 'Who hosted in 2002?'],
      ['assistant', STUB_ANSWER],
      ['user', 'And in 2006?'],
    ]);
  });

  it('closing the connection stops the run: no terminal event, and it has no answer to continue from', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.messages.some((m) => messageText(m).includes('Hold this one'))
        ? held
        : undefined;
    const controller = new AbortController();
    const res = await fetch(
      `${backend!.url}/workflows/agent%3Aassistant/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { question: 'Hold this one', datasets: ['World Cup Core'] },
        }),
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
    release();
    stub.hold = undefined;
    // The stopped run is stored without an answer.
    let refusal: { status: number; message?: string } = { status: 0 };
    for (let i = 0; i < 40; i++) {
      const answer = await http()
        .post('/workflows/agent%3Aassistant/runs/stream')
        .send({
          input: { question: 'Next', datasets: ['World Cup Core'] },
          context: { fromRunId: runId },
        });
      refusal = {
        status: answer.status,
        message: (answer.body as { message?: string }).message,
      };
      if (refusal.message !== `Run "${runId}" not found`) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(refusal).toEqual({
      status: 400,
      message: `Run "${runId}" has no answer to continue from`,
    });
  });

  describe('refusals before any stream (Style B)', () => {
    it.each([
      [
        'agent:assistant',
        { input: { datasets: ['World Cup Core'] } },
        400,
        'Question is required',
      ],
      [
        'agent:assistant',
        { input: { question: 'Hi' } },
        400,
        'Select at least one dataset',
      ],
      [
        'qti-v2-turn',
        { input: { question: 'Hi', datasets: ['Nope'] } },
        400,
        'Dataset "Nope" not found',
      ],
      [
        'agent:data-readiness',
        { input: { dataset: 'Intellify RFP API' } },
        400,
        'Dataset "Intellify RFP API" is not a PostgreSQL or Databricks dataset',
      ],
      [
        'agent:assistant',
        {
          input: { question: 'Hi', datasets: ['World Cup Core'] },
          context: { fromRunId: 'nope' },
        },
        400,
        'Run "nope" not found',
      ],
      ['nope', { input: {} }, 404, 'Workflow "nope" not found'],
    ])('%s %p answers %d %p', async (id, body, status, message) => {
      const before = stub.requests.length;
      const res = await runStream(id, body);
      expect(res.status).toBe(status);
      expect((JSON.parse(res.text) as { message: string }).message).toBe(
        message,
      );
      expect(stub.requests.length).toBe(before);
    });

    it("refuses the RFP Builder with its run requirement while the sample isn't loaded", async () => {
      const removed = (
        await http().delete(
          `/datasets/${encodeURIComponent('Intellify RFP API')}`,
        )
      ).body as { ok: boolean };
      expect(removed).toMatchObject({ ok: true });
      const res = await runStream('agent:rfp', { input: { message: 'Start' } });
      expect(res.status).toBe(400);
      expect((JSON.parse(res.text) as { message: string }).message).toBe(
        'Load the "Intellify RFP API" sample in Settings → Testing Data first',
      );
    });
  });

  it('the sequential test workflow still runs through POST /runs (118)', async () => {
    const res = await http()
      .post('/workflows/seq-text-demo/runs')
      .send({ input: { text: '  Hello   workflow   world  ' } })
      .expect(200);
    expect(res.body).toMatchObject({
      workflowId: 'seq-text-demo',
      status: 'success',
      output: { summary: '3 words, 20 characters: "Hello workflow world"' },
      runId: expect.any(String) as string,
    });
  });
});
