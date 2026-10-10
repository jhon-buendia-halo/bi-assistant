import type { ReasoningEffort } from '../../mastra/effort-levels';

// LLM provider settings, mirrored from data-readiness-agent (its Feature
// 1.5.3 / ADR-0026). OpenAI, Anthropic and LenAI (Halo's internal
// OpenAI-compatible gateway) are wired; adding another provider later is a new
// union member + a branch in the test service, not a restructure.
export type LlmProvider = 'openai' | 'anthropic' | 'lenai';

export const SUPPORTED_PROVIDERS: LlmProvider[] = [
  'openai',
  'anthropic',
  'lenai',
];

export type { ReasoningEffort };

/**
 * The efforts the composer menu and agent overrides offer. Settings → LLM
 * offers the model's own levels instead (`effortLevelsFor`).
 */
export const REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];

/**
 * Request body for save/test. `apiKey` omitted or empty = use the stored key.
 * For LenAI, `model` carries the deployment name and `baseUrl` is required.
 */
export interface SaveLlmSettingsDto {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** Saved with the connection; must be one of the model's levels. */
  reasoningEffort?: ReasoningEffort;
}

/** The effort levels a model accepts (`GET /llm/effort-levels`). */
export interface EffortLevelsView {
  levels: ReasoningEffort[];
  defaultEffort: ReasoningEffort | null;
  probeEffort: ReasoningEffort | null;
}

/** API view — the key is always masked, never returned in plaintext. */
export interface LlmSettingsView {
  provider: LlmProvider | null;
  model: string | null;
  baseUrl: string | null;
  apiKeyMasked: string | null;
  reasoningEffort: ReasoningEffort;
  configured: boolean;
  /** Set when a key is stored but the current app secret cannot decrypt it. */
  keyUnreadable?: true;
}

/** Persisted document (single row keyed 'llm'; the API key is encrypted). */
export interface LlmSettingsDoc {
  key: 'llm';
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKeyCiphertext: string;
  reasoningEffort?: ReasoningEffort;
  createdAt?: string;
  updatedAt?: string;
}
