// `pattern`: a character-class shape picked by frequency and filled from the PRNG
// (plan 2.4). Shape grammar: profile/shapes.ts. Shapes carry no data characters.

import type { Prng } from '../prng';
import { fit, type ValueContext, type ValueSource } from './context';

export interface ShapeToken {
  cls: string;
  min: number;
  max: number;
}

const CLASSES = new Set(['A', 'a', '9', '_', '?']);

export function parseShape(shape: string): ShapeToken[] {
  const tokens: ShapeToken[] = [];
  for (let i = 0; i < shape.length; i++) {
    const cls = shape[i];
    if (CLASSES.has(cls) && shape[i + 1] === '{') {
      const end = shape.indexOf('}', i);
      const [a, b] = shape
        .slice(i + 2, end)
        .split(',')
        .map((x) => Number(x));
      tokens.push({ cls, min: a, max: b === undefined ? a : b });
      i = end;
    } else {
      tokens.push({ cls, min: 1, max: 1 });
    }
  }
  return tokens;
}

export function classChar(prng: Prng, cls: string): string {
  switch (cls) {
    case 'A':
      return String.fromCharCode(65 + prng.int(26));
    case 'a':
      return String.fromCharCode(97 + prng.int(26));
    case '9':
      return String.fromCharCode(48 + prng.int(10));
    case '_':
      return ' ';
    case '?':
      return 'x';
    default:
      return cls;
  }
}

export function fillShape(prng: Prng, tokens: ShapeToken[]): string {
  let out = '';
  for (const t of tokens) {
    const n = t.min + prng.int(t.max - t.min + 1);
    for (let k = 0; k < n; k++) out += classChar(prng, t.cls);
  }
  return out;
}

/** Pick a shape by its fraction (fractions sum to about 1). */
export function pickShape(
  prng: Prng,
  shapes: { tokens: ShapeToken[]; fraction: number }[],
): ShapeToken[] {
  const total = shapes.reduce((s, x) => s + x.fraction, 0);
  let r = prng.float() * total;
  for (const s of shapes) {
    r -= s.fraction;
    if (r < 0) return s.tokens;
  }
  return shapes[shapes.length - 1].tokens;
}

/** Lowercase letters of a length drawn from the length quantiles (8 without stats). */
export function plainText(prng: Prng, ctx: ValueContext): string {
  const q = ctx.column.length?.quantiles;
  const len =
    q && q.length > 0 ? Math.max(1, Math.round(q[prng.int(q.length)])) : 8;
  let out = '';
  for (let k = 0; k < len; k++) out += classChar(prng, 'a');
  return out;
}

export function patternSource(ctx: ValueContext): ValueSource {
  const shapes = (ctx.column.patterns ?? []).map((p) => ({
    tokens: parseShape(p.shape),
    fraction: p.fraction,
  }));
  const { prng } = ctx;
  return () =>
    fit(
      shapes.length > 0
        ? fillShape(prng, pickShape(prng, shapes))
        : plainText(prng, ctx),
      ctx.maxLength,
    );
}
