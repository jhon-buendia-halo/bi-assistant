import {
  isShortRead,
  limitMethod,
  retryPercent,
  samplePercent,
  withSamplingSessions,
} from './sampling';

describe('sampling helpers', () => {
  it('samplePercent follows the plan formula with four decimals, capped at 100', () => {
    expect(samplePercent(1000, 348_950)).toBe(0.4299);
    expect(samplePercent(1000, 29_999_795)).toBe(0.0051);
    expect(samplePercent(1000, 5_999_989_709)).toBe(0.0001);
    expect(samplePercent(1000, 1001)).toBe(100);
    expect(samplePercent(1000, 0)).toBe(100);
  });

  it('isShortRead is true under half of min(sampleSize, estimate)', () => {
    expect(isShortRead(499, 1000, 5000)).toBe(true);
    expect(isShortRead(500, 1000, 5000)).toBe(false);
    expect(isShortRead(100, 1000, 150)).toBe(false);
  });

  it('retryPercent is p x 4, capped at 100', () => {
    expect(retryPercent(0.0051)).toBe(0.0204);
    expect(retryPercent(40)).toBe(100);
  });

  it('limitMethod labels a short LIMIT read full', () => {
    expect(limitMethod(49, 1000)).toBe('full');
    expect(limitMethod(1000, 1000)).toBe('limit');
  });

  it('withSamplingSessions forwards the scope from withSessions', async () => {
    const scoped = { sampleTable: jest.fn() };
    const profiler = {
      withSessions: jest.fn(
        (
          _c: unknown,
          _s: unknown,
          _sig: unknown,
          fn: (s: typeof scoped) => unknown,
        ) => fn(scoped),
      ),
    };
    const signal = new AbortController().signal;
    const out = await withSamplingSessions(
      profiler as never,
      {},
      3,
      signal,
      (s) => Promise.resolve(s === (scoped as unknown)),
    );
    expect(out).toBe(true);
    expect(profiler.withSessions).toHaveBeenCalledWith(
      {},
      3,
      signal,
      expect.any(Function),
    );
  });
});
