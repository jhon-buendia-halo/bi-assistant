import type {
  EvalCheckLog,
  EvalVerdict,
  FailureLabel,
} from '../../modules/agents/eval-telemetry';

/**
 * Name the failure class of a failed eval attempt, deterministically.
 *
 * A red case says *that* the engine was wrong; the improvement loop needs
 * *how*, because the lever depends on it — a missing default filter is a
 * context problem, a ratio of the wrong columns a prompt problem, a timeout
 * a budget problem. Reading every failed transcript by hand is what this
 * replaces for the common shapes; `unknown` is the honest answer for the rest.
 *
 * Heuristics compare the attempt's final SQL with the case's reference SQL,
 * without a parser (the same decision as `sql-precheck.ts`: a dependency adds
 * dialect gaps and packaging weight, and these rules only need tables, joins,
 * aggregates, the projection and the filter literals). First match wins, most
 * specific first:
 *
 *  1. ERROR — `timeout` when the error says so, `tool-error` when tools
 *     failed, else `unknown`.
 *  2. No final SQL — `clarified` (it asked instead), `tool-error` (it tried
 *     and every query failed), `no-sql` (a figure was expected).
 *  3. Result set matched — `format-only` (the data was right, the prose
 *     failed a text check), `judge` (only the rubric said no).
 *  4. Against the reference — `missing-default-filter` (a Knowledge default
 *     filter the reference applies is absent), `id-not-name` (reports `*_id`
 *     where the reference names things), `unit` (a /100 or ×100 in one query
 *     only), `wrong-table` (reads a table the reference does not),
 *     `missing-join` (reads a strict subset of the reference's tables, or
 *     joins fewer times), `wrong-aggregate` (different aggregate functions),
 *     `wrong-filter` (different WHERE/HAVING literals).
 *  5. `judge` / `tool-error` when that is the only kind of check that failed.
 *
 * PASS, GAP and SKIP are not failures; they label as `unknown` and callers
 * should not record a label for them.
 */

export interface FailureLabelInput {
  verdict: EvalVerdict;
  checks: EvalCheckLog[];
  finalSql?: string;
  expectedSql?: string;
  /** The turn ended in a clarifying question. */
  clarified: boolean;
  toolErrors: string[];
  /** The result-set check's verdict; absent when there was none or it could not measure. */
  resultMatched?: boolean;
  /** An includes/excludes/equals/matches check failed. */
  textChecksFailed: boolean;
  /** Knowledge `default_filter` predicates in scope, e.g. `claims.is_test = false`. */
  defaultFilterPredicates: string[];
  /** Schema-qualified entities in scope, to tell tables from CTE names and aliases. */
  knownEntities: string[];
  /** ERROR only: what threw. */
  error?: string;
}

const JUDGE_CHECK_ID = 'llm-judge';
const TOOL_CHECK_IDS = new Set([
  'check-no-tool-errors',
  'check-final-sql-succeeded',
]);

export function labelFailure(input: FailureLabelInput): FailureLabel {
  const toolErrors = input.toolErrors ?? [];
  if (input.verdict === 'ERROR') {
    if (
      /time[sd]?[\s-]*out|timeout|aborted|deadline/i.test(input.error ?? '')
    ) {
      return 'timeout';
    }
    return toolErrors.length ? 'tool-error' : 'unknown';
  }
  if (input.verdict !== 'FAIL') return 'unknown';

  const failing = (input.checks ?? []).filter(
    (check) => !check.passed && !check.gap,
  );
  const onlyJudge =
    failing.length > 0 && failing.every((check) => check.id === JUDGE_CHECK_ID);
  const onlyToolChecks =
    failing.length > 0 &&
    failing.every((check) => TOOL_CHECK_IDS.has(check.id.replace(/-\d+$/, '')));
  const finalSql = input.finalSql?.trim();
  const expectedSql = input.expectedSql?.trim();

  if (!finalSql) {
    if (input.clarified) return 'clarified';
    if (toolErrors.length) return 'tool-error';
    if (expectedSql) return 'no-sql';
    return onlyJudge ? 'judge' : 'unknown';
  }

  if (input.resultMatched === true) {
    if (input.textChecksFailed) return 'format-only';
    if (onlyJudge) return 'judge';
    if (onlyToolChecks && toolErrors.length) return 'tool-error';
    return 'unknown';
  }

  if (expectedSql) {
    // A clarifying question where a figure was expected, even if some SQL ran.
    if (input.clarified) return 'clarified';
    const label = compareToReference(finalSql, expectedSql, input);
    if (label) return label;
  }

  if (onlyJudge) return 'judge';
  if (onlyToolChecks && toolErrors.length) return 'tool-error';
  return 'unknown';
}

