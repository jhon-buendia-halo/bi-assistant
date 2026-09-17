/**
 * Cheap, dialect-agnostic checks for result sets that are technically valid but
 * analytically worthless — the kind an assistant happily narrates ("retention
 * was 100%") because nothing in the rows says otherwise.
 *
 * These run on every answer, so the bias is deliberately towards false
 * negatives: a spurious warning on a correct answer costs more trust than a
 * missed one. Heuristics only — no SQL parser, no schema knowledge.
 */

export type DataWarningCode =
  | 'degenerate-ratio'
  | 'constant-metric'
  | 'unordered-limit'
  | 'blank-group-key'
  | 'row-cap-reached';

export interface DataWarning {
  code: DataWarningCode;
  /** One short business-readable sentence. No SQL syntax, no column-name dumps beyond naming the column. */
  message: string;
}

/** Cell scan ceiling; result sets are already row-capped upstream, this only bounds pathological cases. */
const MAX_SCANNED_ROWS = 5000;
const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function inspectResult(
  sql: string,
  rows: Record<string, unknown>[],
  rowLimit?: number,
): DataWarning[] {
  // Guards are advisory: any surprise in the input must degrade to "nothing to
  // report", never break the answer they are attached to.
  try {
    const text = typeof sql === 'string' ? sql : '';
    const data = Array.isArray(rows)
      ? rows.filter(
          (row): row is Record<string, unknown> =>
            !!row && typeof row === 'object',
        )
      : [];
    const mask = maskLiterals(text);
    const sample = data.slice(0, MAX_SCANNED_ROWS);
    return [
      ...degenerateRatios(text, mask),
      ...constantMetrics(sample),
      ...unorderedLimit(mask),
      ...blankGroupKeys(sample),
      ...rowCapReached(mask, data.length, rowLimit),
    ];
  } catch {
    return [];
  }
}

/* degenerate-ratio */

interface AliasBinding {
  /** Which SELECT the alias belongs to — sibling CTEs may legitimately repeat an expression. */
  scope: number;
  alias: string;
  expr: string;
}

/**
 * The motivating bug: a query emits `SUM(x) AS kept, SUM(x) AS policies`, the
 * answer divides one by the other and reports a flat 100% rate. Identical
 * expressions under different names can only ever produce a ratio of 1.
 */
function degenerateRatios(sql: string, mask: string): DataWarning[] {
  const groups = new Map<string, string[]>();
  for (const binding of selectAliases(sql, mask)) {
    if (!binding.expr || isLiteral(binding.expr)) continue;
    const key = `${binding.scope} ${binding.expr}`;
    const aliases = groups.get(key) ?? [];
    if (
      !aliases.some(
        (alias) => alias.toLowerCase() === binding.alias.toLowerCase(),
      )
    ) {
      aliases.push(binding.alias);
    }
    groups.set(key, aliases);
  }
  const warnings: DataWarning[] = [];
  for (const aliases of groups.values()) {
    if (aliases.length < 2) continue;
    warnings.push({
      code: 'degenerate-ratio',
      message: `${joinNames(aliases)} are computed from the same expression, so any ratio between them is 1 by construction.`,
    });
  }
  return warnings;
}

/**
 * Walks the statement tracking paren depth so that only top-level select-list
 * `AS` bindings count. That depth rule, plus the explicit cast check, is what
 * keeps `CAST(x AS INT)` — present in nearly every generated query — from being
 * read as an alias binding, and keeps table aliases, CTE headers and
 * `OVER (...)` clauses out of the results.
 */
function selectAliases(sql: string, mask: string): AliasBinding[] {
  const bindings: AliasBinding[] = [];
  const castParen: boolean[] = [];
  const inSelectList: boolean[] = [false];
  const itemStart: number[] = [0];
  const scope: number[] = [0];
  let nextScope = 1;
  let depth = 0;
  let i = 0;
  const word = /[A-Za-z_][A-Za-z0-9_$]*/y;

  while (i < mask.length) {
    const ch = mask[i];
    if (ch === '(') {
      const previous = precedingWord(mask, i);
      castParen.push(
        previous === 'cast' ||
          previous === 'try_cast' ||
          previous === 'safe_cast',
      );
      depth += 1;
      inSelectList[depth] = false;
      itemStart[depth] = i + 1;
      scope[depth] = scope[depth - 1];
      i += 1;
      continue;
    }
    if (ch === ')') {
      castParen.pop();
      if (depth > 0) depth -= 1;
      i += 1;
      continue;
    }
    if (ch === ',') {
      itemStart[depth] = i + 1;
      i += 1;
      continue;
    }
    if (!/[A-Za-z_]/.test(ch)) {
      i += 1;
      continue;
    }
    word.lastIndex = i;
    const token = word.exec(mask)?.[0] ?? ch;
    const keyword = token.toLowerCase();
    if (keyword === 'select') {
      inSelectList[depth] = true;
      itemStart[depth] = i + token.length;
      scope[depth] = nextScope;
      nextScope += 1;
    } else if (SELECT_LIST_TERMINATORS.has(keyword)) {
      inSelectList[depth] = false;
    } else if (
      keyword === 'as' &&
      inSelectList[depth] &&
      !castParen[castParen.length - 1]
    ) {
      const alias = readAlias(sql, i + token.length);
      if (alias) {
        bindings.push({
          scope: scope[depth],
          alias,
          expr: normalizeExpr(sql.slice(itemStart[depth], i)),
        });
      }
    }
    i += token.length;
  }
  return bindings;
}

const SELECT_LIST_TERMINATORS = new Set([
  'from',
  'where',
  'group',
  'having',
  'order',
  'limit',
  'window',
  'qualify',
  'union',
  'intersect',
  'except',
]);

