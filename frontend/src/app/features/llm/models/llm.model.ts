export type LlmProvider = 'openai' | 'anthropic' | 'lenai';

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
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
}

export interface LlmActionResult {
  ok: boolean;
  message: string;
}
