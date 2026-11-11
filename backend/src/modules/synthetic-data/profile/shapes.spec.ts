import { buildShapes } from './shapes';
import { decimalScale, granularityOf, parseNumber, parseTemporal, quantiles11 } from './stats';

describe('buildShapes', () => {
  it('maps classes and keeps allowed punctuation literally', () => {
    expect(buildShapes(['123-45-6789', '987-65-4321', '555-12-3456'])).toEqual([
      { shape: '999-99-9999', fraction: 1 },
    ]);
  });

  it('compresses runs to class{min,max} across values sharing a run sequence', () => {
    const s = buildShapes(['Ann Lee', 'Roberto Quintana', 'Bo Wu']);
    expect(s).toEqual([{ shape: 'Aa{1,6}_Aa{1,7}', fraction: 1 }]);
  });

  it('turns any other character into ? and never carries data characters', () => {
    const shapes = buildShapes(['Zoë~Ünal', 'Ana~Ibe']);
    const joined = shapes.map((s) => s.shape).join('');
    expect(joined).toMatch(/^[Aa9_?{},\d\-./:@#+()'&]+$/);
    expect(joined).not.toMatch(/[B-Zb-z]/);
    expect(joined).toContain('?');
  });

  it('keeps the top 5 and merges shapes seen fewer than 3 times into the dominant one', () => {
    const values = [
      ...Array(10).fill('AB12'),
      ...Array(4).fill('x-1'),
      'a', // seen once -> merged
      'b1', // seen once -> merged
    ];
    const s = buildShapes(values);
    expect(s.map((x) => x.shape)).toEqual(['AA99', 'a-9']);
    expect(s[0].fraction).toBeCloseTo(12 / 16, 4);
    expect(s[1].fraction).toBeCloseTo(4 / 16, 4);
    expect(s.reduce((n, x) => n + x.fraction, 0)).toBeCloseTo(1, 3);
  });

  it('limits to five shapes', () => {
    const values: string[] = [];
    for (let k = 1; k <= 7; k++) values.push(...Array(3 + (7 - k)).fill('a' + '-'.repeat(k)));
    expect(buildShapes(values)).toHaveLength(5);
  });

  it('is empty for no values', () => {
    expect(buildShapes([])).toEqual([]);
  });

  it('writes long fixed runs as X{n}', () => {
    expect(buildShapes(['a'.repeat(12)])).toEqual([{ shape: 'a{12}', fraction: 1 }]);
  });
});

describe('stats', () => {
  it('computes 11 nearest-rank quantiles', () => {
    expect(quantiles11([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(quantiles11([])).toEqual([]);
    expect(quantiles11([7])).toHaveLength(11);
  });

  it('reads the decimal scale as written, capped at 10', () => {
    expect(decimalScale('12.50', 'numeric')).toBe(2);
    expect(decimalScale('12', 'integer')).toBe(0);
    expect(decimalScale('1.2e-3', 'double precision')).toBe(4);
    expect(decimalScale('0.123456789012', 'numeric')).toBe(10);
  });

  it('parses money and rejects non-numbers', () => {
    expect(parseNumber('$1,234.50', 'money')).toBe(1234.5);
    expect(parseNumber('abc', 'numeric')).toBeNull();
    expect(parseNumber('NaN', 'double precision')).toBeNull();
  });

  it('parses dates and timestamps to UTC and picks the granularity', () => {
    const d = parseTemporal('2020-03-04')!;
    const t = parseTemporal('2020-03-04 10:00:00+02')!;
    const f = parseTemporal('2020-03-04 10:00:00.250000')!;
    expect(new Date(d.ms).toISOString()).toBe('2020-03-04T00:00:00.000Z');
    expect(new Date(t.ms).toISOString()).toBe('2020-03-04T08:00:00.000Z');
    expect(granularityOf('date', [d])).toBe('date');
    expect(granularityOf('timestamp', [d, d])).toBe('date');
    expect(granularityOf('timestamp', [t])).toBe('second');
    expect(granularityOf('timestamp', [t, f])).toBe('fraction');
    expect(parseTemporal('not a date')).toBeNull();
  });
});
