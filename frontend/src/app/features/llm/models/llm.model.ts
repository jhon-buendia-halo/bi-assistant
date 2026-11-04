export type LlmProvider = 'openai' | 'anthropic' | 'lenai' | 'custom';

/** Which API a custom endpoint speaks (BA-281). */
export type ApiStyle = 'openai' | 'anthropic';

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
  /** Required when `provider` is 'custom'. */
  apiStyle?: ApiStyle;
}

/** Lowest first; each model accepts its own subset. */
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/** `GET /llm/effort-levels` — the levels one model accepts. */
export interface EffortLevelsView {
  levels: ReasoningEffort[];
  defaultEffort: ReasoningEffort | null;
  probeEffort: ReasoningEffort | null;
}

export interface LlmSettingsView {
  provider: LlmProvider | null;
  model: string | null;
  baseUrl: string | null;
  apiKeyMasked: string | null;
  reasoningEffort: ReasoningEffort;
  configured: boolean;
  /** A key is stored but the backend's app secret cannot decrypt it. */
  keyUnreadable?: true;
  /** The custom endpoint's API style; null for other providers. */
  apiStyle?: ApiStyle | null;
}

/** `POST /llm/models` body (api.md 32b). */
export interface ListModelsRequest {
  provider: 'custom';
  apiStyle: ApiStyle;
  baseUrl: string;
  apiKey?: string;
}

/** `POST /llm/models` answer (Style A). */
export type ListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; message: string };

export interface LlmActionResult {
  ok: boolean;
  message: string;
}
