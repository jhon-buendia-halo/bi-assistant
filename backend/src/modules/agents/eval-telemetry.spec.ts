import {
  addUsage,
  emptyUsage,
  estimateCostUsd,
  extractUsage,
  extractUsageDeep,
  isUsageUnobserved,
  normalizeModelId,
  sumUsage,
  tallyCategories,
  type PricingTable,
  type TokenUsage,
} from './eval-telemetry';

describe('extractUsage', () => {
  it('reads the current AI-SDK shape', () => {
    expect(
      extractUsage({ usage: { inputTokens: 1200, outputTokens: 300 } }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    });
  });

  it('reads the older promptTokens/completionTokens shape', () => {
    const usage = extractUsage({
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });
    expect(usage).toMatchObject({
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      calls: 1,
    });
  });

  it('prefers totalUsage over usage, because usage may cover only the last step', () => {
    const usage = extractUsage({
      usage: { inputTokens: 10, outputTokens: 5 },
      totalUsage: { inputTokens: 900, outputTokens: 120 },
    });
    expect(usage?.inputTokens).toBe(900);
    expect(usage?.outputTokens).toBe(120);
  });

  it('carries reasoning and cached-input counts when the provider reports them', () => {
    const usage = extractUsage({
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        reasoningTokens: 40,
        cachedInputTokens: 320,
      },
    });
    expect(usage).toMatchObject({ reasoningTokens: 40, cachedInputTokens: 320 });
  });

  it('reads cached tokens out of promptTokensDetails', () => {
    const usage = extractUsage({
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        promptTokensDetails: { cachedTokens: 128 },
      },
    });
    expect(usage?.cachedInputTokens).toBe(128);
  });

  // The whole point of the undefined return: a run that reports nothing must be
  // distinguishable from a run that genuinely cost nothing, or a cost log
  // silently understates spend.
  it('returns undefined rather than a zeroed reading when nothing is reported', () => {
    expect(extractUsage(undefined)).toBeUndefined();
    expect(extractUsage({})).toBeUndefined();
    expect(extractUsage({ usage: {} })).toBeUndefined();
    expect(extractUsage({ usage: { inputTokens: 0, outputTokens: 0 } })).toBeUndefined();
  });

  it('ignores negative and non-finite counts', () => {
    expect(
      extractUsage({ usage: { inputTokens: -5, outputTokens: Number.NaN } }),
    ).toBeUndefined();
  });
});

describe('extractUsageDeep', () => {
  it('sums per-step usage when no roll-up is reported', () => {
    const usage = extractUsageDeep({
      steps: [
        { usage: { inputTokens: 100, outputTokens: 10 } },
        { usage: { inputTokens: 250, outputTokens: 30 } },
        { somethingElse: true },
      ],
    });
    expect(usage).toMatchObject({
      inputTokens: 350,
      outputTokens: 40,
      totalTokens: 390,
      calls: 2,
    });
  });

  it('prefers a top-level roll-up over walking the steps', () => {
    const usage = extractUsageDeep({
      totalUsage: { inputTokens: 999, outputTokens: 1 },
      steps: [{ usage: { inputTokens: 100, outputTokens: 10 } }],
    });
    expect(usage?.inputTokens).toBe(999);
    expect(usage?.calls).toBe(1);
  });

  it('returns undefined when neither is present', () => {
    expect(extractUsageDeep({ steps: [{}, {}] })).toBeUndefined();
  });
});

describe('addUsage / sumUsage', () => {
  const a: TokenUsage = {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    reasoningTokens: 1,
    cachedInputTokens: 4,
    calls: 1,
  };

  it('adds every field, including the call count', () => {
    expect(addUsage(a, a)).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      totalTokens: 24,
      reasoningTokens: 2,
      cachedInputTokens: 8,
      calls: 2,
    });
  });

  it('skips undefined entries without inflating the call count', () => {
    expect(sumUsage([a, undefined, a])).toMatchObject({ calls: 2, inputTokens: 20 });
    expect(sumUsage([])).toEqual(emptyUsage());
  });
});