function compareToReference(
  finalSql: string,
  expectedSql: string,
  input: FailureLabelInput,
): FailureLabel | undefined {
  const final = tokenize(finalSql);
  const reference = tokenize(expectedSql);

  if (
    (input.defaultFilterPredicates ?? []).some(
      (predicate) =>
        predicatePresent(predicate, reference) &&
        !predicatePresent(predicate, final),
    )
  ) {
    return 'missing-default-filter';
  }

  if (reportsIdsNotNames(final, reference)) return 'id-not-name';

  if (
    scalesBy100(final, 'divide') !== scalesBy100(reference, 'divide') ||
    scalesBy100(final, 'multiply') !== scalesBy100(reference, 'multiply')
  ) {
    return 'unit';
  }

  const known = input.knownEntities ?? [];
  const finalTables = tablesOf(final, known);
  const referenceTables = tablesOf(reference, known);
  const extra = [...finalTables].filter((table) => !referenceTables.has(table));
  const missing = [...referenceTables].filter(
    (table) => !finalTables.has(table),
  );
  if (extra.length) return 'wrong-table';
  if (
    missing.length ||
    countWord(reference, 'join') > countWord(final, 'join')
  ) {
    return 'missing-join';
  }

  if (!sameSet(aggregatesOf(final), aggregatesOf(reference)))
    return 'wrong-aggregate';

  if (!sameSet(filterLiterals(final), filterLiterals(reference)))
    return 'wrong-filter';

  return undefined;
}

/* ------------------------------------------------------------ tokenizer */

type TokenKind = 'word' | 'quoted' | 'string' | 'number' | 'punct';

interface Token {
  kind: TokenKind;
  /** Words and quoted identifiers lowercased; strings keep their case. */
  text: string;
}

/**
 * Just enough lexing for the heuristics: comments dropped, string literals
 * and quoted identifiers kept whole (so a keyword inside `'…'` is not a
 * keyword), words lowercased, everything else one character at a time.
 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const source = sql ?? '';
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (ch === "'") {
      let value = '';
      i += 1;
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (source[i] === "'") {
          i += 1;
          break;
        } else {
          value += source[i];
          i += 1;
        }
      }
      tokens.push({ kind: 'string', text: value });
    } else if (ch === '"' || ch === '`') {
      const end = source.indexOf(ch, i + 1);
      const stop = end < 0 ? source.length : end;
      tokens.push({
        kind: 'quoted',
        text: source.slice(i + 1, stop).toLowerCase(),
      });
      i = stop + 1;
    } else if (
      /\d/.test(ch) ||
      (ch === '.' && /\d/.test(source[i + 1] ?? ''))
    ) {
      const match = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(source.slice(i));
      const text = match ? match[0] : ch;
      tokens.push({ kind: 'number', text });
      i += text.length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(i));
      const text = match ? match[0] : ch;
      tokens.push({ kind: 'word', text: text.toLowerCase() });
      i += text.length;
    } else {
      tokens.push({ kind: 'punct', text: ch });
      i += 1;
    }
  }
  return tokens;
}

const isIdentifier = (token: Token | undefined): boolean =>
  token?.kind === 'word' || token?.kind === 'quoted';

function countWord(tokens: Token[], word: string): number {
  return tokens.filter((token) => token.kind === 'word' && token.text === word)
    .length;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/** Words that are never a column, table or alias in these heuristics. */
const SQL_WORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'is',
  'null',
  'true',
  'false',
  'in',
  'like',
  'ilike',
  'between',
  'as',
  'on',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'group',
  'by',
  'order',
  'having',
  'limit',
  'offset',
  'distinct',
  'case',
  'when',
  'then',
  'else',
  'end',
  'with',
  'union',
  'all',
  'asc',
  'desc',
  'filter',
  'over',
  'partition',
  'date',
  'timestamp',
  'interval',
  'cast',
  'exists',
  'any',
  'some',
  'lateral',
  'using',
  'natural',
  'nulls',
  'first',
  'last',
  'qualify',
  'window',
  'values',
  'extract',
  'numeric',
  'integer',
]);

/* ---------------------------------------------------------- predicates */

/**
 * A default-filter predicate is "present" in a query when the query mentions
 * every column the predicate names (`is_test`) and every literal it compares
 * with — so `claim.is_test = false`, `NOT is_test` and `is_test IS FALSE` all
 * count, and an unrelated `status` column does not satisfy `status <> 'TEST'`.
 */
