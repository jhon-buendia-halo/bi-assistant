/**
 * The guarded model call of a workflow step (workflows R43; agents.md 1.6).
 * Mastra's own model retry is 0 for this app and a call has no deadline of
 * its own, so a hung or reset call would hold or fail the run. Every single
 * model call a step makes goes through `guardedCall`: a deadline per try on
 * a signal combined with the run's, the run's Stop passed through at once,
 * and one retry of a transient failure (a network error with no HTTP
 * status, or 408) or of a reply cut at the output cap. The statuses the
 * fetch wrapper retries (`retry-fetch.ts`) are not retried again. A
 * streamed agent turn gets an idle deadline instead (`streamIdleWatch`): no
 * chunk for five minutes while no tool call executes. No framework import:
 * the specs load it directly.
 */

/** How long one try of a single model call may take. */
export const MODEL_CALL_DEADLINE_MS = 5 * 60_000;
/** How long a call whose output cap is `LONG_OUTPUT_TOKENS` or more may take. */
export const LONG_MODEL_CALL_DEADLINE_MS = 10 * 60_000;
/** The output cap from which a call gets the long deadline. */
export const LONG_OUTPUT_TOKENS = 16_000;
/** How long a streamed agent turn may send nothing while no tool executes. */
export const STREAM_IDLE_DEADLINE_MS = 5 * 60_000;
/** The wait before the one retry; a Stop ends it at once. */
export const MODEL_RETRY_DELAY_MS = 2_000;

/** The deadline of a call with this output cap. */
export function deadlineFor(maxOutputTokens: number | undefined): number {
  return (maxOutputTokens ?? 0) >= LONG_OUTPUT_TOKENS
    ? LONG_MODEL_CALL_DEADLINE_MS
    : MODEL_CALL_DEADLINE_MS;
}

/** A span in words: whole minutes, else seconds. */
function spanOf(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = Math.round(ms / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/** A model call passed its deadline; never retried, never read as a Stop. */
export class ModelTimeoutError extends Error {
  constructor(label: string, ms: number, idle = false) {
    super(
      `${label} failed: the model ${idle ? 'sent nothing for' : 'did not answer within'} ${spanOf(ms)}. The model may be busy or rate limited: run again later.`,
    );
    this.name = 'ModelTimeoutError';
  }
}

/** A reply cut at the output cap (finish reason `length`) that is read as JSON. */
export class ReplyCutError extends Error {
  constructor(label: string, maxOutputTokens?: number) {
    super(
      `${label} failed: the model's reply was cut at its output limit${maxOutputTokens ? ` (${maxOutputTokens} tokens)` : ''} and could not be read. Run again, or choose a model with a larger output limit.`,
    );
    this.name = 'ReplyCutError';
  }
}

/** Whether a reply was cut at the output cap: finish reason `length` only. */
export function cutReply(finishReason: unknown): boolean {
  return finishReason === 'length';
}

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null;

/** The error, its `cause` chain, a retry error's `lastError` and an aggregate's `errors`. */
function* errorNodes(error: unknown): Generator<Node> {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length && seen.size < 32) {
    const node = queue.shift();
    if (!isNode(node) || seen.has(node)) continue;
    seen.add(node);
    yield node;
    queue.push(node.cause, node.lastError);
    if (Array.isArray(node.errors)) queue.push(...(node.errors as unknown[]));
  }
}

/** The HTTP status a node carries (AI SDK `statusCode`, SDK `status`). */
function statusOf(node: Node): number | undefined {
  const response = isNode(node.response) ? node.response : undefined;
  for (const value of [node.statusCode, node.status, response?.status]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100) {
      return value;
    }
  }
  return undefined;
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const NETWORK_MESSAGE =
  /fetch failed|\bterminated\b|socket hang up|other side closed|\bsocket\b|ECONNRESET|network error/i;

/**
 * Whether a model call's failure is worth one more try: a network error
 * with no HTTP status (a reset, `terminated`, `fetch failed`, a socket
 * error) or status 408. Any other status decides against it, the ones the
 * fetch wrapper already retried included; a timeout, a cut reply and an
 * abort are never transient.
 */
export function isTransientModelError(error: unknown): boolean {
  let network = false;
  for (const node of errorNodes(error)) {
    if (node instanceof ModelTimeoutError || node instanceof ReplyCutError) {
      return false;
    }
    if (node.name === 'AbortError' || node.name === 'TimeoutError') {
      return false;
    }
    const status = statusOf(node);
    if (status !== undefined) return status === 408;
    const code = typeof node.code === 'string' ? node.code : '';
    const message = typeof node.message === 'string' ? node.message : '';
    if (NETWORK_CODES.has(code) || NETWORK_MESSAGE.test(message)) {
      network = true;
    }
  }
  return network;
}

/**
 * Runs `call` with a signal that aborts when `parent` does (the run is
 * stopped) or after `ms`. Past `ms` it rejects with `onTimeout()` at once,
 * and also when the call resolves after the abort (a stopped model call
 * resolves rather than throws) while `parent` is not aborted: a deadline
 * never reads as a Stop. A Stop settles as the call does.
 */
export async function withDeadline<T>(
  parent: AbortSignal | undefined,
  ms: number,
  call: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => Error,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let expire: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    expire = () => reject(onTimeout());
  });
  // Only ever awaited in the race below.
  expired.catch(() => undefined);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    expire?.();
  }, ms);
  const stop = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', stop, { once: true });
  try {
    const result = await Promise.race([call(controller.signal), expired]);
    if (timedOut && !parent?.aborted) throw onTimeout();
    return result;
  } catch (error) {
    if (timedOut && !parent?.aborted) throw onTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', stop);
  }
}