function readAlias(sql: string, from: number): string | null {
  const rest = sql.slice(from, from + 128);
  const quoted = /^\s*`([^`]+)`/.exec(rest);
  if (quoted) return quoted[1];
  const bare = /^\s*([A-Za-z_][A-Za-z0-9_$]*)/.exec(rest);
  return bare ? bare[1] : null;
}

function precedingWord(text: string, index: number): string {
  let end = index;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start -= 1;
  return text.slice(start, end).toLowerCase();
}

/**
 * `SUM(a)` and `sum( a )` are the same expression; formatting differences are
 * noise, so fold them away before comparing.
 */
function normalizeExpr(expr: string): string {
  let text = expr.replace(/\s+/g, ' ').trim().toLowerCase();
  text = text.replace(/\s*([(),])\s*/g, '$1');
  while (
    text.startsWith('(') &&
    text.endsWith(')') &&
    isBalanced(text.slice(1, -1))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function isBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Constants repeated under two names (`0 AS lo, 0 AS hi`) are padding, not a collapsed metric. */
function isLiteral(expr: string): boolean {
  return NUMERIC.test(expr) || expr === 'null' || /^'.*'$/.test(expr);
}

function joinNames(names: string[]): string {
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* constant-metric */

/**
 * A rate that is 1 on every row (or a count that is 0 everywhere) almost always
 * means the join or the denominator collapsed, not that the business is
 * perfect. Only 0 and 1 are flagged — other constants are usually intentional.
 */
function constantMetrics(rows: Record<string, unknown>[]): DataWarning[] {
  if (rows.length < 2) return [];
  const warnings: DataWarning[] = [];
  for (const column of columnsOf(rows)) {
    let constant: number | null = null;
    let uniform = true;
    for (const row of rows) {
      const value = numericValue(row[column]);
      if (value === null) {
        uniform = false;
        break;
      }
      if (constant === null) constant = value;
      else if (constant !== value) {
        uniform = false;
        break;
      }
    }
    if (!uniform || constant === null) continue;
    if (constant !== 0 && constant !== 1) continue;
    warnings.push({
      code: 'constant-metric',
      message: `${column} is ${constant} on every row, so it cannot explain any difference between them.`,
    });
  }
  return warnings;
}

/** Connectors return numerics as strings (Databricks) or bigints; booleans are flags, not metrics. */
function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && NUMERIC.test(value.trim()))
    return Number(value.trim());
  return null;
}

/* unordered-limit */

/** Without ORDER BY, the rows a LIMIT keeps are whatever the engine reached first, so "top N" is a fiction. */
function unorderedLimit(mask: string): DataWarning[] {
  if (!/\blimit\b/i.test(mask)) return [];
  if (/\border\s+by\b/i.test(mask)) return [];
  return [
    {
      code: 'unordered-limit',
      message:
        'The query keeps only a few rows without ranking them, so these are an arbitrary sample rather than the top results.',
    },
  ];
}

/* blank-group-key */

/**
 * Blanks mixed with real values mean part of the population is silently
 * bucketed under "nothing", which skews every share and total derived from it.
 */
function blankGroupKeys(rows: Record<string, unknown>[]): DataWarning[] {
  const warnings: DataWarning[] = [];
  for (const column of columnsOf(rows)) {
    let blanks = 0;
    let filled = 0;
    for (const row of rows) {
      if (isBlank(row[column])) blanks += 1;
      else filled += 1;
    }
    if (!blanks || !filled) continue;
    warnings.push({
      code: 'blank-group-key',
      message: `${column} is missing on ${blanks} of ${rows.length} rows, so those rows are grouped under a blank value.`,
    });
  }
  return warnings;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

/* row-cap-reached */

/**
 * Largest LIMIT still read as a deliberate top-N. Above this a LIMIT looks
 * like a safety cap the result may have been clipped by.
 */
const DELIBERATE_TOP_N = 10;

/** Landing exactly on the cap usually means the real answer has more rows than were seen. */
function rowCapReached(
  mask: string,
  rowCount: number,
  rowLimit?: number,
): DataWarning[] {
  const cap = capOf(mask, rowCount, rowLimit);
  if (cap === null) return [];
  return [
    {
      code: 'row-cap-reached',
      message: `The result stopped at ${cap} rows, so it is probably cut short and missing later ones.`,
    },
  ];
}

function capOf(
  mask: string,
  rowCount: number,
  rowLimit?: number,
): number | null {
  if (rowCount <= 0) return null;
  if (
    typeof rowLimit === 'number' &&
    Number.isFinite(rowLimit) &&
    rowLimit > 0 &&
    rowCount >= rowLimit
  ) {
    return rowLimit;
  }
  const limits = [...mask.matchAll(/\blimit\s+(\d+)\b/gi)];
  const declared = limits.length ? Number(limits[limits.length - 1][1]) : null;
  // A small LIMIT the query asked for is a deliberate top-N, not a ceiling it
  // ran into: "the top scorer" returns one row because one row was wanted.
  // Warning there taught the model to hedge a correct answer with "the result
  // may have been truncated", which is worse than saying nothing.
  if (declared !== null && declared > DELIBERATE_TOP_N && rowCount === declared)
    return declared;
  return null;
}

/* shared helpers */

/** Rows can be ragged across connectors, so take the union of keys in first-seen order. */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

/**
 * Blanks out string literals and comments while preserving every character
 * offset, so keyword scanning cannot trip over a `'... LIMIT ...'` inside a
 * label while expression text is still sliced from the original SQL.
 */
function maskLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ' ';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\' && i + 1 < sql.length) {
          out += '  ';
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += '  ';
            i += 2;
            continue;
          }
          out += ' ';
          i += 1;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < sql.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