function predicatePresent(predicate: string, tokens: Token[]): boolean {
  const parts = tokenize(predicate);
  const columns = new Set<string>();
  const literals = new Set<string>();
  parts.forEach((token, index) => {
    if (token.kind === 'string') literals.add(token.text);
    if (!isIdentifier(token) || SQL_WORDS.has(token.text)) return;
    // Only the last segment of a dotted chain: `claims.is_test` → `is_test`.
    if (parts[index + 1]?.text === '.') return;
    columns.add(token.text);
  });
  if (!columns.size && !literals.size) return false;
  const words = new Set(tokens.filter(isIdentifier).map((token) => token.text));
  const strings = new Set(
    tokens
      .filter((token) => token.kind === 'string')
      .map((token) => token.text),
  );
  return (
    [...columns].every((column) => words.has(column)) &&
    [...literals].every((literal) => strings.has(literal))
  );
}

/* ---------------------------------------------------------- projection */

const AGGREGATES = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'median',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'percentile_cont',
  'percentile_disc',
  'approx_count_distinct',
  'string_agg',
  'array_agg',
  'bool_and',
  'bool_or',
  'every',
  'mode',
]);

/** Aggregate calls, with `count-distinct` apart from `count`. */
function aggregatesOf(tokens: Token[]): Set<string> {
  const found = new Set<string>();
  tokens.forEach((token, index) => {
    if (token.kind !== 'word' || !AGGREGATES.has(token.text)) return;
    if (tokens[index + 1]?.text !== '(') return;
    const distinct =
      tokens[index + 2]?.kind === 'word' &&
      tokens[index + 2].text === 'distinct';
    found.add(distinct ? `${token.text}-distinct` : token.text);
  });
  return found;
}

/** The outermost SELECT list, split into items at depth 0. */
function projectionItems(tokens: Token[]): Token[][] {
  let depth = 0;
  let start = -1;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.text === '(') depth += 1;
    else if (token.text === ')') depth -= 1;
    else if (depth === 0 && token.kind === 'word' && token.text === 'select') {
      start = index + 1;
      break;
    }
  }
  if (start < 0) return [];
  const items: Token[][] = [];
  let current: Token[] = [];
  depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.text === '(') depth += 1;
    if (token.text === ')') depth -= 1;
    if (depth === 0 && token.kind === 'word' && token.text === 'from') break;
    if (depth === 0 && token.text === ',') {
      items.push(current);
      current = [];
      continue;
    }
    if (
      depth === 0 &&
      token.kind === 'word' &&
      token.text === 'distinct' &&
      !current.length
    ) {
      continue;
    }
    current.push(token);
  }
  if (current.length) items.push(current);
  return items;
}

/** The name an item is reported under: its alias, else its last identifier. */
function itemName(item: Token[]): string | undefined {
  const as = item.findIndex(
    (token) => token.kind === 'word' && token.text === 'as',
  );
  if (as >= 0 && isIdentifier(item[as + 1])) return item[as + 1].text;
  const identifiers = item.filter(
    (token) => isIdentifier(token) && !SQL_WORDS.has(token.text),
  );
  return identifiers.at(-1)?.text;
}

const ID_NAME = /(^|_)id$/;
const LABEL_NAME = /name|title|label|description/;

function describeProjection(tokens: Token[]): { ids: number; labels: number } {
  let ids = 0;
  let labels = 0;
  for (const item of projectionItems(tokens)) {
    const aggregated = item.some(
      (token, index) =>
        token.kind === 'word' &&
        AGGREGATES.has(token.text) &&
        item[index + 1]?.text === '(',
    );
    const name = itemName(item);
    if (!aggregated && name && ID_NAME.test(name)) ids += 1;
    if (
      item.some((token) => isIdentifier(token) && LABEL_NAME.test(token.text))
    ) {
      labels += 1;
    }
  }
  return { ids, labels };
}

/**
 * The answer is keyed by an id with nothing human-readable beside it, where
 * the reference reports a name (or at least no bare id).
 */
function reportsIdsNotNames(final: Token[], reference: Token[]): boolean {
  const mine = describeProjection(final);
  if (mine.ids === 0 || mine.labels > 0) return false;
  const theirs = describeProjection(reference);
  return theirs.labels > 0 || theirs.ids === 0;
}

/* ------------------------------------------------------------ scaling */

function isHundred(token: Token | undefined): boolean {
  return token?.kind === 'number' && Number(token.text) === 100;
}

/** `x / 100` (cents → dollars) or `100 * x` / `x * 100` (fraction → percent). */
function scalesBy100(tokens: Token[], how: 'divide' | 'multiply'): boolean {
  return tokens.some((token, index) => {
    if (how === 'divide')
      return token.text === '/' && isHundred(tokens[index + 1]);
    if (token.text !== '*') return false;
    return isHundred(tokens[index + 1]) || isHundred(tokens[index - 1]);
  });
}

