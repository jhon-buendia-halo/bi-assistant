// Strategies whose values are distinct within the table: sequence, unique-range, uuid,
// unique-pattern (plan 2.4, 10).

import type { SampledColumn } from '../../types';
import { base36, formatDecimal } from '../format';
import { shuffledIndices, type Prng } from '../prng';
import { fillShape, parseShape, plainText } from './pattern';
import {
  fit,
  temporalValue,
  type ValueContext,
  type ValueSource,
} from './context';

const num = (n: number): { kind: 'number'; text: string } => ({
  kind: 'number',
  text: formatDecimal(n, 0),
});

/** `sequence`: 1..n. */
export function sequenceSource(): ValueSource {
  return (row) => num(row + 1);
}

/** The observed integer range of a unique-range column, or undefined without stats. */
export function uniqueRangeBounds(
  column: SampledColumn,
): { min: number; max: number } | undefined {
  const n = column.numeric;
  if (!n || !Number.isFinite(n.min) || !Number.isFinite(n.max))
    return undefined;
  const min = Math.ceil(n.min);
  const max = Math.floor(n.max);
  return max >= min ? { min, max } : undefined;
}

/** True when the observed range holds fewer distinct integers than `rows`. */
export function uniqueRangeFallsBack(
  column: SampledColumn,
  rows: number,
): boolean {
  const b = uniqueRangeBounds(column);
  return b === undefined || b.max - b.min + 1 < rows;
}

/**
 * `unique-range`: distinct integers drawn without replacement from [min, max]; when the
 * range holds fewer values than the rows, a sequence starting at min (header note).
 * Without numeric stats, a plain 1..n sequence.
 */
export function uniqueRangeSource(ctx: ValueContext): ValueSource {
  const b = uniqueRangeBounds(ctx.column);
  if (!b) return sequenceSource();
  const size = b.max - b.min + 1;
  if (size < ctx.rows) return (row) => num(b.min + row);
  const it = shuffledIndices(ctx.prng, size);
  return () => num(b.min + (it.next().value as number));
}

export function uuidV4(prng: Prng): string {
  const bytes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const x = prng.nextUint32();
    bytes.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidSource(ctx: ValueContext): ValueSource {
  return () => uuidV4(ctx.prng);
}

const DAY_MS = 86_400_000;
const BASE_MS = Date.UTC(2000, 0, 1);

/**
 * `unique-pattern`: the dominant shape filled from the PRNG plus a fixed-width base-36
 * counter, kept within the declared length (the counter then replaces the tail).
 * Numeric columns get digits with a decimal counter; temporal columns get distinct
 * days (date) or hours (timestamp) from 2000-01-01, since their shapes are not dates.
 */
export function uniquePatternSource(ctx: ValueContext): ValueSource {
  const { column, prng, rows } = ctx;
  if (column.semanticType === 'temporal') {
    const date = column.type.toLowerCase().trim() === 'date';
    return (row) =>
      temporalValue(
        BASE_MS + row * (date ? DAY_MS : 3_600_000),
        column,
        ctx.dialect,
        false,
      );
  }
  if (column.semanticType === 'numeric') {
    const width = String(Math.max(1, rows)).length;
    const len = Math.min(
      15,
      Math.max(width + 1, column.length?.max ?? width + 1),
    );
    return (row) => {
      let head = String(1 + prng.int(9));
      for (let k = 1; k < len - width; k++) head += String(prng.int(10));
      return {
        kind: 'number',
        text: head + String(row + 1).padStart(width, '0'),
      };
    };
  }
  const width = base36(Math.max(1, rows), 1).length;
  const tokens =
    column.patterns && column.patterns.length > 0
      ? parseShape(column.patterns[0].shape)
      : undefined;
  return (row) => {
    const body = tokens ? fillShape(prng, tokens) : plainText(prng, ctx);
    const counter = base36(row, width);
    if (ctx.maxLength === undefined || body.length + width <= ctx.maxLength)
      return body + counter;
    return fit(body, Math.max(0, ctx.maxLength - width)) + counter;
  };
}
