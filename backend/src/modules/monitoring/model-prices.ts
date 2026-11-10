/**
 * Model prices in USD per 1M tokens, as of 2026-11-03. Cache writes cost
 * 1.25 x the input price. A model id matches a key when it equals the key or
 * starts with the key followed by `-` (a dated snapshot); the longest key
 * wins, so `claude-opus-5-5` is priced before `claude-opus-5`.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** The model's context window, in tokens. */
  contextLimit: number;
}

export const PRICES_AS_OF = '2026-11-03';

export const CACHE_WRITE_MULTIPLIER = 1.25;

const MILLION = 1_000_000;

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-2': {
    input: 8,
    output: 40,
    cacheRead: 0.2,
    contextLimit: 1_000_000,
  },
  'claude-fable-5-1': {
    input: 10,
    output: 50,
    cacheRead: 1,
    contextLimit: 1_000_000,
  },
  'claude-fable-5': {
    input: 10,
    output: 50,
    cacheRead: 1,
    contextLimit: 1_000_000,
  },
  'claude-opus-5-5': {
    input: 4,
    output: 20,
    cacheRead: 0.2,
    contextLimit: 1_000_000,
  },
  'claude-opus-5': {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    contextLimit: 1_000_000,
  },
  'claude-opus-4-8': {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    contextLimit: 1_000_000,
  },
  'claude-opus-4-7': {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    contextLimit: 1_000_000,
  },
  'claude-opus-4-6': {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    contextLimit: 1_000_000,
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheRead: 0.1,
    contextLimit: 1_000_000,
  },
  'claude-sonnet-5': {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    contextLimit: 1_000_000,
  },
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    contextLimit: 1_000_000,
  },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    contextLimit: 1_000_000,
  },
  'claude-haiku-4-5': {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    contextLimit: 200_000,
  },
};

/** The price of a model id, or null when no key matches it. */
export function findModelPrice(
  model: string | null | undefined,
): ModelPrice | null {
  if (!model) return null;
  let best: string | null = null;
  for (const key of Object.keys(MODEL_PRICES)) {
    const matches = model === key || model.startsWith(`${key}-`);
    if (matches && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? null : MODEL_PRICES[best];
}

export interface CallUsage {
  /** Includes the cache-read and cache-write tokens. */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

/**
 * The call's cost in USD: uncached input at the input price, cache reads at
 * the cache-read price, cache writes at 1.25 x input, output at the output
 * price. Null when the model has no price or the usage is not known.
 */
export function estimateCostUsd(
  model: string | null | undefined,
  usage: CallUsage,
): number | null {
  const price = findModelPrice(model);
  if (!price || usage.inputTokens === null || usage.outputTokens === null) {
    return null;
  }
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const micro =
    uncached * price.input +
    cacheRead * price.cacheRead +
    cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
    usage.outputTokens * price.output;
  return micro / MILLION;
}
