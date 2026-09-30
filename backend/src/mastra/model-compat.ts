// Per-model request tuning. Two provider quirks live here, both discovered
// from a VDI diagnostics report (2026-09-21) where every gpt-5-class LenAI
// deployment tested green in Settings and then failed on the first real turn.
//
// 1. OpenAI renamed `max_tokens` to `max_completion_tokens` for the gpt-5 and
//    o-series families. Mastra's *native* OpenAI provider rewrites the key for
//    those models, but the OpenAI-*compatible* client it builds for a custom
//    `url` (the LenAI gateway path) does not — it always emits `max_tokens`,
//    which those deployments reject outright.
// 2. The compatible client names its provider-options bucket after the
//    provider id, so options filed under `openai` never reach a `lenai/…`
//    model. Unknown keys in the right bucket are forwarded into the request
//    body verbatim, which is what makes `max_completion_tokens` injectable.

import type { AgentModelConfig } from './model-resolver';

/**
 * Families that reject `max_tokens`: gpt-5 and later, plus the o-series.
 * Written to survive LenAI's mangled deployment names, where the dot is
 * dropped and a context size and date are appended —
 * `mmc-tech-gpt-52-272k-2025-12-11`, `mmc-tech-gpt-5-mini-272k-2025-08-07`.
 * `gpt-41`/`gpt-4o` must not match: they still take `max_tokens`.
 */
const RENAMED_MAX_TOKENS = /(?:^|[^a-z0-9])(?:gpt-?[5-9]|o[1-4])/i;

export function rejectsMaxTokens(modelId: string): boolean {
  return RENAMED_MAX_TOKENS.test(modelId);
}

/** The `providerOptions` bucket a model reads, i.e. the id's provider segment. */
export function providerOptionsKey(modelId: string): string {
  const [provider] = modelId.split('/');
  return provider || 'openai';
}

export function modelIdOf(config: AgentModelConfig): string {
  return typeof config === 'string' ? config : config.id;
}

/** True when Mastra will build an OpenAI-compatible client for this config. */
export function isOpenAiCompatible(config: AgentModelConfig): boolean {
  return typeof config !== 'string' && !!config.url;
}

/** Values the OpenAI-compatible client will serialize into the request body. */
export type ProviderOptionValue = string | number | boolean;
export type ProviderOptions = Record<
  string,
  Record<string, ProviderOptionValue>
>;

export interface ModelCallTuning {
  modelSettings: { maxOutputTokens?: number };
  providerOptions: ProviderOptions;
}

/**
 * File `bucket` under the provider key the resolved model actually reads.
 * Hardcoding `openai` silently drops the options for every `lenai/…` model,
 * which is how the user-configured reasoning effort came to be a no-op on
 * every LenAI deployment.
 */
export function providerOptionsFor(
  config: AgentModelConfig,
  bucket: Record<string, ProviderOptionValue>,
): ProviderOptions {
  const modelId = modelIdOf(config);
  const key = providerOptionsKey(modelId);
  return {
    [key]: key === 'anthropic' ? anthropicBucket(modelId, bucket) : bucket,
  };
}

/**
 * Claude models that reject `output_config.effort` with a 400: Haiku, the
 * Claude 3 line, and the Sonnet 4 / 4.5 and Opus 4 / 4.1 generation.
 */
const REJECTS_EFFORT =
  /claude-(?:haiku-|3|sonnet-4-5|sonnet-4-\d{8}|opus-4-1|opus-4-\d{8})/i;

/**
 * The Anthropic provider reads `effort`, not `reasoningEffort`, and ignores
 * OpenAI-only passthroughs such as `max_completion_tokens` — so the
 * user-configured effort would otherwise be a silent no-op on Claude.
 */
function anthropicBucket(
  modelId: string,
  bucket: Record<string, ProviderOptionValue>,
): Record<string, ProviderOptionValue> {
  const out: Record<string, ProviderOptionValue> = {};
  for (const [name, value] of Object.entries(bucket)) {
    if (name === 'reasoningEffort') {
      if (!REJECTS_EFFORT.test(modelId)) out.effort = value;
    } else if (name !== 'max_completion_tokens') {
      out[name] = value;
    }
  }
  return out;
}

/**
 * `modelSettings` + `providerOptions` for one generate call, filed under the
 * bucket the resolved model actually reads. When the model rejects
 * `max_tokens`, the cap travels as a `max_completion_tokens` passthrough
 * instead of as `maxOutputTokens` (which the compatible client would
 * serialize to the rejected key).
 */
export function modelCallTuning(
  config: AgentModelConfig,
  options: { maxOutputTokens?: number; reasoningEffort?: string },
): ModelCallTuning {
  const modelId = modelIdOf(config);
  const bucket: Record<string, ProviderOptionValue> = {};
  if (options.reasoningEffort) bucket.reasoningEffort = options.reasoningEffort;

  const cap = options.maxOutputTokens;
  // The native OpenAI provider does the rename itself; only the compatible
  // client needs the cap moved out of `modelSettings`.
  const needsRename =
    cap !== undefined &&
    isOpenAiCompatible(config) &&
    rejectsMaxTokens(modelId);
  if (needsRename) bucket.max_completion_tokens = cap;

  return {
    modelSettings:
      needsRename || cap === undefined ? {} : { maxOutputTokens: cap },
    providerOptions: Object.keys(bucket).length
      ? providerOptionsFor(config, bucket)
      : {},
  };
}
