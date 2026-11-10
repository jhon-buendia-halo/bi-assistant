/*
 * A stub of the local GitHub Copilot runtime for the E2E specs (llm-settings,
 * Feature "GitHub Copilot connection"). The backend's Copilot SDK spawns it
 * in place of the real runtime when `COPILOT_CLI_PATH` points here (the SDK
 * runs a `.js` path with node and speaks Content-Length framed JSON-RPC over
 * stdio). The messages and events below mirror a recorded trace of the real
 * runtime 1.0.108; only the fields the app reads are sent.
 *
 * Behaviour, from the environment:
 *   COPILOT_STUB_LOGIN      the signed-in GitHub login; empty = not signed in
 *   COPILOT_STUB_MODELS     comma-separated model ids `models.list` returns
 *   COPILOT_STUB_ANSWER     the text a plain turn streams, word by word
 *   COPILOT_STUB_TOOL_CALL  JSON {name, arguments}: the first turn of a
 *                           session that offers that tool requests it, then
 *                           streams the answer once the result comes back
 *   COPILOT_STUB_LOG        a file that gets one JSON line per request
 *   COPILOT_STUB_DELTA_MS   the pause before each streamed word (default 40)
 *   COPILOT_STUB_TOOL_AS_TEXT  "1": the first reply of a session offering the
 *                           scripted tool is that tool's arguments written as
 *                           text; the next message in the session gets the
 *                           real tool request (llm-settings R66)
 *
 * Structured-output requests (`responseFormat`) are answered with a minimal
 * JSON value of their schema, `"ok"` for strings (so the connection test's
 * `{status: "ok"}` passes).
 */
'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const env = process.env;
const LOGIN = env.COPILOT_STUB_LOGIN ?? 'octo-dev';
const MODELS = (env.COPILOT_STUB_MODELS ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const ANSWER = env.COPILOT_STUB_ANSWER ?? 'Stub Copilot answer.';
const TOOL_CALL = env.COPILOT_STUB_TOOL_CALL
  ? JSON.parse(env.COPILOT_STUB_TOOL_CALL)
  : null;
const TOOL_AS_TEXT = env.COPILOT_STUB_TOOL_AS_TEXT === '1';
const LOG = env.COPILOT_STUB_LOG;
const DELTA_MS = Number(env.COPILOT_STUB_DELTA_MS ?? 40);

/** sessionId → { tools: string[], toolRequested: boolean } */
const sessions = new Map();
/** requestId → sessionId of a tool call waiting for its result */
const pendingTools = new Map();

function log(entry) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
}

