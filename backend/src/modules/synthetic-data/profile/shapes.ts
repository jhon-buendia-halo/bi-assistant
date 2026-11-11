// Character-class shapes (U-PROFILE). A shape carries classes and lengths only,
// never a letter or digit of the data.
//
// Grammar (the generator parses it): a shape is a sequence of tokens.
//   A  uppercase letter     a  lowercase letter     9  digit     _  whitespace
//   ?  any other character
//   one of  - . / : @ # + , ( ) ' &  : kept literally, exactly once
// A class token is written once per character when its run length is fixed
// and at most 8 (`999`), `X{n}` when fixed and longer, `X{min,max}` otherwise.
// `{` and `}` never occur as literals, so the grammar is unambiguous.

import { compareStrings, round4 } from './stats';

const LITERALS = new Set(['-', '.', '/', ':', '@', '#', '+', ',', '(', ')', "'", '&']);

function charClass(ch: string): string {
  if (ch >= 'A' && ch <= 'Z') return 'A';
  if (ch >= 'a' && ch <= 'z') return 'a';
  if (ch >= '0' && ch <= '9') return '9';
  if (/\s/.test(ch)) return '_';
  if (LITERALS.has(ch)) return ch;
  return '?';
}

interface Run {
  cls: string;
  count: number;
}

function runsOf(value: string): Run[] {
  const runs: Run[] = [];
  for (const ch of value) {
    const cls = charClass(ch);
    const last = runs[runs.length - 1];
    if (last && last.cls === cls && !LITERALS.has(cls)) last.count++;
    else runs.push({ cls, count: 1 });
  }
  return runs;
}

function render(cls: string, min: number, max: number): string {
  if (LITERALS.has(cls)) return cls;
  if (min === max) return max <= 8 ? cls.repeat(max) : `${cls}{${max}}`;
  return `${cls}{${min},${max}}`;
}

interface Group {
  count: number;
  cls: string[];
  min: number[];
  max: number[];
}

/**
 * The shapes of `values` (non-null text), most frequent first (ties by shape
 * text), at most `limit`. Shapes seen fewer than 3 times, and the ones beyond
 * `limit`, are merged into the dominant shape's fraction, so fractions sum to 1.
 * Empty input gives [].
 */
export function buildShapes(
  values: string[],
  limit = 5,
): { shape: string; fraction: number }[] {
  if (values.length === 0) return [];
  const groups = new Map<string, Group>();
  for (const v of values) {
    const runs = runsOf(v);
    const key = runs.map((r) => r.cls).join('');
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        count: 1,
        cls: runs.map((r) => r.cls),
        min: runs.map((r) => r.count),
        max: runs.map((r) => r.count),
      });
    } else {
      g.count++;
      runs.forEach((r, i) => {
        if (r.count < g.min[i]) g.min[i] = r.count;
        if (r.count > g.max[i]) g.max[i] = r.count;
      });
    }
  }
  const all = [...groups.values()]
    .map((g) => ({
      count: g.count,
      shape: g.cls.map((c, i) => render(c, g.min[i], g.max[i])).join(''),
    }))
    .sort((a, b) => b.count - a.count || compareStrings(a.shape, b.shape));
  const kept = all.filter((s, i) => i === 0 || (s.count >= 3 && i < limit));
  const keptCount = kept.reduce((n, s) => n + s.count, 0);
  const rare = values.length - keptCount;
  return kept.map((s, i) => ({
    shape: s.shape,
    fraction: round4((s.count + (i === 0 ? rare : 0)) / values.length),
  }));
}
