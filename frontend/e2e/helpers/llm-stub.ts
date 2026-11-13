import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  JSON_TOOL,
  V2Answer,
  V2Plan,
  V2Step,
  answerFrom,
  clearPlan,
  v2StepOf,
} from './v2-steps';

/**
 * A local OpenAI-compatible gateway standing in for the LenAI provider. It
 * answers the settings connection test with `{"status":"ok"}`, and agent
 * calls (streamed or not) with a scripted reply. Every agent call is
 * recorded, so a test can check what the backend sent to the model.
 *
 * It also serves an OpenAI-style model list (`GET …/models`, the fixed list
 * in `models`) for the custom endpoint provider, and logs every request it
 * receives with its credential headers (`calls`). With `pathPrefix` set (e.g.
 * `/v1`), only paths under that prefix are served; any other path answers
 * 404, like a server reached without its version path.
 *
 * The structured calls of Questions to Insights v2 (Plan, Write answer) are
 * recognised by their instructions' first line (helpers/v2-steps.ts) and
 * answered by `plan` / `answer`, never by `reply` or `hold`; they are
 * recorded with their `step`. By default the plan is clear and the answer is
 * the last text `reply` gave (Analyse's final text), so a test that scripts
 * Analyse's answer sees it as the run's answer.
 */

export interface StubMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
}

export interface StubRequest {
  /** The request path, which carries the LenAI deployment name. */
  path: string;
  stream: boolean;
  messages: StubMessage[];
  /** The function names offered as tools. */
  tools: string[];
  /** The body's `reasoning_effort`, when one was sent. */
  reasoningEffort?: string;
  /** The body's `model`, when one was sent. */
  model?: string;
  /** A structured call of Questions to Insights v2 (Plan, Write answer); absent for any other. */
  step?: V2Step;
}

/** Any request the stub received (served or answered 404), oldest first. */
export interface StubCall {
  method: string;
  path: string;
  /** The `Authorization` header; undefined when the request had none. */
  authorization?: string;
  /** The `X-Api-Key` header; undefined when the request had none. */
  xApiKey?: string;
}

export interface LlmStubOptions {
  /** Serve only paths under this prefix (e.g. `/v1`); others answer 404. */
  pathPrefix?: string;
  /** The model ids `GET …/models` lists; the default is `STUB_MODELS`. */
  models?: string[];
}

/** A settings connection test (the probe), as the stub received it. */
export interface StubProbe {
  path: string;
  reasoningEffort?: string;
  model?: string;
}

export type StubReply =
  | { text: string }
  | { toolCall: { name: string; arguments: Record<string, unknown> } };

export interface LlmStub {
  baseUrl: string;
  /** `X-Api-Key` of every chat-completion request, oldest first. */
  apiKeys: string[];
  /** Agent calls, oldest first (the connection test is not recorded). */
  requests: StubRequest[];
  /** Connection tests, oldest first. */
  probes: StubProbe[];
  /** Every request received, served or not, oldest first. */
  calls: StubCall[];
  /** The ids `GET …/models` lists, in order (mutable). */
  models: string[];
  /** Decides each agent call's reply; the default answers `STUB_ANSWER`. */
  reply: (request: StubRequest) => StubReply;
  /**
   * Optional: a promise the stub awaits before answering `request` (the
   * request is recorded at once). Lets a test hold a turn open, e.g. to check
   * what the app shows while it still streams. Unset answers at once.
   */
  hold?: (request: StubRequest) => Promise<void> | undefined;
  /** Plan's output for a v2 run; the default is `clearPlan` of the question. */
  plan: (request: StubRequest) => V2Plan;
  /** Write answer's output; the default is `answerFrom` the last text `reply` gave. */
  answer: (request: StubRequest) => V2Answer;
  /** The last text `reply` gave a streamed call (Analyse's final text), or `STUB_ANSWER`. */
  lastText: string;
  close(): Promise<void>;
}

export const STUB_ANSWER = 'The stub model answered this question.';

/** The default model list of `GET …/models`. */
export const STUB_MODELS = ['qwen3-8b', 'llama3.1:8b'];

/** The text of a message's content, whether a string or content parts. */
export function messageText(message: StubMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) =>
        typeof part === 'object' && part && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  return '';
}

/** The system messages of a request, in order. */
export function systemTexts(request: StubRequest): string[] {
  return request.messages
    .filter((message) => message.role === 'system')
    .map(messageText);
}

/** The text of a request's last user message. */
export function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length ? messageText(users[users.length - 1]) : '';
}

/**
 * The streamed (chat-turn) requests whose user messages include `question`,
 * leaving out v2's structured Plan and Write answer calls (`step`).
 */
export function turnRequests(stub: LlmStub, question: string): StubRequest[] {
  return stub.requests.filter(
    (request) =>
      request.stream &&
      request.step === undefined &&
      request.messages.some(
        (message) =>
          message.role === 'user' && messageText(message).includes(question),
      ),
  );
}

