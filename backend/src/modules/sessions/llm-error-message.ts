import type { LlmProvider } from '../llm/llm.types';
import { endpointHost } from '../llm/custom-endpoint/config';
import {
  notFoundMessage,
  rejectedKeyMessage,
  unreachableMessage,
} from '../llm/custom-endpoint/messages';

// Chat-turn errors of a custom endpoint in the words of llm-settings R50
// (R51, BA-291). Plain data only: no Mastra import, so Jest can load it.

/** The saved settings this mapping needs (a subset of `LlmSettingsView`). */
export interface ChatEndpointSettings {
  provider: LlmProvider | null;
  baseUrl: string | null;
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const MAX_NODES = 32;

type Node = Record<string, unknown>;

const isObject = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null;

/** The HTTP status an error node carries (AI SDK `statusCode`, SDK `status`). */
function statusOf(node: Node): number | undefined {
  const response = isObject(node.response) ? node.response : undefined;
  for (const value of [node.statusCode, node.status, response?.status]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100) {
      return value;
    }
  }
  return undefined;
}

function isNetworkFailure(node: Node): boolean {
  if (typeof node.code === 'string' && NETWORK_CODES.has(node.code)) {
    return true;
  }
  const message = typeof node.message === 'string' ? node.message : '';
  return /fetch failed/i.test(message);
}

/** The requested URL without any credentials embedded in it. */
function requestedUrl(node: Node, fallback: string): string {
  const raw = typeof node.url === 'string' && node.url ? node.url : fallback;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Breadth-first over the error, its `cause` chain, a retry error's
 * `lastError` (before the earlier attempts) and an aggregate's `errors`.
 */
function* errorNodes(error: unknown): Generator<Node> {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length && seen.size < MAX_NODES) {
    const node = queue.shift();
    if (!isObject(node) || seen.has(node)) continue;
    seen.add(node);
    yield node;
    queue.push(node.cause, node.lastError);
    if (Array.isArray(node.errors)) queue.push(...(node.errors as unknown[]));
  }
}

/**
 * The R50 text for a failed chat turn on a custom endpoint at `baseUrl`, or
 * null when the failure is not an unreachable host, a 404 or a rejected key.
 * The first node with an HTTP status decides; otherwise any network failure.
 */
export function customEndpointErrorMessage(
  error: unknown,
  baseUrl: string,
): string | null {
  let unreachable = false;
  for (const node of errorNodes(error)) {
    const status = statusOf(node);
    if (status !== undefined) {
      if (status === 404) return notFoundMessage(requestedUrl(node, baseUrl));
      if (status === 401 || status === 403) return rejectedKeyMessage(status);
      return null;
    }
    if (isNetworkFailure(node)) unreachable = true;
  }
  return unreachable ? unreachableMessage(endpointHost(baseUrl)) : null;
}

/**
 * The error a chat turn reports (R51): for the custom provider an Error
 * carrying the matching R50 text, otherwise the original error. The
 * settings are read only on this failure path; if they can't be read the
 * original error is kept.
 */
export async function chatTurnError(
  error: unknown,
  readSettings: () => Promise<ChatEndpointSettings>,
): Promise<unknown> {
  let settings: ChatEndpointSettings;
  try {
    settings = await readSettings();
  } catch {
    return error;
  }
  if (settings?.provider !== 'custom' || !settings.baseUrl) return error;
  const message = customEndpointErrorMessage(error, settings.baseUrl);
  return message === null ? error : new Error(message, { cause: error });
}
