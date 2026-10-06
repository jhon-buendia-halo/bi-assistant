export type LlmProvider = 'openai' | 'anthropic' | 'lenai';

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

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
