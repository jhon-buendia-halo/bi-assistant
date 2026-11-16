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
//
// A custom endpoint (BA-281, R52) is tuned by its API style. The OpenAI style
// (`{ id: "custom/<model>", url }`) is built by Mastra as an OpenAI-compatible
// client named after the id's provider segment, so its bucket is `custom`;
// that client reads `reasoningEffort` from the bucket and serializes it as
// `reasoning_effort` (checked against @mastra/core's
// OpenAICompatibleChatLanguageModel). The Anthropic style
// (`{ kind: "custom-anthropic", id: "anthropic/<model>" }`) has no `url` and
// files under `anthropic`, exactly like the native provider.
//
// GitHub Copilot (BA-159, R60) files `reasoningEffort` under `copilot`, fitted
// to the Copilot levels, and sends no output-token cap (the runtime has no such
// option).

// Type-only: model-resolver imports the model factory (and through it the
// provider SDKs), which this plain-data module must not load.
import type { AgentModelConfig, CopilotModelConfig } from './model-resolver';
import {
  effortLevelsFor,
  effortLevelsForProvider,
  isReasoningEffort,
  nearestEffort,
  type ReasoningEffort,
} from './effort-levels';

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

/** The router id: the string itself, or the config's `id` (custom-anthropic included). */
export function modelIdOf(config: AgentModelConfig): string {
  return typeof config === 'string' ? config : config.id;
}

/**
 * True when Mastra will build an OpenAI-compatible client for this config
 * (LenAI and the OpenAI-style custom endpoint). Never true for a
 * `custom-anthropic` config, which carries a `baseUrl`, not a `url`.
 */
export function isOpenAiCompatible(config: AgentModelConfig): boolean {
  return (
    typeof config !== 'string' &&
    !('kind' in config) &&
    'url' in config &&
    !!config.url
  );
}

/** A GitHub Copilot config (kind check, no import of the resolver). */
function isCopilotConfig(
  config: AgentModelConfig,
): config is CopilotModelConfig {
  return (
    typeof config === 'object' && 'kind' in config && config.kind === 'copilot'
  );
}

/** The provider segment of a custom endpoint's OpenAI-style id. */
const CUSTOM_PROVIDER = 'custom';

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
  if (isCopilotConfig(config)) {
    const copilot = copilotBucket(modelId, bucket);
    return Object.keys(copilot).length ? { copilot } : {};
  }
  const tuned = fitEffort(modelId, bucket);
  if (key === 'anthropic') return { [key]: anthropicBucket(modelId, tuned) };
  if (key === CUSTOM_PROVIDER && isOpenAiCompatible(config)) {
    return { [key]: customOpenAiBucket(modelId, tuned) };
  }
  return { [key]: tuned };
}

/**
 * Copilot's bucket (R60): the effort fitted to the model's Copilot levels,
 * dropped when it has none (`auto`); nothing else is forwarded.
 */
function copilotBucket(
  modelId: string,
  bucket: Record<string, ProviderOptionValue>,
): Record<string, ProviderOptionValue> {
  const model = modelId.slice('copilot/'.length);
  const levels = effortLevelsForProvider('copilot', model);
  const effort = bucket.reasoningEffort;
  if (!isReasoningEffort(effort) || !levels.length) return {};
  return { reasoningEffort: nearestEffort(levels, effort) };
}

/**
 * The OpenAI-style custom endpoint (R52): the effort travels as
 * `reasoningEffort`, which the compatible client sends as `reasoning_effort`,
 * but only when the model has levels. A self-hosted server may reject the
 * unknown field, so a model without levels gets no effort at all instead of
 * the OpenAI routes' passthrough.
 */
function customOpenAiBucket(
  modelId: string,
  bucket: Record<string, ProviderOptionValue>,
): Record<string, ProviderOptionValue> {
  if (!('reasoningEffort' in bucket) || effortLevelsFor(modelId).length) {
    return bucket;
  }
  const rest = { ...bucket };
  delete rest.reasoningEffort;
  return rest;
}

/**
 * Moves `reasoningEffort` to the nearest level the model accepts, so a fixed
 * `low` still works on a model that only takes `high`. A model with no levels
 * keeps the value: the OpenAI providers drop it themselves, and the Anthropic
 * bucket below drops it explicitly.
 */
function fitEffort(
  modelId: string,
  bucket: Record<string, ProviderOptionValue>,
): Record<string, ProviderOptionValue> {
  const effort = bucket.reasoningEffort;
  const levels = effortLevelsFor(modelId);
  if (!isReasoningEffort(effort) || !levels.length) return bucket;
  return { ...bucket, reasoningEffort: nearestEffort(levels, effort) };
}

/** The only `effort` values the Anthropic provider's option schema accepts. */
const ANTHROPIC_EFFORTS: ReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * A level the Anthropic schema accepts. A GPT model served Anthropic-style by
 * a custom endpoint has `none`/`minimal` levels, which @ai-sdk/anthropic
 * rejects as invalid provider options, failing the whole call.
 */
function anthropicEffort(value: ProviderOptionValue): ProviderOptionValue {
  return isReasoningEffort(value) && !ANTHROPIC_EFFORTS.includes(value)
    ? nearestEffort(ANTHROPIC_EFFORTS, value)
    : value;
}

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
      // Models with no levels reject `effort` with a 400.
      if (effortLevelsFor(modelId).length) out.effort = anthropicEffort(value);
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

  // The Copilot runtime has no output-token option: the cap is dropped.
  const cap = isCopilotConfig(config) ? undefined : options.maxOutputTokens;
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
