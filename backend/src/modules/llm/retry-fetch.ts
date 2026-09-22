// Retries a 429/500/502/503 from an LLM provider (backoff, honoring
// Retry-After) instead of failing an agent turn outright — the Windows
// diagnostics report that motivated this saw a rate-limited Azure/LenAI
// deployment (gpt-5.4, eastus) fail every turn with no retry at all.
//
// Wired in over the process's global `fetch` rather than through the agent
// model config: Mastra's `ModelRouterLanguageModel` (the installed
// @mastra/core) rebuilds its own OpenAI-compatible client from the
// `{id, url, apiKey, headers}` shape our model resolver returns — both the
// LenAI/custom-`url` branch and the default `openai/...` gateway branch call
// `createOpenAICompatible(...)` without ever forwarding a caller-supplied
// `fetch`, so a `fetch` field added to that config would be silently
// dropped. The AI SDK's HTTP helpers then fall back to `globalThis.fetch`
// for every request, which is the only interception point available
// without forking Mastra. `LlmService.onModuleInit` installs this once at
// process start (see llm.service.ts) — before that, every branch already
// installed there (the model resolver itself) is a no-op stub, so nothing
// downstream can race the install.
//
// Safe to retry purely on status: this only ever reads `res.status` /
// `res.headers`, never the body, so retrying before any byte of a streaming
// response has been consumed can never duplicate partial output.

export type Fetch = typeof fetch;

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const WRAPPED = Symbol('llm.retryFetch.wrapped');

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay before the next attempt: `Retry-After` (seconds or HTTP-date) when present, else the fixed backoff schedule. */
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  return BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

export interface RetryFetchOptions {
  /** Retries after the first attempt, i.e. up to `1 + maxRetries` requests total. */
  maxRetries?: number;
  /** Injectable for tests — real backoff would make a full retry sequence take ~7s. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps `fetch` (or any fetch-compatible function) so 429/500/502/503
 * responses are retried with backoff. A 2xx, any other 4xx, or a thrown
 * network error passes through on the first attempt untouched.
 */
export function createRetryFetch(
  baseFetch: Fetch,
  options: RetryFetchOptions = {},
): Fetch {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;

  const retryFetch = (async (
    input: Parameters<Fetch>[0],
    init?: Parameters<Fetch>[1],
  ) => {
    let attempt = 0;
    for (;;) {
      const res = await baseFetch(input, init);
      if (res.ok || !RETRYABLE_STATUSES.has(res.status)) return res;
      if (attempt >= maxRetries) return res;
      await sleep(retryDelayMs(res, attempt));
      attempt += 1;
    }
  }) as Fetch;

  Object.defineProperty(retryFetch, WRAPPED, { value: true });
  return retryFetch;
}

/**
 * Installs the retry wrapper over `globalThis.fetch`. Idempotent — safe to
 * call on every `LlmService` instantiation (e.g. across specs in the same
 * process) without stacking retry layers on top of each other.
 */
export function installRetryFetch(): void {
  const current = globalThis.fetch as Fetch & { [WRAPPED]?: boolean };
  if (current?.[WRAPPED]) return;
  globalThis.fetch = createRetryFetch(current.bind(globalThis));
}
