// User-facing texts for the custom endpoint provider (BA-281, llm-settings).
// FINAL: shared by the probes, the model list and the chat error mapping.

export const unreachableMessage = (host: string): string =>
  `Could not reach ${host} — check the base URL and that the server is running`;

export const notFoundMessage = (url: string): string =>
  `The endpoint answered 404 at ${url} — check the base URL (OpenAI-compatible servers usually end in /v1)`;

export const rejectedKeyMessage = (status: number): string =>
  `The endpoint rejected the API key (${status})`;

export const RATE_LIMITED_MESSAGE =
  'The endpoint is rate limiting requests (429) — try again later';

export const TIMEOUT_MESSAGE = 'LLM request timed out after 30s';

export const API_STYLE_INVALID = 'apiStyle must be one of: openai, anthropic';
export const BASE_URL_REQUIRED = 'baseUrl is required for custom';
export const BASE_URL_INVALID = 'baseUrl must be an http or https URL';

export const otherHttpMessage = (status: number, body: string): string =>
  `Provider request failed (${status}) — ${body.slice(0, 300)}`;

/** `POST /llm/models` (R48). */
export const MODELS_PROVIDER_INVALID = 'provider must be custom to load models';
export const MODELS_TIMEOUT_MESSAGE = 'Model list request timed out after 15s';
export const MODELS_UNREADABLE_MESSAGE =
  'The endpoint did not return a model list — type the model name instead';
