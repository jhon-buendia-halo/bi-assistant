import {
  NOT_MEASURED_LABEL,
  NOT_PRICED_LABEL,
  TokenUsage,
  categoryRateClass,
  evalCostState,
  formatRate,
  formatTokenCount,
  formatTokensCompact,
  isUsageMeasured,
  sortedCategoryRates,
} from './eval.model';

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 30_000,
    outputTokens: 11_200,
    totalTokens: 41_200,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    calls: 12,
    ...overrides,
  };
}

describe('eval token formatting', () => {
  it('groups exact counts with thousands separators', () => {
    expect(formatTokenCount(41_231)).toBe('41,231');
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('compacts large counts for the run card header', () => {
    expect(formatTokensCompact(41_231)).toBe('41.2k');
    expect(formatTokensCompact(1_240_000)).toBe('1.24M');
  });

  it('leaves counts below a thousand exact', () => {
    expect(formatTokensCompact(842)).toBe('842');
  });
});

describe('eval usage measurement', () => {
  it('treats an absent usage record as unmeasured', () => {
    expect(isUsageMeasured(undefined)).toBe(false);
  });

  it('treats zero model calls as unmeasured, not as free', () => {
    expect(isUsageMeasured(usage({ calls: 0 }))).toBe(false);
  });

  it('treats a reported call as measured', () => {
    expect(isUsageMeasured(usage({ calls: 1 }))).toBe(true);
  });
});

describe('evalCostState', () => {
  it('says "not measured" when the provider reported nothing', () => {
    expect(evalCostState(undefined, undefined)).toEqual({
      kind: 'not-measured',
      label: NOT_MEASURED_LABEL,
    });
    expect(evalCostState(usage({ calls: 0 }), undefined).kind).toBe(
      'not-measured',
    );
  });

  it('never reports a cost for an unmeasured run, even if one arrives', () => {
    // A cost without any observed call cannot be trusted; tokens win.
    expect(evalCostState(usage({ calls: 0 }), 1.23).label).toBe(
      NOT_MEASURED_LABEL,
    );
  });

  it('says "not priced" when tokens are known but the model has no rate', () => {
    expect(evalCostState(usage(), undefined)).toEqual({
      kind: 'not-priced',
      label: NOT_PRICED_LABEL,
    });
  });

  it('never renders an absent cost as $0.00', () => {
    expect(evalCostState(usage(), undefined).label).not.toContain('$0.00');
  });

  it('formats a known cost as USD', () => {
    expect(evalCostState(usage(), 1.5).label).toBe('$1.50');
  });

  it('widens sub-cent costs rather than rounding them to $0.00', () => {
    expect(evalCostState(usage(), 0.0023).label).toBe('$0.0023');
  });

  it('reports a genuine zero cost as $0.00', () => {
    expect(evalCostState(usage(), 0)).toEqual({
      kind: 'priced',
      label: '$0.00',
    });
  });
});

describe('sortedCategoryRates', () => {
  it('returns nothing when no tallies were recorded', () => {
    expect(sortedCategoryRates(undefined)).toEqual([]);
  });

  it('orders the worst pass rate first', () => {
    const rates = sortedCategoryRates({
      ties: { total: 4, passed: 4 },
      'value-vocabulary': { total: 4, passed: 1 },
      ambiguity: { total: 4, passed: 2 },
    });
    expect(rates.map((r) => r.category)).toEqual([
      'value-vocabulary',
      'ambiguity',
      'ties',
    ]);
    expect(rates[0].rate).toBeCloseTo(0.25);
  });

  it('breaks a tie on rate by the larger category, then by name', () => {
    const rates = sortedCategoryRates({
      beta: { total: 2, passed: 0 },
      alpha: { total: 2, passed: 0 },
      gamma: { total: 8, passed: 0 },
    });
    expect(rates.map((r) => r.category)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('treats an empty category as a zero rate instead of dividing by zero', () => {
    const [only] = sortedCategoryRates({ empty: { total: 0, passed: 0 } });
    expect(only.rate).toBe(0);
  });
});

describe('category rate presentation', () => {
  it('renders rates as whole percentages', () => {
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(1)).toBe('100%');
  });

  it('greens only a clean sweep, reds below half, ambers in between', () => {
    expect(categoryRateClass(1)).toBe('text-emerald-400');
    expect(categoryRateClass(0.99)).toBe('text-amber-400');
    expect(categoryRateClass(0.5)).toBe('text-amber-400');
    expect(categoryRateClass(0.49)).toBe('text-red-400');
    expect(categoryRateClass(0)).toBe('text-red-400');
  });
});
