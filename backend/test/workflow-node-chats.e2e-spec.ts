/**
 * API-level proof of node chats (api.md 136, 137; agents.md 5.16;
 * data-model 3.17; workflows R25): after a stored run of Questions
 * to Insights v2, `POST /workflow-runs/:id/node-chats/analyse/messages/stream`
 * runs the Analyse step's agent with its own tools and the context block
 * built from the stored run, streams the turn's events and `done { message
 * }`, and stores the user and assistant messages, which `GET
 * /workflow-runs/:id/node-chats/analyse` answers. The run is never changed;
 * deleting it deletes its chats. Refusals answer JSON before any SSE frame.
 * Plan and Write answer, v2's other agent steps, take a chat too; a chat's
 * turn is the step's agent alone, never a run of the workflow.
 *
 * Needs no Postgres: the datasource points at a closed port, and the stub's
 * one tool call (`list_entities`) reads the stored catalog. Set
 * `NODE_CHAT_REQUEST_DUMP=<file>` to write the model request of the first
 * chat turn there.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  messageText,
  startLlmStub,
  STUB_ANSWER,
  systemTexts,
  type LlmStub,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import { type Backend, boot, stop } from './backend-process';
import { isPlanRequest, isWriteAnswerRequest, withV2Steps } from './v2-stub';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-node-chats-'));

jest.setTimeout(180_000);

const QUESTION = 'How many matches were played?';
const CHAT_ANSWER = 'The step listed one entity and answered from it.';

interface NodeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { tool: string; input?: string; rowCount?: number }[];
  stopped?: true;
  error?: string;
  createdAt: string;
}

interface Frame {
  type: string;
  content?: string;
  message?: NodeChatMessage;
}

function framesOf(text: string): Frame[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as Frame);
}

/** The last user message of a model request. */
const lastUser = (req: StubRequest) =>
  messageText(
    [...req.messages].reverse().find((message) => message.role === 'user') ?? {
      role: 'user',
    },
  );