/* -------------------------------------------------------------- tables */

/** Functions whose arguments use FROM as a keyword. */
const FROM_FUNCTIONS = new Set([
  'extract',
  'substring',
  'trim',
  'overlay',
  'position',
]);

/** Names a `WITH` clause defines — not tables, whatever FROM says. */
function cteNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  tokens.forEach((token, index) => {
    if (!isIdentifier(token)) return;
    const next = tokens[index + 1];
    const after = tokens[index + 2];
    if (next?.kind === 'word' && next.text === 'as' && after?.text === '(') {
      const before = tokens[index - 1];
      if (
        before?.text === ',' ||
        (before?.kind === 'word' && before.text === 'with')
      ) {
        names.add(token.text);
      }
    }
  });
  return names;
}

/**
 * Table names (last dotted segment) after FROM and JOIN, and after the commas
 * of an old-style `FROM a, b`. With `knownEntities`, anything that is not one
 * of them (a CTE, a subquery alias) is ignored.
 */
function tablesOf(tokens: Token[], knownEntities: string[]): Set<string> {
  const known = new Set(
    knownEntities.map(
      (entity) => entity.split('.').at(-1)?.toLowerCase() ?? '',
    ),
  );
  const ctes = cteNames(tokens);
  const tables = new Set<string>();
  const readName = (from: number): [string | undefined, number] => {
    let index = from;
    let name: string | undefined;
    while (isIdentifier(tokens[index])) {
      name = tokens[index].text;
      if (tokens[index + 1]?.text !== '.') {
        index += 1;
        break;
      }
      index += 2;
    }
    return [name, index];
  };
  // `EXTRACT(YEAR FROM d)`, `a IS DISTINCT FROM b`: a FROM that is not a
  // table clause. Track which function each open paren belongs to.
  const calls: (string | undefined)[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.text === '(') {
      const before = tokens[index - 1];
      calls.push(before?.kind === 'word' ? before.text : undefined);
      continue;
    }
    if (token.text === ')') {
      calls.pop();
      continue;
    }
    if (
      token.kind !== 'word' ||
      (token.text !== 'from' && token.text !== 'join')
    )
      continue;
    if (token.text === 'from') {
      const call = calls[calls.length - 1];
      if (call && FROM_FUNCTIONS.has(call)) continue;
      if (
        tokens[index - 1]?.kind === 'word' &&
        tokens[index - 1].text === 'distinct'
      )
        continue;
    }
    let cursor = index + 1;
    for (;;) {
      if (tokens[cursor]?.text === '(') break; // subquery
      const [name, next] = readName(cursor);
      if (!name) break;
      if (!ctes.has(name) && (!known.size || known.has(name))) tables.add(name);
      cursor = next;
      // Skip an alias (`claims c`, `claims AS c`), then continue on a comma.
      if (tokens[cursor]?.kind === 'word' && tokens[cursor].text === 'as')
        cursor += 1;
      if (isIdentifier(tokens[cursor]) && !SQL_WORDS.has(tokens[cursor].text))
        cursor += 1;
      if (token.text === 'from' && tokens[cursor]?.text === ',') {
        cursor += 1;
        continue;
      }
      break;
    }
  }
  return tables;
}

/* ------------------------------------------------------------- filters */

const CLAUSE_END = new Set([
  'group',
  'order',
  'limit',
  'offset',
  'union',
  'window',
  'qualify',
]);

/**
 * String and numeric literals inside WHERE / HAVING / FILTER (WHERE …),
 * numbers normalised (`48` = `48.0`). `LIMIT 5` and `SELECT 100.0 * …` are
 * outside a filter and do not count.
 */
function filterLiterals(tokens: Token[]): Set<string> {
  const literals = new Set<string>();
  const stack: { depth: number }[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.text === '(') {
      depth += 1;
      continue;
    }
    if (token.text === ')') {
      while (stack.length && stack[stack.length - 1].depth >= depth)
        stack.pop();
      depth -= 1;
      continue;
    }
    if (token.kind === 'word') {
      if (token.text === 'where' || token.text === 'having') {
        stack.push({ depth });
        continue;
      }
      if (CLAUSE_END.has(token.text) || token.text === 'select') {
        while (stack.length && stack[stack.length - 1].depth >= depth)
          stack.pop();
        continue;
      }
    }
    if (!stack.length) continue;
    if (token.kind === 'string') literals.add(`'${token.text}'`);
    if (token.kind === 'number') literals.add(String(Number(token.text)));
  }
  return literals;
}
