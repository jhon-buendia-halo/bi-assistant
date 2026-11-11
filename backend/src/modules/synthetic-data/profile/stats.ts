// Pure statistics over raw sampled text values (U-PROFILE). No clock, no randomness.

/** Round to `digits` decimals. */
export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export const round4 = (n: number): number => round(n, 4);

/** Index into a sorted array of `n` items for decile `i` (0..10): nearest rank. */
export function quantileIndex(n: number, i: number): number {
  return Math.round((i / 10) * (n - 1));
}

/** 11 quantiles (p0, p10 … p100) of an already sorted array; [] when empty. */
export function quantiles11<T>(sorted: T[]): T[] {
  if (sorted.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i <= 10; i++) out.push(sorted[quantileIndex(sorted.length, i)]);
  return out;
}

const NUMBER_RE = /^[+-]?(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/;

function cleanNumber(text: string, type: string): string {
  const t = text.trim();
  return type.toLowerCase().trim() === 'money' ? t.replace(/[$,]/g, '') : t;
}

/** Parse a raw numeric text (`money` values lose `$` and `,`). null when not a finite number. */
export function parseNumber(text: string, type: string): number | null {
  const t = cleanNumber(text, type);
  if (!NUMBER_RE.test(t) || !/\d/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Decimals written in a numeric text, trailing zeros included, exponent applied; 0..10. */
export function decimalScale(text: string, type: string): number {
  const m = NUMBER_RE.exec(cleanNumber(text, type));
  if (!m) return 0;
  const exp = m[3] ? Number(m[3]) : 0;
  return Math.min(10, Math.max(0, m[2].length - exp));
}

const TEMPORAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

export interface ParsedTemporal {
  /** Epoch milliseconds, UTC (a missing zone is read as UTC). */
  ms: number;
  dateOnly: boolean;
  /** True when the fractional seconds are not all zero. */
  fraction: boolean;
}

export function parseTemporal(text: string): ParsedTemporal | null {
  const m = TEMPORAL_RE.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, tz] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0, s ? +s : 0);
  if (Number.isNaN(ms)) return null;
  if (frac) ms += Number(`0.${frac.slice(0, 3).padEnd(3, '0')}`) * 1000;
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    const off = +digits.slice(0, 2) * 60 + (digits.length > 2 ? +digits.slice(2) : 0);
    ms -= sign * off * 60_000;
  }
  return { ms: Math.round(ms), dateOnly: h === undefined, fraction: !!frac && /[1-9]/.test(frac) };
}

export function granularityOf(
  type: string,
  parsed: ParsedTemporal[],
): 'date' | 'second' | 'fraction' {
  if (parsed.some((p) => p.fraction)) return 'fraction';
  if (type.toLowerCase().trim() === 'date' || parsed.every((p) => p.dateOnly)) return 'date';
  return 'second';
}

export function parseBoolean(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (t === 't' || t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'f' || t === 'false' || t === '0' || t === 'no') return false;
  return null;
}

/** Length (characters, code points) statistics of non-empty list of text values. */
export function lengthStats(values: string[]): {
  min: number;
  max: number;
  mean: number;
  quantiles: number[];
} {
  const lens = values.map((v) => Array.from(v).length).sort((a, b) => a - b);
  const sum = lens.reduce((a, b) => a + b, 0);
  return {
    min: lens[0],
    max: lens[lens.length - 1],
    mean: round4(sum / lens.length),
    quantiles: quantiles11(lens),
  };
}

/** Deterministic string order (UTF-16 code units), for tie-breaks. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
