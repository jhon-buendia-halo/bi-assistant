import { HindsightClient } from '@vectorize-io/hindsight-client';

/**
 * Hindsight, the learning-memory server (ADR-0013), seen from the backend:
 * where it is, how to build the official TypeScript client, and the deadline
 * helper every call on a user's path goes through.
 *
 * Configured by environment only — `HINDSIGHT_URL` (e.g.
 * `http://127.0.0.1:8888`) and an optional `HINDSIGHT_API_KEY`. Read at call
 * time, not import time, so a test or the CLI can set them first. Unset, the
 * memory module falls back to a no-op store and nothing here is ever called.
 */

/** Nest token for the shared client; `null` when `HINDSIGHT_URL` is unset. */
export const HINDSIGHT_CLIENT = Symbol('HINDSIGHT_CLIENT');

/** User agent the server logs our calls under. */
const USER_AGENT = 'questions-to-insights-backend';

/** The configured server URL without a trailing slash, or undefined. */
export function hindsightUrl(): string | undefined {
  const url = process.env.HINDSIGHT_URL?.trim().replace(/\/+$/, '');
  return url || undefined;
}

/** Whether a Hindsight server is configured at all. */
export function isConfigured(): boolean {
  return hindsightUrl() !== undefined;
}

/** The client for the configured server, or `null` when none is. */
export function buildHindsightClient(): HindsightClient | null {
  const baseUrl = hindsightUrl();
  if (!baseUrl) return null;
  const apiKey = process.env.HINDSIGHT_API_KEY?.trim();
  return new HindsightClient({
    baseUrl,
    userAgent: USER_AGENT,
    ...(apiKey ? { apiKey } : {}),
  });
}

/** Thrown by `withTimeout` when the deadline passes first. */
export class MemoryTimeoutError extends Error {
  constructor(ms: number) {
    super(`Hindsight did not answer within ${ms} ms`);
    this.name = 'MemoryTimeoutError';
  }
}

/**
 * Run `call` with a deadline. The signal handed to `call` aborts when the
 * deadline passes, so the HTTP request is cancelled rather than left running
 * behind a turn that has moved on; the returned promise rejects with
 * `MemoryTimeoutError` either way.
 */
export async function withTimeout<T>(
  ms: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MemoryTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
