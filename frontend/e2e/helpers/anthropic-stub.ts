import http from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * A local Anthropic-compatible model server standing in for a custom endpoint
 * with the Anthropic API style (llm-settings R44-R54, ADR-0032). It serves:
 *
 * - `POST …/v1/messages`, streamed (SSE) or not, answering agent calls with a
 *   scripted text or tool calls (`tool_use` blocks, streamed as
 *   `input_json_delta`);
 * - the settings connection test (the probe), answered `{"status":"ok"}` in
 *   whichever structured-output form `@ai-sdk/anthropic` asked for: native
 *   `output_config.format` (answered as text) or the forced `json` tool
 *   (answered as a `json` tool call);
 * - `GET …/v1/models`, answering `{ data: [{ id, … }] }` from `setModels`.
 *
 * Every request is recorded with its lower-cased headers, so a test can check
 * the `x-api-key` / `authorization` / `anthropic-version` the backend sent.
 */

export interface RecordedAnthropicRequest {
  /** The request path, query string included. */
  path: string;
  /** Request headers, names lower-cased, repeated values joined with `, `. */
  headers: Record<string, string>;
  /** The parsed JSON body; `null` for a GET or an unreadable body. */
  body: any;
  /** True for the connection test (a structured-output request). */
  isProbe: boolean;
}

export type AnthropicStubReply =
  string | { toolCalls: { name: string; input: unknown }[] };

export interface AnthropicStub {
  /** The server root, e.g. `http://127.0.0.1:PORT` (no `/v1`). */
  baseUrl: string;
  /** Every request received (messages, probes and model lists), oldest first. */
  requests: RecordedAnthropicRequest[];
  /**
   * Sets the reply of every following agent call (not the probe). Also clears
   * a `respondWith` override. Default: `ANTHROPIC_STUB_ANSWER`.
   */
  reply(r: AnthropicStubReply): void;
  /**
   * Answers every following request (messages, probes and model lists) with
   * this status, headers and body (JSON-encoded unless a string), until
   * `reply` or `setModels` is called.
   */
  respondWith(
    status: number,
    headers?: Record<string, string>,
    body?: unknown,
  ): void;
  /** Sets the ids `GET /v1/models` lists; also clears a `respondWith` override. */
  setModels(ids: string[]): void;
  close(): Promise<void>;
}

export const ANTHROPIC_STUB_ANSWER =
  'The Anthropic stub answered this question.';

const DEFAULT_MODELS = ['claude-stub-large', 'claude-stub-small'];

const PROBE_ANSWER = { status: 'ok' };

interface Override {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

/** Real servers give every tool call its own id; reusing one merges them. */
let toolUseCount = 0;

function toolUse(name: string, input: unknown): ContentBlock {
  toolUseCount += 1;
  return { type: 'tool_use', id: `toolu_stub_${toolUseCount}`, name, input };
}

function lowerCaseHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Which structured-output form a messages request uses, if any. */
function probeForm(body: any): 'outputFormat' | 'jsonTool' | null {
  if (body?.output_config?.format) return 'outputFormat';
  const forcedJson =
    body?.tool_choice?.type === 'tool' && body.tool_choice.name === 'json';
  const offersJson =
    Array.isArray(body?.tools) &&
    body.tools.some((tool: { name?: string }) => tool?.name === 'json');
  return forcedJson || offersJson ? 'jsonTool' : null;
}

function contentFor(reply: AnthropicStubReply): ContentBlock[] {
  if (typeof reply === 'string') return [{ type: 'text', text: reply }];
  return reply.toolCalls.map((call) => toolUse(call.name, call.input));
}

function sse(res: http.ServerResponse, data: Record<string, unknown>): void {
  res.write(
    `event: ${String(data['type'])}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function respondMessage(
  res: http.ServerResponse,
  stream: boolean,
  model: string,
  content: ContentBlock[],
): void {
  const stopReason = content.some((block) => block.type === 'tool_use')
    ? 'tool_use'
    : 'end_turn';
  const message = {
    id: 'msg_stub',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });
  sse(res, {
    type: 'message_start',
    message: {
      ...message,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  });
  content.forEach((block, index) => {
    if (block.type === 'text') {
      sse(res, {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      sse(res, {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      });
    } else {
      sse(res, {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: {},
        },
      });
      sse(res, {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(block.input ?? {}),
        },
      });
    }
    sse(res, { type: 'content_block_stop', index });
  });
  sse(res, {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  sse(res, { type: 'message_stop' });
  res.end();
}

function respondOverride(res: http.ServerResponse, override: Override): void {
  const hasBody = override.body !== undefined;
  const text = !hasBody
    ? ''
    : typeof override.body === 'string'
      ? override.body
      : JSON.stringify(override.body);
  const headers: Record<string, string> = { ...override.headers };
  const hasType = Object.keys(headers).some(
    (name) => name.toLowerCase() === 'content-type',
  );
  if (hasBody && !hasType) {
    headers['Content-Type'] =
      typeof override.body === 'string' ? 'text/plain' : 'application/json';
  }
  res.writeHead(override.status, headers);
  res.end(text);
}

export async function startAnthropicStub(): Promise<AnthropicStub> {
  let nextReply: AnthropicStubReply = ANTHROPIC_STUB_ANSWER;
  let models = [...DEFAULT_MODELS];
  let override: Override | null = null;

  const stub: AnthropicStub = {
    baseUrl: '',
    requests: [],
    reply: (r) => {
      nextReply = r;
      override = null;
    },
    respondWith: (status, headers, body) => {
      override = { status, headers: headers ?? {}, body };
    },
    setModels: (ids) => {
      models = [...ids];
      override = null;
    },
    close: async () => undefined,
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (data: Buffer) => chunks.push(data));
    req.on('end', () => {
      const path = req.url ?? '/';
      const route = path.split('?')[0].replace(/\/+$/, '');
      const isMessages =
        req.method === 'POST' && route.endsWith('/v1/messages');
      const isModels = req.method === 'GET' && route.endsWith('/v1/models');
      if (!isMessages && !isModels) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'not_found_error', message: 'Not found' },
          }),
        );
        return;
      }
      let body: any = null;
      if (isMessages) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        } catch {
          body = null;
        }
      }
      const form = isMessages ? probeForm(body) : null;
      stub.requests.push({
        path,
        headers: lowerCaseHeaders(req.headers),
        body,
        isProbe: form !== null,
      });
      if (override) {
        respondOverride(res, override);
        return;
      }
      if (isModels) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: models.map((id) => ({
              type: 'model',
              id,
              display_name: id,
              created_at: '2026-01-01T00:00:00Z',
            })),
            has_more: false,
            first_id: models[0] ?? null,
            last_id: models[models.length - 1] ?? null,
          }),
        );
        return;
      }
      const stream = body?.stream === true;
      const model = typeof body?.model === 'string' ? body.model : 'stub';
      const content: ContentBlock[] =
        form === 'jsonTool'
          ? [toolUse('json', PROBE_ANSWER)]
          : form === 'outputFormat'
            ? [{ type: 'text', text: JSON.stringify(PROBE_ANSWER) }]
            : contentFor(nextReply);
      respondMessage(res, stream, model, content);
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