function chunk(delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'stub',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish
      ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      : {}),
  })}\n\n`;
}

/** Real providers give every call its own id; reusing one merges them. */
let toolCallCount = 0;

function toolCall(name: string, args: Record<string, unknown>) {
  toolCallCount += 1;
  return {
    id: `call_stub_${toolCallCount}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function respond(
  res: http.ServerResponse,
  stream: boolean,
  reply: StubReply,
): void {
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    if ('text' in reply) {
      res.write(chunk({ role: 'assistant', content: reply.text }, null));
      res.write(chunk({}, 'stop'));
    } else {
      const call = toolCall(reply.toolCall.name, reply.toolCall.arguments);
      res.write(
        chunk({ role: 'assistant', tool_calls: [{ index: 0, ...call }] }, null),
      );
      res.write(chunk({}, 'tool_calls'));
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  const message =
    'text' in reply
      ? { role: 'assistant', content: reply.text }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall(reply.toolCall.name, reply.toolCall.arguments)],
        };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 0,
      model: 'stub',
      choices: [
        {
          index: 0,
          finish_reason: 'text' in reply ? 'stop' : 'tool_calls',
          message,
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

export async function startLlmStub(
  options: LlmStubOptions = {},
): Promise<LlmStub> {
  const prefix = options.pathPrefix?.replace(/\/+$/, '') ?? '';
  const stub: LlmStub = {
    baseUrl: '',
    apiKeys: [],
    requests: [],
    probes: [],
    calls: [],
    models: [...(options.models ?? STUB_MODELS)],
    reply: () => ({ text: STUB_ANSWER }),
    plan: (request) => clearPlan(lastUserText(request)),
    answer: () => answerFrom(stub.lastText),
    lastText: STUB_ANSWER,
    close: async () => undefined,
  };
  /**
   * The test's scripted reply. The text that ends a streamed (agent) turn is
   * remembered for Write answer; a one-shot call (a title, a visual) is not.
   */
  const scripted = (request: StubRequest): StubReply => {
    const reply = stub.reply(request);
    if ('text' in reply && request.stream) stub.lastText = reply.text;
    return reply;
  };
  /**
   * A structured step's reply: through the `json` tool when the call offers
   * it (and has not had its result yet), else as JSON text.
   */
  const structured = (request: StubRequest, step: V2Step): StubReply => {
    const value: Record<string, unknown> = {
      ...(step === 'plan' ? stub.plan(request) : stub.answer(request)),
    };
    const viaTool =
      request.tools.includes(JSON_TOOL) &&
      request.messages.at(-1)?.role !== 'tool';
    return viaTool
      ? { toolCall: { name: JSON_TOOL, arguments: value } }
      : { text: JSON.stringify(value) };
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (data: Buffer) => chunks.push(data));
    req.on('end', () => {
      const pathname = (req.url ?? '').split('?')[0];
      stub.calls.push({
        method: req.method ?? '',
        path: pathname,
        authorization: header(req, 'authorization'),
        xApiKey: header(req, 'x-api-key'),
      });
      if (prefix && !pathname.startsWith(`${prefix}/`)) {
        res.writeHead(404).end();
        return;
      }
      if (req.method === 'GET' && pathname.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: stub.models.map((id) => ({
              id,
              object: 'model',
              created: 0,
              owned_by: 'stub',
            })),
          }),
        );
        return;
      }
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      stub.apiKeys.push(String(req.headers['x-api-key'] ?? ''));
      let body: {
        stream?: boolean;
        messages?: StubMessage[];
        tools?: { function?: { name?: string } }[];
        response_format?: unknown;
        reasoning_effort?: string;
        model?: string;
      } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        // An unreadable body is answered like the connection test.
      }
      const messages = body.messages ?? [];
      const step = v2StepOf(
        messages
          .filter((message) => message.role === 'system')
          .map(messageText),
      );
      // The settings connection test asks for a JSON status object; v2's
      // structured steps may too, but they carry their instructions.
      if (body.response_format && step === null) {
        stub.probes.push({
          path: req.url,
          reasoningEffort: body.reasoning_effort,
          model: body.model,
        });
        respond(res, false, { text: '{"status":"ok"}' });
        return;
      }
      const request: StubRequest = {
        path: req.url,
        stream: body.stream === true,
        messages,
        tools: (body.tools ?? []).map((tool) => tool.function?.name ?? ''),
        reasoningEffort: body.reasoning_effort,
        model: body.model,
        ...(step !== null ? { step } : {}),
      };
      stub.requests.push(request);
      if (step !== null) {
        respond(res, request.stream, structured(request, step));
        return;
      }
      const held = stub.hold?.(request);
      if (held) {
        void held.then(
          () => respond(res, request.stream, scripted(request)),
          () => res.destroy(),
        );
        return;
      }
      respond(res, request.stream, scripted(request));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${port}`;
  stub.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return stub;
}
