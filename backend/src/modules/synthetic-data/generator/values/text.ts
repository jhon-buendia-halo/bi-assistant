// Text strategies that never reuse sampled text: format-template and words (plan 2.4).

import { formatDate } from '../format';
import { WORDS } from '../words';
import { classChar } from './pattern';
import {
  drawFromQuantiles,
  fit,
  type ValueContext,
  type ValueSource,
} from './context';
import { uuidV4 } from './unique';

const digits = (ctx: ValueContext, n: number): string => {
  let s = '';
  for (let k = 0; k < n; k++) s += classChar(ctx.prng, '9');
  return s;
};

const DATE_MIN = Date.UTC(2000, 0, 1);
const DATE_DAYS = 11_323; // 2000-01-01 … 2030-12-31

/**
 * `format-template`: reserved example domains and numbers, never sampled text.
 * The date-string range is fixed (2000-01-01 … 2030-12-31): the profile keeps no
 * values for formatted columns.
 */
export function formatTemplateSource(ctx: ValueContext): ValueSource {
  const rule = ctx.column.formatRule;
  return (row) => {
    let v: string;
    switch (rule) {
      case 'email':
        v = `user${row + 1}@example.com`;
        break;
      case 'phone':
        v = `+1-555-01${digits(ctx, 2)}-${digits(ctx, 4)}`;
        break;
      case 'url': {
        let path = '';
        for (let k = 0; k < 8; k++) path += classChar(ctx.prng, 'a');
        v = `https://example.com/${path}`;
        break;
      }
      case 'uuid':
        v = uuidV4(ctx.prng);
        break;
      case 'date-string':
        v = formatDate(DATE_MIN + ctx.prng.int(DATE_DAYS) * 86_400_000);
        break;
      default:
        v = `value${row + 1}`;
    }
    return fit(v, ctx.maxLength);
  };
}

/** `words`: a length from the length deciles, filled with built-in words and cut to it. */
export function wordsSource(ctx: ValueContext): ValueSource {
  const q = ctx.column.length?.quantiles ?? [];
  return () => {
    const target = Math.max(
      1,
      Math.round(q.length > 0 ? drawFromQuantiles(ctx.prng, q) : 60),
    );
    let out = '';
    while (out.length < target)
      out += (out ? ' ' : '') + WORDS[ctx.prng.int(WORDS.length)];
    out = out.slice(0, target);
    if (out.endsWith(' ')) out = `${out.slice(0, -1)}s`;
    return fit(out, ctx.maxLength);
  };
}