function write(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function emit(sessionId, type, data, ephemeral = false) {
  write({
    method: 'session.event',
    params: {
      sessionId,
      event: {
        type,
        data,
        ...(ephemeral ? { ephemeral: true } : {}),
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        parentId: null,
      },
    },
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal value that satisfies a JSON schema. */
function sample(schema) {
  if (!schema || typeof schema !== 'object') return 'ok';
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if ('const' in schema) return schema.const;
  const pick = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(pick)) return sample(pick[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'object': {
      const out = {};
      for (const key of schema.required ?? []) {
        out[key] = sample(schema.properties?.[key]);
      }
      return out;
    }
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () =>
        sample(schema.items),
      );
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return 'ok';
  }
}

/** Streams `text` as message deltas, then the message and the idle event. */
async function answer(sessionId, text) {
  const messageId = randomUUID();
  emit(sessionId, 'assistant.message_start', { messageId }, true);
  for (const word of text.match(/\S+\s*/g) ?? []) {
    await delay(DELTA_MS);
    emit(sessionId, 'assistant.message_delta', { messageId, deltaContent: word }, true);
  }
  emit(sessionId, 'assistant.message', { messageId, content: text, toolRequests: [] });
  emit(sessionId, 'assistant.usage', { model: 'stub-auto', inputTokens: 12, outputTokens: 7 });
  emit(sessionId, 'assistant.turn_end', { turnId: '0' });
  emit(sessionId, 'session.idle', { mode: 'interactive' }, true);
}

async function onSend(params) {
  const { sessionId } = params;
  const state = sessions.get(sessionId) ?? { tools: [], toolRequested: false };
  await delay(DELTA_MS);
  emit(sessionId, 'assistant.turn_start', { turnId: '0' });
  const schema = params.responseFormat?.jsonSchema?.schema;
  if (schema) return answer(sessionId, JSON.stringify(sample(schema)));
  if (TOOL_CALL && !state.toolRequested && state.tools.includes(TOOL_CALL.name)) {
    if (TOOL_AS_TEXT && !state.wroteToolAsText) {
      // The model writes the tool's arguments as its message (R66).
      state.wroteToolAsText = true;
      return answer(sessionId, JSON.stringify(TOOL_CALL.arguments));
    }
    state.toolRequested = true;
    const requestId = randomUUID();
    const toolCallId = `call_${requestId.slice(0, 8)}`;
    pendingTools.set(requestId, sessionId);
    emit(sessionId, 'tool.execution_start', {
      toolCallId,
      toolName: TOOL_CALL.name,
      arguments: TOOL_CALL.arguments,
    });
    emit(sessionId, 'external_tool.requested', {
      requestId,
      sessionId,
      toolCallId,
      toolName: TOOL_CALL.name,
      arguments: TOOL_CALL.arguments,
    });
    return;
  }
  return answer(sessionId, ANSWER);
}

function handle(message) {
  const { id, method, params = {} } = message;
  if (id === undefined) return; // a notification from the SDK
  const reply = (result) => write({ id, result });
  switch (method) {
    case 'connect':
      return reply({ ok: true, protocolVersion: 3, version: '1.0.108', taskKinds: ['agent', 'shell', 'client'] });
    case 'ping':
      return reply({ message: 'pong', timestamp: Date.now(), protocolVersion: 3 });
    case 'auth.getStatus':
      return reply(
        LOGIN
          ? { isAuthenticated: true, authType: 'gh-cli', host: 'https://github.com', login: LOGIN, statusMessage: `${LOGIN} (via gh)` }
          : { isAuthenticated: false, statusMessage: 'Not logged in' },
      );
    case 'models.list':
      log({ method });
      return reply({ models: MODELS.map((m) => ({ id: m, name: m })) });
    case 'session.create': {
      const sessionId = params.sessionId ?? randomUUID();
      const tools = (params.tools ?? []).map((t) => t.name);
      sessions.set(sessionId, { tools, toolRequested: false });
      log({ method, sessionId, model: params.model ?? null, reasoningEffort: params.reasoningEffort ?? null, tools, systemMessageMode: params.systemMessage?.mode ?? null });
      return reply({ sessionId, nativeSessionId: sessionId, startTime: new Date().toISOString(), isRemote: false, mode: 'interactive', capabilities: { ui: {}, extensions: false }, modelState: {} });
    }
    case 'session.send':
      log({ method, sessionId: params.sessionId, prompt: params.prompt, structured: Boolean(params.responseFormat) });
      reply({ messageId: randomUUID() });
      void onSend(params);
      return;
    case 'session.tools.handlePendingToolCall': {
      const sessionId = pendingTools.get(params.requestId);
      pendingTools.delete(params.requestId);
      log({ method, sessionId, result: params.result });
      reply({ success: true });
      if (sessionId) {
        emit(sessionId, 'external_tool.completed', { requestId: params.requestId });
        void answer(sessionId, ANSWER);
      }
      return;
    }
    case 'session.detach':
    case 'session.abort':
    case 'session.destroy':
      log({ method, sessionId: params.sessionId });
      return reply({ success: true });
    default:
      return reply({});
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString());
    if (!match) return;
    const length = Number(match[1]);
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
    buffer = buffer.subarray(end + 4 + length);
    handle(JSON.parse(body));
  }
});
process.stdin.on('end', () => process.exit(0));
