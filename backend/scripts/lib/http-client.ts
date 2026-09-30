/**
 * Minimal HTTP + SSE client for `scripts/learning-demo.ts` (and any future
 * scripted end-to-end check). No new dependency: `fetch` is global in the
 * Node version this repo targets (see `LlmService` for the same pattern),
 * and the SSE framing below is parsed by hand because the server writes a
 * deliberately simple frame — `res.write(\`data: ${JSON.stringify(x)}\n\n\`)`
 * (`SessionsController.streamMessage`) — one JSON object per frame, never a
 * multi-line `data:` payload or a custom event name. Streams and POSTs go
 * through `node:http` instead (see `rawRequest`) so a slow model call is
 * never cut off by fetch's built-in 300 s timeouts.
 */
import { request as httpRequest } from 'node:http';

/** One parsed SSE frame — the server always gives it a `type` field. */
export interface SseFrame {
  type: string;
  [key: string]: unknown;
}

/**
 * Incremental SSE frame parser: feed it raw text chunks as they arrive off
 * the wire (or the whole body at once) and it hands back every complete
 * frame found so far, buffering a trailing partial frame across calls.
 */
export class SseFrameParser {
  private buffer = '';

  /** Feed a chunk of the response body; returns any complete frames it closed. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let sep = this.buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
      sep = this.buffer.indexOf('\n\n');
    }
    return frames;
  }

  /**
   * Parse whatever is left in the buffer as a final frame — a stream that
   * closes without a trailing blank line still carries one complete frame.
   */
  flush(): SseFrame[] {
    if (!this.buffer.trim()) return [];
    const frame = parseFrame(this.buffer);
    this.buffer = '';
    return frame ? [frame] : [];
  }
}

function parseFrame(raw: string): SseFrame | undefined {
  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  if (!dataLines.length) return undefined;
  try {
    return JSON.parse(dataLines.join('\n')) as SseFrame;
  } catch {
    return undefined;
  }
}

/** Parse a complete SSE body in one call — convenient for tests and logs. */
export function parseSseFrames(raw: string): SseFrame[] {
  const parser = new SseFrameParser();
  return [...parser.push(raw), ...parser.flush()];
}

/** Longest a streamed turn or a learning save may take before the demo gives up. */
const STREAM_TIMEOUT_MS = 30 * 60_000;

/**
 * One request over `node:http` with no idle timeouts — only `timeoutMs`
 * overall. `onChunk` sees the decoded body as it arrives (for SSE); the full
 * text is returned too so an error status can be reported with its body.
 */
function rawRequest(
  url: string,
  method: string,
  body: string | undefined,
  onChunk: ((chunk: string) => void) | undefined,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (chunk: string) => {
          text += chunk;
          onChunk?.(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, text });
        });
        res.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    const timer = setTimeout(
      () =>
        req.destroy(
          new Error(`${method} ${url} timed out after ${timeoutMs / 1000}s`),
        ),
      timeoutMs,
    );
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    if (body) req.write(body);
    req.end();
  });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`${method} ${path} → HTTP ${status}: ${oneLine(responseBody)}`);
  }
}

export class HttpClient {
  constructor(private readonly baseUrl: string) {}

  async getJson<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path));
    return readJson<T>(res, 'GET', path);
  }

  /**
   * POSTs go through `node:http`, not `fetch`: a feedback save runs a model
   * call, and fetch's built-in 300 s headers timeout would cut it off when
   * the provider hangs (the backend's own retry takes longer than that).
   */
  async postJson<T>(path: string, body?: unknown): Promise<T> {
    const { status, text } = await rawRequest(
      this.url(path),
      'POST',
      JSON.stringify(body ?? {}),
      undefined,
      STREAM_TIMEOUT_MS,
    );
    if (status < 200 || status >= 300) {
      throw new HttpError(status, 'POST', path, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(status, 'POST', path, `invalid JSON: ${text}`);
    }
  }

  async deleteJson<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { method: 'DELETE' });
    return readJson<T>(res, 'DELETE', path);
  }

  /**
   * POST a streamed chat turn and collect every SSE frame until the stream
   * closes (the server ends the response right after its `done` frame, or
   * after `error`). Mirrors the frontend's own consumer, just without a UI.
   *
   * Uses `node:http` rather than `fetch`: an expert turn (answer, cross-check,
   * explainer) at high reasoning effort can sit silent for minutes while the
   * provider thinks — or hangs — and fetch's built-in 300 s body timeout
   * would abort it, which aborts the turn server-side too. Only the overall
   * `timeoutMs` applies here.
   */
  async streamMessage(
    path: string,
    body: unknown,
    onEvent?: (frame: SseFrame) => void,
    timeoutMs = STREAM_TIMEOUT_MS,
  ): Promise<SseFrame[]> {
    const parser = new SseFrameParser();
    const frames: SseFrame[] = [];
    const collect = (frame: SseFrame) => {
      frames.push(frame);
      onEvent?.(frame);
    };
    const { status, text } = await rawRequest(
      this.url(path),
      'POST',
      JSON.stringify(body ?? {}),
      (chunk) => parser.push(chunk).forEach(collect),
      timeoutMs,
    );
    if (status < 200 || status >= 300) {
      throw new HttpError(status, 'POST', path, text);
    }
    parser.flush().forEach(collect);
    return frames;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

async function readJson<T>(
  res: Response,
  method: string,
  path: string,
): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, method, path, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `${method} ${path} → could not parse JSON response: ${message(err)}\n${text.slice(0, 500)}`,
    );
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
