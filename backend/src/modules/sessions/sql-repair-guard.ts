import type { SqlRepairKind } from './turn-result';
import {
  AGGREGATE_FUNCTIONS,
  DATE_PARTS,
  tokenizeSql,
  type SqlToken,
} from './sql-precheck';

/**
 * WS0 0.11 `repairIntentGuard`: a deterministic diff of the SQL the
 * assistant wrote against what the `sql-fixer` repaired it into, so a repair
 * that silently changed the *question* (a filter, an aggregate, a join, a
 * literal) is flagged instead of passed off as the assistant's own answer.
 *
 * The fixer never sees the question (engineering plan §9.7, "split brain"):
 * handed `column "amount" does not exist`, it can just as well drop the
 * filter that mentioned it as rename the column. The first is a different
 * question with a confident answer, so it must not look like the second.
 *
 * The diff is over token *multisets* per class, not over text: reformatting,
 * re-casing and re-quoting are noise; which literals, operators, aggregates
 * and clause keywords the statement contains is the question it asks. No
 * parser (see `sql-precheck.ts` for why) — order-only changes (`a > b` →
 * `b > a`) are out of reach, which is acceptable for repairs that fix an
 * execution error.
 */
export interface RepairClassification {
  kind: SqlRepairKind;
  /** What changed, named plainly (e.g. `'filter value: 2023 → 2024'`, `'aggregate function: SUM → AVG'`). */
  changed: string[];
  /** Set when the repair likely changed what the query answers, not just how it is written. */
  warning?: string;
}

/** The `warning` a semantic repair carries — tools and the run log match on it. */
export const SEMANTIC_REPAIR_WARNING =
  'the repaired query changed the question — verify before answering';

type TokenClass =
  | 'literal'
  | 'comparison'
  | 'aggregate'
  | 'structure'
  | 'arithmetic'
  | 'identifier'
  | 'function'
  | 'keyword'
  | 'punct';

/** Classes whose change means a different question. */
const SEMANTIC_CLASSES: TokenClass[] = [
  'literal',
  'comparison',
  'aggregate',
  'structure',
  'arithmetic',
];

const CLASS_LABELS: Record<TokenClass, string> = {
  literal: 'filter value',
  comparison: 'comparison operator',
  aggregate: 'aggregate function',
  structure: 'query structure',
  arithmetic: 'arithmetic operator',
  identifier: 'identifier',
  function: 'function',
  keyword: 'keyword',
  punct: 'punctuation',
};

/** A whitespace-separated word list as a set — keeps long vocabularies readable. */
function words(list: string): Set<string> {
  return new Set(list.trim().split(/\s+/));
}

const COMPARISONS = new Set([
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '<=>',
  '~',
  '!~',
  '~*',
  '!~*',
]);
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '^', '||']);

/**
 * Keywords that shape which rows and groups the query answers over: joins,
 * filters, grouping, set operations, ordering direction, CASE branches.
 * Casts, `AS`, `DATE '…'` typed literals and `NULLS LAST` are syntax.
 */
const STRUCTURE_KEYWORDS = words(`
  select from where group by having order limit offset fetch with recursive
  join inner left right full outer cross natural lateral on using union
  intersect except minus all distinct and or not in is null like ilike rlike
  regexp similar between exists any some case when then else end over
  partition window qualify filter within asc desc top rollup cube grouping
  sets
`);

interface ClassedToken {
  cls: TokenClass;
  value: string;
  /** How to name it in `changed`. */
  display: string;
}

