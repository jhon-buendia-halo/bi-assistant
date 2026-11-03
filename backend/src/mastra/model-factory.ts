import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import {
  BASE_URL_INVALID,
  BASE_URL_REQUIRED,
} from '../modules/llm/custom-endpoint/messages';
// Type-only: model-resolver imports this module, so a value import would be
// circular.
import type {
  AgentModelConfig,
  CustomAnthropicModelConfig,
} from './model-resolver';

// Turns a model config into what a Mastra agent accepts (BA-284).
// Router configs pass through unchanged; an Anthropic-compatible custom
// endpoint becomes an @ai-sdk/anthropic model instance (ADR-0032), because
// Mastra's router cannot aim an Anthropic route at another base URL.

export type BuiltModel =
  Exclude<AgentModelConfig, CustomAnthropicModelConfig> | LanguageModelV3;

/** The Anthropic Messages API version every request carries (R46). */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * How a keyless endpoint gets no credential (R47). @ai-sdk/anthropic 3.x reads
 * the key with `loadApiKey`, which throws when none is given and otherwise
 * falls back to the ANTHROPIC_API_KEY env var — that would both break keyless
 * servers and leak a public key to a custom host. So a placeholder key keeps
 * the SDK off the env, and the `x-api-key` header it would produce is
 * overridden with `undefined`: the SDK merges `options.headers` over its own
 * and drops null-valued entries, so the header is never built. `keylessFetch`
 * strips any credential header that still reaches the wire.
 */
const KEYLESS_PLACEHOLDER = 'keyless';
const KEYLESS_HEADERS = {
  'x-api-key': undefined,
} as unknown as Record<string, string>;

/** Credential headers a keyless request must never carry. */
const CREDENTIAL_HEADERS = ['x-api-key', 'authorization'];

/**
 * A fetch that strips credential headers (from a `Request` input and from
 * `init`) before calling the process-wide `globalThis.fetch` — read at call
 * time, so the outbound retry wrapper (agents.md 1.6) and test fakes apply.
 */
const keylessFetch = (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  for (const name of CREDENTIAL_HEADERS) headers.delete(name);
  return globalThis.fetch(input, { ...init, headers });
};

/** The model name inside an `anthropic/<model>` route id. */
function modelName(id: CustomAnthropicModelConfig['id']): string {
  return id.slice('anthropic/'.length);
}

function buildCustomAnthropic(
  config: CustomAnthropicModelConfig,
): LanguageModelV3 {
  // Upstream validation (R44, R46) guarantees an absolute URL; an empty one
  // would make the SDK post to the relative path `/messages`.
  if (!config.baseUrl?.trim()) throw new Error(BASE_URL_REQUIRED);
  if (!/^https?:\/\//i.test(config.baseUrl)) throw new Error(BASE_URL_INVALID);
  const apiKey = config.apiKey?.trim() || undefined;
  const provider = createAnthropic({
    // Already normalised to <root>/v1; the SDK appends /messages.
    baseURL: config.baseUrl,
    apiKey: apiKey ?? KEYLESS_PLACEHOLDER,
    headers: {
      // The SDK sets this too; pinned here so an SDK upgrade cannot change it.
      'anthropic-version': ANTHROPIC_VERSION,
      ...(apiKey ? {} : KEYLESS_HEADERS),
    },
    ...(apiKey ? {} : { fetch: keylessFetch }),
  });
  return provider(modelName(config.id));
}

export async function buildModel(
  config: AgentModelConfig,
): Promise<BuiltModel> {
  // Same check as isCustomAnthropicConfig, inlined to avoid a circular value
  // import of model-resolver.
  if (typeof config === 'object' && 'kind' in config) {
    return Promise.resolve(buildCustomAnthropic(config));
  }
  return Promise.resolve(config);
}
