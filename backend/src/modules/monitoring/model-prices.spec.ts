import {
  estimateCostUsd,
  findModelPrice,
  MODEL_PRICES,
  PRICES_AS_OF,
} from './model-prices';

describe('model prices', () => {
  it('are dated 2026-11-03', () => {
    expect(PRICES_AS_OF).toBe('2026-11-03');
  });

  it('match an exact model id', () => {
    expect(findModelPrice('claude-sonnet-5-5')).toBe(
      MODEL_PRICES['claude-sonnet-5-5'],
    );
    expect(findModelPrice('claude-haiku-4-5')?.contextLimit).toBe(200_000);
  });

  it('match a dated snapshot of a key', () => {
    expect(findModelPrice('claude-sonnet-4-6-20260115')).toBe(
      MODEL_PRICES['claude-sonnet-4-6'],
    );
  });

  it('let the longest key win', () => {
    expect(findModelPrice('claude-opus-5-5')).toBe(
      MODEL_PRICES['claude-opus-5-5'],
    );
    expect(findModelPrice('claude-opus-5-5-20261101')).toBe(
      MODEL_PRICES['claude-opus-5-5'],
    );
    expect(findModelPrice('claude-opus-5')).toBe(MODEL_PRICES['claude-opus-5']);
    expect(findModelPrice('claude-opus-5-20260901')).toBe(
      MODEL_PRICES['claude-opus-5'],
    );
    expect(findModelPrice('claude-fable-5-2')?.input).toBe(8);
    expect(findModelPrice('claude-fable-5')?.input).toBe(10);
  });

  it('do not match a key that is only a prefix of another word', () => {
    expect(findModelPrice('claude-opus-55')).toBeNull();
    expect(findModelPrice('claude-sonnet-5x')).toBeNull();
  });

  it('are null for an unknown or empty model', () => {
    expect(findModelPrice('gpt-9')).toBeNull();
    expect(findModelPrice('')).toBeNull();
    expect(findModelPrice(null)).toBeNull();
  });
});

describe('estimateCostUsd', () => {
  it('prices uncached input, cache reads, cache writes (1.25 x input) and output', () => {
    // The first fixture turn: claude-sonnet-5-5 at 2 / 10 / 0.10 per 1M.
    const cost = estimateCostUsd('claude-sonnet-5-5', {
      inputTokens: 61185,
      outputTokens: 2445,
      cacheReadTokens: 43532,
      cacheWriteTokens: 17645,
    });
    const expected =
      (8 * 2 + 43532 * 0.1 + 17645 * 2 * 1.25 + 2445 * 10) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
    expect(cost).toBeCloseTo(0.0729317, 7);
  });

  it('treats missing cache details as zero', () => {
    expect(
      estimateCostUsd('claude-haiku-4-5', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      }),
    ).toBeCloseTo(6, 10);
  });

  it('is null for an unknown model', () => {
    expect(
      estimateCostUsd('gpt-9', {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });

  it('is null while the usage is not known (a running call)', () => {
    expect(
      estimateCostUsd('claude-sonnet-5-5', {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      }),
    ).toBeNull();
  });
});
