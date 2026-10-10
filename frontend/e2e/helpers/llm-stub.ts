import http from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * A local OpenAI-compatible gateway standing in for the LenAI provider. It
 * answers the settings connection test with `{"status":"ok"}`, and agent
 * calls (streamed or not) with a scripted reply. Every agent call is
 * recorded, so a test can check what the backend sent to the model.
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
  /** Decides each agent call's reply; the default answers `STUB_ANSWER`. */
  reply: (request: StubRequest) => StubReply;
  close(): Promise<void>;
}

export const STUB_ANSWER = 'The stub model answered this question.';

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

/** The streamed (chat-turn) requests whose user messages include `question`. */
export function turnRequests(stub: LlmStub, question: string): StubRequest[] {
  return stub.requests.filter(
    (request) =>
      request.stream &&
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

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: 'call_stub_1',
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

export async function startLlmStub(): Promise<LlmStub> {
  const stub: LlmStub = {
    baseUrl: '',
    apiKeys: [],
    requests: [],
    reply: () => ({ text: STUB_ANSWER }),
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (data: Buffer) => chunks.push(data));
    req.on('end', () => {
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
      } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        // An unreadable body is answered like the connection test.
      }
      // The settings connection test asks for a JSON status object.
      if (body.response_format) {
        respond(res, false, { text: '{"status":"ok"}' });
        return;
      }
      const request: StubRequest = {
        path: req.url,
        stream: body.stream === true,
        messages: body.messages ?? [],
        tools: (body.tools ?? []).map((tool) => tool.function?.name ?? ''),
      };
      stub.requests.push(request);
      respond(res, request.stream, stub.reply(request));
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
