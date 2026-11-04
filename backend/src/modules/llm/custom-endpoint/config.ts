import type { ApiStyle } from '../llm.types';
import type { AgentModelConfig } from '../../../mastra/model-resolver';
import { BASE_URL_INVALID } from './messages';

// URL normalisation and the model route per API style (BA-283; llm-settings
// R27, R44–R47; ADR-0032). Plain data only: no Mastra import, so Jest specs
// and config readers can load it.

/** An absolute http(s) URL starts with `http://` or `https://` (`http:foo` does not). */
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

/**
 * The URL requests are built on. OpenAI style: as given, no trailing slash
 * (the user includes /v1). Anthropic style: the root plus `/v1` (a URL
 * already ending in /v1 is kept). Throws Error(BASE_URL_INVALID) for a
 * non-http(s) URL.
 */
export function normalizeBaseUrl(style: ApiStyle, baseUrl: string): string {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!ABSOLUTE_HTTP_URL.test(trimmed)) {
    throw new Error(BASE_URL_INVALID);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(BASE_URL_INVALID);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    throw new Error(BASE_URL_INVALID);
  }
  const base = trimmed.replace(/\/+$/, '');
  if (style === 'anthropic' && !base.endsWith('/v1')) {
    return `${base}/v1`;
  }
  return base;
}

/**
 * The model config for a saved custom endpoint (llm-settings R27).
 *
 * OpenAI style: Mastra's router config `{ id: "custom/<model>", url, apiKey }`.
 * With a `url`, Mastra 1.66 builds `createOpenAICompatible({ baseURL: url,
 * apiKey, headers })`, and that client adds `Authorization: Bearer <key>`
 * only when the key is truthy. A keyless endpoint therefore gets `apiKey: ''`
 * (the router type requires a string) and is called with no Authorization
 * header at all (R47). No `headers` are set.
 *
 * Anthropic style: plain data `{ kind: "custom-anthropic", id:
 * "anthropic/<model>", baseUrl: <root>/v1, apiKey? }`, built into an
 * @ai-sdk/anthropic model by `buildModel` at call time (ADR-0032). The key is
 * omitted, not empty, when there is none.
 *
 * A blank (empty or whitespace-only) key counts as no key. Throws
 * Error(BASE_URL_INVALID) for a base URL that is not http(s).
 */
export function customModelConfig(settings: {
  apiStyle: ApiStyle;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): AgentModelConfig {
  const baseUrl = normalizeBaseUrl(settings.apiStyle, settings.baseUrl);
  const apiKey = settings.apiKey?.trim() ? settings.apiKey : undefined;
  if (settings.apiStyle === 'anthropic') {
    return {
      kind: 'custom-anthropic',
      id: `anthropic/${settings.model}`,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    };
  }
  return {
    id: `custom/${settings.model}`,
    url: baseUrl,
    apiKey: apiKey ?? '',
  };
}

/** `scheme://host[:port]` of a base URL, for messages. */
export function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}
