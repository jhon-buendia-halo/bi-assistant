import type { SyntheticValue } from '../../dialects/writer';
import type { SampledColumn, SyntheticDialect } from '../../types';
import { formatDate, formatTimestamp } from '../format';
import type { Prng } from '../prng';

export interface ValueContext {
  column: SampledColumn;
  dialect: SyntheticDialect;
  /** Rows the table will hold. */
  rows: number;
  /** The column's own stream. */
  prng: Prng;
  /** Declared character length (`char(3)`), when the type has one. */
  maxLength?: number;
}

/** Called once per row, in row order (0-based). */
export type ValueSource = (row: number) => SyntheticValue;

/** A draw from the 11 deciles (p0 … p100): a uniform decile bucket, uniform inside it. */
export function drawFromQuantiles(prng: Prng, q: number[]): number {
  if (q.length === 0) return 0;
  if (q.length === 1) return q[0];
  const buckets = q.length - 1;
  const b = prng.int(buckets);
  const lo = q[b];
  const hi = q[b + 1];
  return lo + prng.float() * (hi - lo);
}

/** The value of a temporal column at `ms`: a DATE for date columns, else a TIMESTAMP. */
export function temporalValue(
  ms: number,
  column: SampledColumn,
  dialect: SyntheticDialect,
  fraction: boolean,
): SyntheticValue {
  const type = column.type.toLowerCase().trim();
  if (type === 'date') return { kind: 'date', text: formatDate(ms) };
  const zoned =
    /with time zone|timestamptz/.test(type) ||
    (dialect === 'databricks' && type === 'timestamp');
  return {
    kind: 'timestamp',
    text: formatTimestamp(ms, fraction) + (zoned ? '+00:00' : ''),
    zoned,
  };
}

/** Cut text to the declared length. */
export const fit = (text: string, maxLength?: number): string =>
  maxLength !== undefined && text.length > maxLength
    ? text.slice(0, maxLength)
    : text;
