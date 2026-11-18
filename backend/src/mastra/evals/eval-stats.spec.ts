import {
  formatPercentRange,
  formatPointsRange,
  newcombeDiff95,
  wilson95,
} from './eval-stats';

describe('wilson95 (agents-evals R212)', () => {
  it('matches the 9/10 anchor: 0.596 to 0.982', () => {
    const interval = wilson95(9, 10);
    expect(interval?.low).toBeCloseTo(0.5958, 4);
    expect(interval?.high).toBeCloseTo(0.9821, 4);
  });

  it('has a low of exactly 0 at no pass and a high of exactly 1 at all passing', () => {
    expect(wilson95(0, 5)?.low).toBe(0);
    expect(wilson95(0, 5)?.high).toBeCloseTo(0.4345, 4);
    expect(wilson95(5, 5)?.high).toBe(1);
    expect(wilson95(5, 5)?.low).toBeCloseTo(0.5655, 4);
  });

  it('is symmetric: k of n mirrors n - k of n', () => {
    const a = wilson95(3, 11)!;
    const b = wilson95(8, 11)!;
    expect(a.low).toBeCloseTo(1 - b.high, 12);
    expect(a.high).toBeCloseTo(1 - b.low, 12);
  });

  it('is undefined with no trial', () => {
    expect(wilson95(0, 0)).toBeUndefined();
  });

  it('refuses counts that are not a proportion', () => {
    expect(() => wilson95(6, 5)).toThrow(RangeError);
    expect(() => wilson95(-1, 5)).toThrow(RangeError);
    expect(() => wilson95(1.5, 5)).toThrow(RangeError);
  });
});

describe('newcombeDiff95 (agents-evals R225)', () => {
  it("matches Newcombe's example: 56/70 after 48/80 is +0.200, 0.0524 to 0.3339", () => {
    const interval = newcombeDiff95(
      { passes: 48, trials: 80 },
      { passes: 56, trials: 70 },
    );
    expect(interval?.low).toBeCloseTo(0.0524, 4);
    expect(interval?.high).toBeCloseTo(0.3339, 4);
  });

  it('is the mirror image when before and after swap', () => {
    const up = newcombeDiff95(
      { passes: 48, trials: 80 },
      { passes: 56, trials: 70 },
    )!;
    const down = newcombeDiff95(
      { passes: 56, trials: 70 },
      { passes: 48, trials: 80 },
    )!;
    expect(down.low).toBeCloseTo(-up.high, 12);
    expect(down.high).toBeCloseTo(-up.low, 12);
  });

  it('contains 0 when nothing changed', () => {
    const interval = newcombeDiff95(
      { passes: 7, trials: 10 },
      { passes: 7, trials: 10 },
    )!;
    expect(interval.low).toBeLessThan(0);
    expect(interval.high).toBeGreaterThan(0);
  });

  it('is wide on ten questions: one flip in ten is not a change', () => {
    const interval = newcombeDiff95(
      { passes: 6, trials: 10 },
      { passes: 7, trials: 10 },
    )!;
    expect(interval.low).toBeLessThan(0);
  });

  it('stays defined at 0 and at every trial passing', () => {
    const interval = newcombeDiff95(
      { passes: 0, trials: 10 },
      { passes: 10, trials: 10 },
    )!;
    expect(interval.low).toBeGreaterThan(0);
    expect(interval.high).toBeLessThanOrEqual(1);
  });

  it('is undefined when either side has no trial', () => {
    expect(
      newcombeDiff95({ passes: 0, trials: 0 }, { passes: 3, trials: 5 }),
    ).toBeUndefined();
    expect(
      newcombeDiff95({ passes: 3, trials: 5 }, { passes: 0, trials: 0 }),
    ).toBeUndefined();
  });
});

describe('formatPercentRange', () => {
  it('prints whole percents joined by an en dash', () => {
    expect(formatPercentRange(wilson95(9, 10))).toBe('60–98%');
    expect(formatPercentRange({ low: 0.5555, high: 0.9249 })).toBe('56–92%');
    expect(formatPercentRange(wilson95(0, 5))).toBe('0–43%');
  });

  it('prints a dash for no interval', () => {
    expect(formatPercentRange(undefined)).toBe('—');
    expect(formatPercentRange(wilson95(0, 0))).toBe('—');
  });
});

describe('formatPointsRange', () => {
  it('prints signed whole points', () => {
    expect(
      formatPointsRange(
        newcombeDiff95({ passes: 48, trials: 80 }, { passes: 56, trials: 70 }),
      ),
    ).toBe('+5 to +33 pts');
    expect(formatPointsRange({ low: -0.124, high: 0.3 })).toBe(
      '−12 to +30 pts',
    );
    expect(formatPointsRange({ low: -0.004, high: 0.2 })).toBe('0 to +20 pts');
  });

  it('prints a dash for no interval', () => {
    expect(formatPointsRange(undefined)).toBe('—');
  });
});
