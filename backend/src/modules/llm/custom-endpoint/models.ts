import type { ApiStyle, ListModelsResult } from '../llm.types';
import { endpointHost } from './config';
import {
  MODELS_TIMEOUT_MESSAGE,
  MODELS_UNREADABLE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  notFoundMessage,
  otherHttpMessage,
  rejectedKeyMessage,
  unreachableMessage,
} from './messages';

// List a custom endpoint's models (unit 6, BA-287, llm-settings R48). Never throws.

/** R48: the model list stops after 15 s. */
export const MODELS_TIMEOUT_MS = 15_000;

/** The model-list URL and headers of an API style (R45, R46). */
function modelsRequest(
  apiStyle: ApiStyle,
  baseUrl: string,
  apiKey?: string,
): { url: string; headers: Record<string, string> } {
  // The base is already normalised: OpenAI `<base>`, Anthropic `<root>/v1`.
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = apiKey?.trim();
  if (apiStyle === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (key) headers['x-api-key'] = key;
  } else if (key) {
    headers['authorization'] = `Bearer ${key}`;
  }
  return { url, headers };
}

/** R50 text for a non-2xx answer; a key echoed in the body is redacted (R54). */
function httpFailure(
  status: number,
  url: string,
  body: string,
  apiKey?: string,
): string {
  if (status === 404) return notFoundMessage(url);
  if (status === 401 || status === 403) return rejectedKeyMessage(status);
  if (status === 429) return RATE_LIMITED_MESSAGE;
  const key = apiKey?.trim();
  return otherHttpMessage(
    status,
    key ? body.split(key).join('[redacted]') : body,
  );
}

/** The `data[].id` list in server order, de-duplicated; null when unreadable. */
function readModelIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of data as unknown[]) {
    const id =
      entry && typeof entry === 'object'
        ? (entry as { id?: unknown }).id
        : undefined;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function listEndpointModels(options: {
  apiStyle: ApiStyle;
  /** Already normalised (`normalizeBaseUrl`). */
  baseUrl: string;
  apiKey?: string;
}): Promise<ListModelsResult> {
  const { url, headers } = modelsRequest(
    options.apiStyle,
    options.baseUrl,
    options.apiKey,
  );
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MODELS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch {
      // Never echo the underlying error: it may carry request details (R54).
      return {
        ok: false,
        message: timedOut
          ? MODELS_TIMEOUT_MESSAGE
          : unreachableMessage(endpointHost(options.baseUrl)),
      };
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      if (timedOut) return { ok: false, message: MODELS_TIMEOUT_MESSAGE };
      // A failed status keeps its R50 text even when its body is lost.
      return response.ok
        ? { ok: false, message: MODELS_UNREADABLE_MESSAGE }
        : {
            ok: false,
            message: httpFailure(response.status, url, '', options.apiKey),
          };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: httpFailure(response.status, url, text, options.apiKey),
      };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, message: MODELS_UNREADABLE_MESSAGE };
    }
    const models = readModelIds(body);
    return models
      ? { ok: true, models }
      : { ok: false, message: MODELS_UNREADABLE_MESSAGE };
  } catch {
    return { ok: false, message: MODELS_UNREADABLE_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}