describe('isUsageUnobserved', () => {
  it('treats a zero-call reading as unobserved', () => {
    expect(isUsageUnobserved(undefined)).toBe(true);
    expect(isUsageUnobserved(emptyUsage())).toBe(true);
    expect(isUsageUnobserved({ ...emptyUsage(), calls: 1 })).toBe(false);
  });
});

describe('normalizeModelId', () => {
  it('strips the provider prefix and lowercases', () => {
    expect(normalizeModelId('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(normalizeModelId('GPT-4o-Mini')).toBe('gpt-4o-mini');
    expect(normalizeModelId('azure/deployments/gpt-4.1-mini')).toBe('gpt-4.1-mini');
  });
});

describe('estimateCostUsd', () => {
  const pricing: PricingTable = {
    'gpt-4o-mini': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
    'gpt-cached': {
      inputPerMillionUsd: 10,
      outputPerMillionUsd: 20,
      cachedInputPerMillionUsd: 1,
    },
  };
  const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
    ...emptyUsage(),
    calls: 1,
    ...over,
  });

  it('prices input and output separately', () => {
    // 2,000,000 input at $1/M + 500,000 output at $4/M = 2 + 2 = $4
    expect(
      estimateCostUsd(
        'openai/gpt-4o-mini',
        usage({ inputTokens: 2_000_000, outputTokens: 500_000 }),
        pricing,
      ),
    ).toBeCloseTo(4, 6);
  });

  it('bills cached input at the cached rate and treats it as a subset of input', () => {
    // 1M input of which 800k cached: 200k at $10/M + 800k at $1/M = 2 + 0.8
    expect(
      estimateCostUsd(
        'gpt-cached',
        usage({ inputTokens: 1_000_000, cachedInputTokens: 800_000 }),
        pricing,
      ),
    ).toBeCloseTo(2.8, 6);
  });

  it('never lets a bogus cached count exceed the input it came from', () => {
    expect(
      estimateCostUsd(
        'gpt-cached',
        usage({ inputTokens: 1000, cachedInputTokens: 999_999 }),
        pricing,
      ),
    ).toBeCloseTo((1000 * 1) / 1_000_000, 6);
  });

  it('keeps sub-cent runs from rounding to zero', () => {
    const cost = estimateCostUsd(
      'gpt-4o-mini',
      usage({ inputTokens: 1200, outputTokens: 300 }),
      pricing,
    );
    expect(cost).toBeGreaterThan(0);
  });

  // The honest-unknown rule: an unpriced model reports nothing rather than $0.
  it('returns undefined for an unpriced model, unobserved usage, or no model', () => {
    expect(estimateCostUsd('openai/some-new-model', usage({ inputTokens: 10 }), pricing)).toBeUndefined();
    expect(estimateCostUsd('gpt-4o-mini', emptyUsage(), pricing)).toBeUndefined();
    expect(estimateCostUsd(undefined, usage({ inputTokens: 10 }), pricing)).toBeUndefined();
  });

  it('defaults to an empty table, so nothing is priced until the operator fills one in', () => {
    expect(
      estimateCostUsd('gpt-4o-mini', usage({ inputTokens: 1000 }), {}),
    ).toBeUndefined();
  });
});

describe('tallyCategories', () => {
  it('counts passes per category and ignores skipped cases', () => {
    expect(
      tallyCategories([
        { category: 'ratio-trap', verdict: 'PASS' },
        { category: 'ratio-trap', verdict: 'FAIL' },
        { category: 'ties', verdict: 'PASS' },
        { category: 'ties', verdict: 'SKIP' },
        { category: 'ratio-trap', verdict: 'ERROR' },
      ]),
    ).toEqual({
      'ratio-trap': { total: 3, passed: 1 },
      ties: { total: 1, passed: 1 },
    });
  });

  it('buckets uncategorised cases rather than dropping them', () => {
    expect(tallyCategories([{ verdict: 'PASS' }])).toEqual({
      uncategorised: { total: 1, passed: 1 },
    });
  });
});
