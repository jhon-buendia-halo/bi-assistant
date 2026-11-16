import { formatDecimal, formatTimestamp, declaredMaxLength } from './format';
import { hash32, Prng, shuffledIndices } from './prng';
import { WORDS } from './words';

const draws = (p: Prng, n: number): number[] =>
  Array.from({ length: n }, () => p.nextUint32());

describe('prng', () => {
  it('hash32 is FNV-1a over UTF-8 (known vector) and order-sensitive', () => {
    // FNV-1a 32 of "a" is 0xe40c292c.
    expect(hash32('a')).toBe(0xe40c292c);
    expect(hash32('a', 'b')).not.toBe(hash32('b', 'a'));
    expect(hash32('é')).not.toBe(hash32('e'));
  });

  it('the same seed, table and column give the same stream', () => {
    expect(draws(new Prng(1, 't', 'c'), 50)).toEqual(
      draws(new Prng(1, 't', 'c'), 50),
    );
  });

  it('another seed, table or column gives another stream', () => {
    const base = draws(new Prng(1, 't', 'c'), 20);
    expect(draws(new Prng(2, 't', 'c'), 20)).not.toEqual(base);
    expect(draws(new Prng(1, 'u', 'c'), 20)).not.toEqual(base);
    expect(draws(new Prng(1, 't', 'd'), 20)).not.toEqual(base);
  });

  it('float is in [0, 1) and int(n) in [0, n), roughly uniform', () => {
    const p = new Prng(7, 'x');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) {
      const f = p.float();
      expect(f >= 0 && f < 1).toBe(true);
      buckets[p.int(10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 1000)).toBeLessThan(150);
  });

  it('shuffledIndices is a permutation of [0, n)', () => {
    const out = [...shuffledIndices(new Prng(3, 's'), 1000)];
    expect(out).toHaveLength(1000);
    expect(new Set(out).size).toBe(1000);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(999);
    expect(out.slice(0, 10)).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('format (locale-free, no exponent)', () => {
  it('formats decimals by integer arithmetic at the scale', () => {
    expect(formatDecimal(1.125, 2)).toBe('1.13');
    expect(formatDecimal(0.0000001, 2)).toBe('0.00');
    expect(formatDecimal(1e-7, 8)).toBe('0.00000010');
    expect(formatDecimal(-3.5, 1)).toBe('-3.5');
    expect(formatDecimal(-0.001, 2)).toBe('0.00');
    expect(formatDecimal(123456789012345, 0)).toBe('123456789012345');
    expect(formatDecimal(1e21, 0)).toBe('1000000000000000000000');
    expect(formatDecimal(42, 0)).toBe('42');
  });

  it('formats timestamps in UTC, with six fraction digits when asked', () => {
    const ms = Date.UTC(2024, 0, 31, 10, 5, 9, 123);
    expect(formatTimestamp(ms, false)).toBe('2024-01-31 10:05:09');
    expect(formatTimestamp(ms, true)).toBe('2024-01-31 10:05:09.123000');
  });

  it('reads a declared character length', () => {
    expect(declaredMaxLength('character(3)')).toBe(3);
    expect(declaredMaxLength('character varying(50)')).toBe(50);
    expect(declaredMaxLength('varchar(10)')).toBe(10);
    expect(declaredMaxLength('text')).toBeUndefined();
    expect(declaredMaxLength('numeric(10,2)')).toBeUndefined();
  });

  it('the built-in word list holds 200 distinct lowercase words', () => {
    expect(WORDS).toHaveLength(200);
    expect(new Set(WORDS).size).toBe(200);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/);
  });
});