describe('Node chats: chat with a step’s agent about its run data (API)', () => {
  let backend: Backend | undefined;
  let stub: LlmStub;
  let runId = '';
  const http = () => request.agent(backend!.url);

  const chatStream = async (id: string, stepId: string, body: unknown) => {
    const res = await fetch(
      `${backend!.url}/workflow-runs/${encodeURIComponent(id)}/node-chats/${encodeURIComponent(stepId)}/messages/stream`,
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
    };
  };

  beforeAll(async () => {
    stub = await startLlmStub();
    // A chat turn calls `list_entities` once, then answers; the run's own
    // turn answers at once.
    stub.reply = withV2Steps((req) => {
      if (!lastUser(req).startsWith('Chat:')) return { text: STUB_ANSWER };
      const last = req.messages.at(-1);
      return last?.role === 'tool'
        ? { text: CHAT_ANSWER }
        : { toolCall: { name: 'list_entities', arguments: {} } };
    });
    backend = await boot(dataDir);
    await http()
      .put('/llm/settings')
      .send({
        provider: 'lenai',
        model: 'stub-deployment',
        baseUrl: stub.baseUrl,
        apiKey: 'sk-stub',
      })
      .expect(200);
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
    ).body as { datasource: { id: string } };
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
        datasourceId: postgres.datasource.id,
        datasourceKind: 'postgres',
      })
      .expect((res) => expect(res.body).toMatchObject({ ok: true }));
    const run = (
      await http()
        .post('/workflows/qti-v2-turn/runs')
        .send({ input: { question: QUESTION, datasets: ['World Cup Core'] } })
        .expect(200)
    ).body as { id: string; status: string };
    expect(run.status).toBe('success');
    runId = run.id;
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('refuses a bad request with JSON before any SSE frame', async () => {
    const cases: [string, string, unknown, number, string][] = [
      [
        'nope',
        'analyse',
        { content: 'Chat: why?' },
        404,
        'Run "nope" not found',
      ],
      [runId, 'analyse', { content: '   ' }, 400, 'Message is required'],
      [runId, 'analyse', {}, 400, 'Message is required'],
      [
        runId,
        'load-catalog',
        { content: 'Chat: why?' },
        400,
        'Step "load-catalog" has no agent to chat with',
      ],
      [
        runId,
        'ghost',
        { content: 'Chat: why?' },
        400,
        'Step "ghost" has no agent to chat with',
      ],
      // Validate is code; Clarify is code and did not run.
      [
        runId,
        'validate',
        { content: 'Chat: why?' },
        400,
        'Step "validate" has no agent to chat with',
      ],
      [
        runId,
        'clarify',
        { content: 'Chat: why?' },
        400,
        'Step "clarify" has no agent to chat with',
      ],
    ];
    for (const [id, stepId, body, status, message] of cases) {
      const res = await chatStream(id, stepId, body);
      expect({ id, stepId, status: res.status }).toEqual({
        id,
        stepId,
        status,
      });
      expect(res.contentType).toContain('application/json');
      expect(JSON.parse(res.text)).toMatchObject({
        statusCode: status,
        message,
      });
    }
    await http().get('/workflow-runs/nope/node-chats/analyse').expect(404);
    // Nothing was stored.
    await http()
      .get(`/workflow-runs/${runId}/node-chats/analyse`)
      .expect(200, { messages: [] });
  });

  it('streams a reply about the step, stores both messages, sends the context block to the model and leaves the run unchanged', async () => {
    const before = (await http().get(`/workflow-runs/${runId}`).expect(200))
      .body as Record<string, unknown>;
    const from = stub.requests.length;
    const res = await chatStream(runId, 'analyse', {
      content: '  Chat: which entities did you see?  ',
    });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/event-stream');
    const frames = framesOf(res.text);
    const types = frames.map((frame) => frame.type);
    // `list_entities` sends `tool`; the engine sends no `tool-result` for it.
    expect(types).toContain('tool');
    expect(types).toContain('text');
    expect(types.at(-1)).toBe('done');
    // Only the agent turn's events, never a run's or a session's.
    expect(
      types.filter(
        (type) =>
          ![
            'reasoning',
            'text',
            'tool',
            'tool-result',
            'tool-progress',
            'done',
          ].includes(type),
      ),
    ).toEqual([]);
    const done = frames.at(-1)!.message!;
    expect(done).toMatchObject({
      role: 'assistant',
      content: CHAT_ANSWER,
      toolCalls: [{ tool: 'list_entities' }],
    });

    // The model request: dumped once, then asserted.
    const sent = stub.requests
      .slice(from)
      .filter((req) => lastUser(req).startsWith('Chat:'));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const first = sent[0];
    const dump = process.env['NODE_CHAT_REQUEST_DUMP'];
    if (dump) writeFileSync(dump, JSON.stringify(first, null, 2));
    expect(lastUser(first)).toBe('Chat: which entities did you see?');
    expect(first.tools).toEqual(
      expect.arrayContaining([
        'list_entities',
        'describe_entity',
        'run_readonly_sql',
      ]),
    );
    const block = systemTexts(first).find((text) =>
      text.includes('You are answering questions about one step'),
    );
    expect(block).toBeDefined();
    expect(block).toContain(`step "Analyse" (analyse) of run ${runId}`);
    expect(block).toContain('## Workflow input');
    expect(block).toContain(`"question": "${QUESTION}"`);
    expect(block).toContain('### Step input');
    expect(block).toContain('"entity": "world_cup.world_cup.matches"');
    expect(block).toContain('### Step output');
    expect(block).toContain('"stopped": false');
    expect(block).toContain(`## Final answer of the run\n${STUB_ANSWER}`);
    // The run's own question and answer are not replayed as messages.
    expect(
      first.messages
        .filter((message) => message.role !== 'system')
        .map((message) => messageText(message)),
    ).toEqual(['Chat: which entities did you see?']);

    const stored = (
      await http().get(`/workflow-runs/${runId}/node-chats/analyse`).expect(200)
    ).body as { messages: NodeChatMessage[] };
    expect(stored.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Chat: which entities did you see?'],
      ['assistant', CHAT_ANSWER],
    ]);
    expect(stored.messages[1]).toEqual(done);
    expect(stored.messages[0].id).toEqual(expect.any(String));
    expect(stored.messages[0].createdAt).toEqual(expect.any(String));

    const after = (await http().get(`/workflow-runs/${runId}`).expect(200))
      .body as Record<string, unknown>;
    expect(after).toEqual(before);
    // Another step's chat is its own.
    await http()
      .get(`/workflow-runs/${runId}/node-chats/load-catalog`)
      .expect(200, { messages: [] });
  });

  it.each(['plan', 'write-answer'])(
    'chats about the %s step with its agent alone, its stored data as context',
    async (stepId) => {
      const from = stub.requests.length;
      const res = await chatStream(runId, stepId, {
        content: `Chat: what did ${stepId} do?`,
      });
      expect(res.status).toBe(200);
      expect(framesOf(res.text).at(-1)?.message).toMatchObject({
        role: 'assistant',
        content: CHAT_ANSWER,
      });
      const sent = stub.requests.slice(from);
      // No Plan or Write answer call: the turn is v2's agent, not a run.
      expect(sent.some(isPlanRequest)).toBe(false);
      expect(sent.some(isWriteAnswerRequest)).toBe(false);
      const title = stepId === 'plan' ? 'Plan' : 'Write answer';
      const block = systemTexts(sent[0]).find((text) =>
        text.includes('You are answering questions about one step'),
      );
      expect(block).toContain(`step "${title}" (${stepId}) of run ${runId}`);
    },
  );

  it('replays the earlier messages on the next turn, and deleting the run deletes its chats', async () => {
    const from = stub.requests.length;
    const res = await chatStream(runId, 'analyse', {
      content: 'Chat: and then?',
    });
    expect(res.status).toBe(200);
    const first = stub.requests
      .slice(from)
      .find((req) => lastUser(req) === 'Chat: and then?')!;
    const said = first.messages
      .filter(
        (message) => message.role === 'user' || message.role === 'assistant',
      )
      .map((message) => [message.role, messageText(message)]);
    expect(said).toEqual([
      ['user', 'Chat: which entities did you see?'],
      ['assistant', CHAT_ANSWER],
      ['user', 'Chat: and then?'],
    ]);
    const stored = (
      await http().get(`/workflow-runs/${runId}/node-chats/analyse`).expect(200)
    ).body as { messages: NodeChatMessage[] };
    expect(stored.messages).toHaveLength(4);

    await http().delete(`/workflow-runs/${runId}`).expect(200);
    await http().get(`/workflow-runs/${runId}/node-chats/analyse`).expect(404);
  });
});
