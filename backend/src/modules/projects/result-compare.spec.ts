import { compareResults, normalizeValue, rowKey } from './result-compare';

describe('normalizeValue', () => {
  it('collapses connector-specific typings of the same number', () => {
    expect(normalizeValue('1204')).toBe(normalizeValue(1204));
    expect(normalizeValue(' 12.5 ')).toBe(normalizeValue(12.5));
    expect(normalizeValue(BigInt(7))).toBe(normalizeValue(7));
  });

  it('rounds to six significant digits', () => {
    expect(normalizeValue(0.1 + 0.2)).toBe(normalizeValue(0.3));
    expect(normalizeValue(1.23456789)).toBe('1.23457');
  });

  it('folds case and whitespace in text', () => {
    expect(normalizeValue('  Denied   Claim ')).toBe('denied claim');
  });

  it('gives null and undefined one shared marker', () => {
    expect(normalizeValue(null)).toBe('∅');
    expect(normalizeValue(undefined)).toBe('∅');
  });

  it('renders dates and booleans canonically', () => {
    expect(normalizeValue(new Date('2026-01-01T00:00:00.000Z'))).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(normalizeValue(false)).toBe('false');
  });
});

describe('rowKey', () => {
  it('ignores column names and column order', () => {
    expect(rowKey({ a: 1, b: 'x' })).toBe(rowKey({ label: 'X', total: '1' }));
  });
});

describe('compareResults', () => {
  it('matches the same rows in a different order', () => {
    const result = compareResults([{ n: 1 }, { n: 2 }], [{ n: 2 }, { n: '1' }]);
    expect(result).toEqual({ match: true, reason: '' });
  });

  it('matches two empty result sets', () => {
    expect(compareResults([], []).match).toBe(true);
  });

  it('counts duplicates — it is a multiset, not a set', () => {
    const result = compareResults([{ n: 1 }, { n: 1 }], [{ n: 1 }]);
    expect(result.match).toBe(false);
    expect(result.reason).toContain('2 expected rows vs 1 returned');
    expect(result.reason).toContain('missing');
  });

  it('rejects a different column count outright', () => {
    const result = compareResults([{ n: 1 }], [{ n: 1, extra: 'x' }]);
    expect(result.match).toBe(false);
    expect(result.reason).toBe('column count differs (expected 1, got 2)');
  });

  it('reports missing and unexpected rows', () => {
    const result = compareResults([{ n: 1 }], [{ n: 2 }]);
    expect(result.match).toBe(false);
    expect(result.reason).toContain('missing [1]');
    expect(result.reason).toContain('unexpected [2]');
  });

  it('previews at most two differing rows', () => {
    const result = compareResults([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], []);
    expect(result.reason).toContain('(+2 more)');
  });
});