/** What a guarded call reads of a step's model options. */
export interface GuardedOptions {
  /** The run's own signal: a Stop. */
  abortSignal?: AbortSignal;
  /** One line per retry, shown as a reasoning line of the running step. */
  onRetry?: (line: string) => void;
}

/** How one step's call is guarded. */
export interface CallGuard {
  /** The step's title, as the errors and the retry line name it. */
  label: string;
  /** The deadline of each try; `MODEL_CALL_DEADLINE_MS` when absent. */
  deadlineMs?: number;
  /** The error a timeout rejects with; a `ModelTimeoutError` when absent. */
  timeoutError?: () => Error;
  /** Whether a retry may go ahead now (Write answer: nothing shown yet). */
  canRetry?: () => boolean;
  /** The wait before the retry; `MODEL_RETRY_DELAY_MS` when absent. */
  retryDelayMs?: number;
}

/** Waits `ms`, or less when `signal` aborts first. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** The retry's line: the step, why and the wait. */
function retryLine(label: string, error: unknown, ms: number): string {
  const why =
    error instanceof ReplyCutError
      ? 'the reply was cut at the output limit'
      : `the model call failed (${error instanceof Error ? error.message : String(error)})`;
  return `${label}: ${why}. Trying once more in ${spanOf(ms)}.`;
}

/**
 * One step's model call, guarded (workflows R43). Each try runs `attempt`
 * with the step's options and a signal combined from the run's and the
 * try's deadline. A timeout rejects (`ModelTimeoutError` or the guard's own
 * error) and is not retried. A cut reply (`ReplyCutError`, thrown by the
 * attempt) or a transient failure is retried once, after a wait a Stop ends
 * at once, when `canRetry` allows; the retry sends the same request and
 * reports one line through `options.onRetry`. A failure while the run is
 * stopped, and a second failure, are thrown as they are.
 */