function classify(tokens: SqlToken[]): ClassedToken[] {
  return tokens.map((token, index) => {
    const next = tokens[index + 1];
    const prev = tokens[index - 1];
    const call = !!next && next.kind === 'punct' && next.value === '(';
    switch (token.kind) {
      case 'string':
        // `date_part('year', d)` ↔ `EXTRACT(YEAR FROM d)` is a dialect fix,
        // not a new filter value.
        if (DATE_PARTS.has(token.value.toLowerCase())) {
          return {
            cls: 'keyword',
            value: token.value.toLowerCase(),
            display: token.value.toUpperCase(),
          };
        }
        return {
          cls: 'literal',
          value: `'${token.value}'`,
          display: `'${token.value}'`,
        };
      case 'number':
        return { cls: 'literal', value: token.value, display: token.value };
      case 'keyword':
        if (token.value === 'true' || token.value === 'false') {
          return {
            cls: 'literal',
            value: token.value,
            display: token.value.toUpperCase(),
          };
        }
        // The FROM of `EXTRACT(YEAR FROM d)` is argument syntax, not a clause.
        if (
          token.value === 'from' &&
          prev?.kind === 'keyword' &&
          DATE_PARTS.has(prev.value)
        ) {
          return { cls: 'keyword', value: token.value, display: 'FROM' };
        }
        if (call && !STRUCTURE_KEYWORDS.has(token.value)) {
          return {
            cls: 'function',
            value: token.value,
            display: token.value.toUpperCase(),
          };
        }
        return STRUCTURE_KEYWORDS.has(token.value)
          ? {
              cls: 'structure',
              value: token.value,
              display: token.value.toUpperCase(),
            }
          : {
              cls: 'keyword',
              value: token.value,
              display: token.value.toUpperCase(),
            };
      case 'identifier':
        // `x::numeric` — a type name, i.e. a cast: syntax.
        if (prev && prev.kind === 'operator' && prev.value === '::') {
          return { cls: 'keyword', value: token.value, display: token.value };
        }
        if (call && !token.quoted) {
          return AGGREGATE_FUNCTIONS.has(token.value)
            ? {
                cls: 'aggregate',
                value: token.value,
                display: token.value.toUpperCase(),
              }
            : { cls: 'function', value: token.value, display: token.value };
        }
        return {
          cls: 'identifier',
          value: token.value,
          display: token.text.replace(/^["`]|["`]$/g, ''),
        };
      case 'operator':
        if (COMPARISONS.has(token.value)) {
          return {
            cls: 'comparison',
            value: token.value,
            display: token.value,
          };
        }
        // `COUNT(*)` / `SELECT *` / `t.*` are projections, not multiplication.
        if (
          token.value === '*' &&
          (!prev ||
            (prev.kind === 'punct' &&
              (prev.value === '(' ||
                prev.value === ',' ||
                prev.value === '.')) ||
            (prev.kind === 'keyword' &&
              (prev.value === 'select' ||
                prev.value === 'distinct' ||
                prev.value === 'all')))
        ) {
          return { cls: 'punct', value: '*', display: '*' };
        }
        if (ARITHMETIC.has(token.value)) {
          return {
            cls: 'arithmetic',
            value: token.value,
            display: token.value,
          };
        }
        return { cls: 'punct', value: token.value, display: token.value };
      default:
        return { cls: 'punct', value: token.value, display: token.value };
    }
  });
}

function counts(
  tokens: ClassedToken[],
): Map<string, { token: ClassedToken; n: number }> {
  const map = new Map<string, { token: ClassedToken; n: number }>();
  for (const token of tokens) {
    const key = `${token.cls} ${token.value}`;
    const entry = map.get(key);
    if (entry) entry.n += 1;
    else map.set(key, { token, n: 1 });
  }
  return map;
}

/** Tokens in `a` beyond what `b` has, per key. */
function minus(
  a: Map<string, { token: ClassedToken; n: number }>,
  b: Map<string, { token: ClassedToken; n: number }>,
): ClassedToken[] {
  const out: ClassedToken[] = [];
  for (const [key, entry] of a) {
    const extra = entry.n - (b.get(key)?.n ?? 0);
    for (let i = 0; i < extra; i += 1) out.push(entry.token);
  }
  return out;
}

/**
 * On Databricks `"PAID"` is a string, to this tokenizer a quoted
 * identifier: a fixer turning `"PAID"` into `'PAID'` changed quoting, not
 * the filter. Pair such swaps off before judging.
 */
function reconcileQuoting(
  removed: ClassedToken[],
  added: ClassedToken[],
): void {
  for (let r = removed.length - 1; r >= 0; r -= 1) {
    const gone = removed[r];
    const partner = added.findIndex((token) => {
      if (gone.cls === 'identifier' && token.cls === 'literal') {
        return token.value.toLowerCase() === `'${gone.value}'`;
      }
      if (gone.cls === 'literal' && token.cls === 'identifier') {
        return gone.value.toLowerCase() === `'${token.value}'`;
      }
      return false;
    });
    if (partner >= 0) {
      removed.splice(r, 1);
      added.splice(partner, 1);
    }
  }
}

function describe(
  cls: TokenClass,
  removed: ClassedToken[],
  added: ClassedToken[],
): string {
  const gone = removed.filter((t) => t.cls === cls).map((t) => t.display);
  const came = added.filter((t) => t.cls === cls).map((t) => t.display);
  const label = CLASS_LABELS[cls];
  if (gone.length === 1 && came.length === 1)
    return `${label}: ${gone[0]} → ${came[0]}`;
  const parts: string[] = [];
  if (gone.length) parts.push(`removed ${[...new Set(gone)].join(', ')}`);
  if (came.length) parts.push(`added ${[...new Set(came)].join(', ')}`);
  return `${label}: ${parts.join('; ')}`;
}

/** How `repaired` differs from the `original` statement the assistant wrote. Never throws. */
export function classifyRepair(
  original: string,
  repaired: string,
): RepairClassification {
  try {
    if (typeof original !== 'string' || typeof repaired !== 'string') {
      return { kind: 'unknown', changed: [] };
    }
    if (!original.trim() || !repaired.trim())
      return { kind: 'unknown', changed: [] };
    const before = classify(tokenizeSql(original));
    const after = classify(tokenizeSql(repaired));
    const a = counts(before);
    const b = counts(after);
    const removed = minus(a, b);
    const added = minus(b, a);
    reconcileQuoting(removed, added);

    if (!removed.length && !added.length) {
      // Same tokens: whitespace, case or quoting only. Identical text is not
      // a repair at all.
      return original.trim() === repaired.trim()
        ? { kind: 'unknown', changed: [] }
        : { kind: 'syntax', changed: [] };
    }

    const moved = new Set([...removed, ...added].map((token) => token.cls));
    const semantic = SEMANTIC_CLASSES.filter((cls) => moved.has(cls));
    if (semantic.length) {
      const changed = semantic.map((cls) => describe(cls, removed, added));
      if (moved.has('identifier'))
        changed.push(describe('identifier', removed, added));
      return { kind: 'semantic', changed, warning: SEMANTIC_REPAIR_WARNING };
    }
    if (moved.has('identifier')) {
      return {
        kind: 'identifier',
        changed: [describe('identifier', removed, added)],
      };
    }
    const syntax = (['function', 'keyword', 'punct'] as TokenClass[]).filter(
      (cls) => moved.has(cls),
    );
    if (syntax.length) {
      return {
        kind: 'syntax',
        changed: syntax.map((cls) => describe(cls, removed, added)),
      };
    }
    return { kind: 'unknown', changed: [] };
  } catch {
    return { kind: 'unknown', changed: [] };
  }
}
