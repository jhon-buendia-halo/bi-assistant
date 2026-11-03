import type { ApiStyle } from '../llm.types';
import type { AgentModelConfig } from '../../../mastra/model-resolver';

// URL normalisation and the model route per API style (unit 2, BA-283).

const todo = (what: string): never => {
  throw new Error(`${what} is not implemented yet (BA-281 scaffold)`);
};

/**
 * The URL requests are built on. OpenAI style: as given, no trailing slash
 * (the user includes /v1). Anthropic style: the root plus `/v1` (a URL
 * already ending in /v1 is kept). Throws Error(BASE_URL_INVALID) for a
 * non-http(s) URL.
 */
export function normalizeBaseUrl(style: ApiStyle, baseUrl: string): string {
  void style;
  void baseUrl;
  return todo('normalizeBaseUrl');
}

/** The model config for a saved custom endpoint (llm-settings route rules). */
export function customModelConfig(settings: {
  apiStyle: ApiStyle;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): AgentModelConfig {
  void settings;
  return todo('customModelConfig');
}

/** `scheme://host[:port]` of a base URL, for messages. */
export function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}