export async function guardedCall<O extends GuardedOptions, T>(
  options: O,
  guard: CallGuard,
  attempt: (options: O) => Promise<T>,
): Promise<T> {
  const run = options.abortSignal;
  const ms = guard.deadlineMs ?? MODEL_CALL_DEADLINE_MS;
  const timeout =
    guard.timeoutError ?? (() => new ModelTimeoutError(guard.label, ms));
  const delay = guard.retryDelayMs ?? MODEL_RETRY_DELAY_MS;
  for (let tries = 1; ; tries += 1) {
    try {
      return await withDeadline(
        run,
        ms,
        (signal) => attempt({ ...options, abortSignal: signal }),
        timeout,
      );
    } catch (error) {
      const retryable =
        error instanceof ReplyCutError || isTransientModelError(error);
      if (run?.aborted || tries > 1 || !retryable) throw error;
      if (guard.canRetry && !guard.canRetry()) throw error;
      options.onRetry?.(retryLine(guard.label, error, delay));
      await pause(delay, run);
      if (run?.aborted) throw error;
    }
  }
}

/** A streamed agent turn under its idle deadline. */
export interface StreamIdleWatch {
  /** The stream's signal: the parent's, or the deadline's. */
  readonly signal: AbortSignal;
  /** The stream with its `fullStream` watched; every other part as it is. */
  watch<S extends { fullStream: AsyncIterable<unknown> }>(stream: S): S;
  /** Whether the deadline fired while the parent was not aborted. */
  timedOut(): boolean;
  /** Throws `ModelTimeoutError` naming `label` when `timedOut()`. */
  check(label: string): void;
  /** Clears the deadline and the parent's listener. */
  dispose(): void;
}

/**
 * The idle deadline of a streamed agent turn (Analyse, the one-step Answer,
 * Explain report; workflows R43): when no chunk comes for `ms` while no tool
 * call of the turn executes (between its `tool-call` and its `tool-result`
 * or `tool-error`), the stream's signal aborts and the watched stream ends;
 * `check` then fails the step with `ModelTimeoutError`. The parent's abort
 * (a Stop, or a clarifying question's attempt stop) ends the stream too and
 * is never a timeout. No total cap and no retry: a long analysis on a slow
 * warehouse keeps going while it streams.
 */
export function streamIdleWatch(
  parent: AbortSignal | undefined,
  ms = STREAM_IDLE_DEADLINE_MS,
): StreamIdleWatch {
  const controller = new AbortController();
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const running = new Set<unknown>();
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (running.size || controller.signal.aborted) return;
    timer = setTimeout(() => {
      fired = true;
      controller.abort();
    }, ms);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    controller.abort();
  };
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', stop, { once: true });
  arm();
  const note = (chunk: unknown) => {
    const { type, payload } = (chunk ?? {}) as {
      type?: unknown;
      payload?: { toolCallId?: unknown };
    };
    const id = payload?.toolCallId ?? type;
    if (type === 'tool-call') running.add(id);
    else if (type === 'tool-result' || type === 'tool-error') {
      running.delete(id);
    }
    arm();
  };
  const ended = new Promise<'ended'>((resolve) => {
    if (controller.signal.aborted) resolve('ended');
    else {
      controller.signal.addEventListener('abort', () => resolve('ended'), {
        once: true,
      });
    }
  });
  async function* watched(
    source: AsyncIterable<unknown>,
  ): AsyncGenerator<unknown> {
    const iterator = source[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = iterator.next();
        // A chunk that comes after the stream ended is dropped unread.
        next.catch(() => undefined);
        const step = await Promise.race([next, ended]);
        if (step === 'ended' || step.done) return;
        note(step.value);
        yield step.value;
      }
    } finally {
      Promise.resolve(iterator.return?.()).catch(() => undefined);
    }
  }
  const timedOut = () => fired && !parent?.aborted;
  return {
    signal: controller.signal,
    watch: (stream) => {
      const fullStream = watched(stream.fullStream);
      return new Proxy(stream, {
        get(target, key) {
          if (key === 'fullStream') return fullStream;
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function'
            ? ((value as (...args: unknown[]) => unknown).bind(
                target,
              ) as unknown)
            : value;
        },
      });
    },
    timedOut,
    check: (label) => {
      if (timedOut()) throw new ModelTimeoutError(label, ms, true);
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      parent?.removeEventListener('abort', stop);
    },
  };
}
