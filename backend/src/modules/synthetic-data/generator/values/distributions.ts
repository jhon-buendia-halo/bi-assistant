// Strategies that follow the sampled distribution: categorical, numeric-range,
// temporal-range, boolean-rate (plan 2.4).

import { formatDecimal } from '../format';
import {
  fit,
  drawFromQuantiles,
  temporalValue,
  type ValueContext,
  type ValueSource,
} from './context';
import { patternSource } from './pattern';

/** `categorical`: topValues by fraction; with otherFraction, the `pattern` strategy. */
export function categoricalSource(ctx: ValueContext): ValueSource {
  const top = ctx.column.topValues ?? [];
  const other = patternSource(ctx);
  const hasOther =
    (ctx.column.otherFraction ?? 0) > 0 &&
    (ctx.column.patterns?.length ?? 0) > 0;
  const topTotal = top.reduce((s, t) => s + t.fraction, 0);
  const total = hasOther
    ? topTotal + (ctx.column.otherFraction ?? 0)
    : topTotal;
  return (row) => {
    if (top.length === 0) return other(row);
    let r = ctx.prng.float() * total;
    for (const t of top) {
      r -= t.fraction;
      if (r < 0) return fit(t.value, ctx.maxLength);
    }
    return hasOther
      ? other(row)
      : fit(top[top.length - 1].value, ctx.maxLength);
  };
}

/** `numeric-range`: inverse CDF over the deciles, rounded to the observed scale. */
export function numericRangeSource(ctx: ValueContext): ValueSource {
  const n = ctx.column.numeric;
  if (!n) return () => ({ kind: 'number', text: '0' });
  const scale = n.integer ? 0 : n.scale;
  const q = n.quantiles.length > 0 ? n.quantiles : [n.min, n.max];
  return () => {
    const x = Math.min(n.max, Math.max(n.min, drawFromQuantiles(ctx.prng, q)));
    return { kind: 'number', text: formatDecimal(x, scale) };
  };
}

const DAY_MS = 86_400_000;

/** `temporal-range`: the same over epoch milliseconds (UTC), at the observed granularity. */
export function temporalRangeSource(ctx: ValueContext): ValueSource {
  const t = ctx.column.temporal;
  if (!t) return () => ({ kind: 'neutral' });
  const q = (t.quantiles.length > 0 ? t.quantiles : [t.min, t.max]).map((s) =>
    Date.parse(s),
  );
  const min = Date.parse(t.min);
  const max = Date.parse(t.max);
  return () => {
    let ms = Math.min(max, Math.max(min, drawFromQuantiles(ctx.prng, q)));
    if (t.granularity === 'date') ms = Math.floor(ms / DAY_MS) * DAY_MS;
    else if (t.granularity === 'second') ms = Math.floor(ms / 1000) * 1000;
    else ms = Math.floor(ms);
    if (ms < min) ms = min;
    return temporalValue(
      ms,
      ctx.column,
      ctx.dialect,
      t.granularity === 'fraction',
    );
  };
}

/** `boolean-rate`: true with trueFraction. */
export function booleanSource(ctx: ValueContext): ValueSource {
  const p = ctx.column.boolean?.trueFraction ?? 0.5;
  return () => ctx.prng.float() < p;
}
