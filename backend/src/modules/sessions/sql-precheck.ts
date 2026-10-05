import type {
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from '../../mastra/tool-services';

/**
 * L3 `sqlPrecheck`: a parse-validate-enrich pass over a statement the
 * assistant is about to run, before it spends a round trip to the
 * datasource. Zero tokens, warnings only — never blocks execution.
 *
 * This is Omni's "let it write SQL, then parse it" (engineering plan §9.7)
 * without a parser: **no SQL parser dependency** on purpose. The backend is
 * staged for the desktop app with `npm ci --omit=dev`, a parser adds ~1 MB
 * and brings its own dialect gaps (Databricks backticks, `::` casts,
 * `FILTER (WHERE …)`), and the checks below only need identifiers, table
 * references, join predicates and aggregate calls — a tokenizer plus a
 * paren-depth walk gets those reliably.
 *
 * The bias is the same as `result-guards.ts`: a finding on a correct query
 * teaches the model to ignore findings, so every check bails out (no
 * finding) the moment the statement stops looking like something it can
 * read — an alias defined twice, a column of a CTE, a lambda, a table it
 * cannot resolve uniquely. When unsure, say nothing.
 *
 * Also the shared SQL toolkit for `sql-errors.ts`, `sql-repair-guard.ts`
 * and `result-guards.ts` (tokenizer, statement scan, name similarity), so
 * the four agree on what an identifier is.
 */

/* ------------------------------------------------------------ tokenizer */

/** A whitespace-separated word list as a set — keeps long vocabularies readable. */
function words(list: string): Set<string> {
  return new Set(list.trim().split(/\s+/));
}

export type SqlTokenKind =
  'keyword' | 'identifier' | 'string' | 'number' | 'operator' | 'punct';

export interface SqlToken {
  kind: SqlTokenKind;
  /** Source text as written (quotes included). */
  text: string;
  /**
   * Comparison form: identifiers and keywords lower-cased and unquoted, a
   * string literal's content with its case kept (`'PAID'` ≠ `'paid'`),
   * numbers in canonical form (`1.0` → `1`).
   */
  value: string;
  /** A `"double"` or `` `backticked` `` identifier — never a keyword. */
  quoted?: boolean;
  /** Offset in the source. */
  start: number;
}

/**
 * Words the scanner treats as SQL rather than as names. Deliberately
 * excludes words the assistant routinely uses as aliases (`plan`, `member`,
 * `state`, `call`, `sample`, `position`, `name`) — classing one of those as a
 * keyword would hide a real table alias from every check.
 */
const KEYWORDS = words(`
  select from where group by having order limit offset fetch first next rows
  row only with recursive as on using join inner left right full outer cross
  natural lateral union intersect except minus all distinct and or not in is
  null true false unknown like ilike rlike regexp similar between exists any
  some case when then else end cast try_cast over partition window qualify
  filter within asc desc nulls last interval date time timestamp
  timestamp_ntz timestamp_ltz extract year years month months day days hour
  hours minute minutes second seconds quarter week weeks dow doy epoch
  isodow isoyear millisecond milliseconds microsecond microseconds decade
  century millennium unbounded preceding following current range groups
  values escape collate at zone pivot unpivot tablesample current_date
  current_timestamp current_time localtime localtimestamp materialized both
  leading trailing for placing precision varying double rollup cube grouping
  sets ties percent top semi anti div lateral ordinality without respect
  ignore separator to array map struct symmetric overlaps isnull notnull
  default bernoulli system repeatable exclude others no cluster distribute
  sort current_user session_user user current_schema current_catalog
`);

/** Date/time parts: `EXTRACT(YEAR …)`, `date_part('year', …)`, `INTERVAL 1 DAY`. */
export const DATE_PARTS = words(`
  year years month months day days hour hours minute minutes second seconds
  quarter week weeks dow doy epoch isodow isoyear millisecond milliseconds
  microsecond microseconds decade century millennium
`);

/** Aggregate functions across Postgres and Databricks SQL. */
export const AGGREGATE_FUNCTIONS = words(`
  sum avg count min max stddev stddev_pop stddev_samp variance var_pop
  var_samp median percentile_cont percentile_disc percentile
  approx_percentile mode array_agg string_agg listagg bool_and bool_or every
  count_if approx_count_distinct collect_list collect_set any_value first
  last first_value last_value corr covar_pop covar_samp sum_distinct max_by
  min_by bit_and bit_or
`);

const MULTI_CHAR_OPERATORS = [
  '->>',
  '<=>',
  '::',
  '<>',
  '!=',
  '<=',
  '>=',
  '||',
  '->',
  '=>',
  '==',
  '#>>',
  '#>',
  '@>',
  '<@',
  '!~*',
  '~*',
  '!~',
];

const WORD_START = /[A-Za-z_\u00C0-\uFFFF]/;
const WORD_PART = /[A-Za-z0-9_$\u00C0-\uFFFF]/;
const NUMBER_AT = /(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/y;

function canonicalNumber(text: string): string {
  const value = Number(text);
  return Number.isFinite(value) ? String(value) : text.toLowerCase();
}

/**
 * Split a statement into tokens. String literals and comments are masked —
 * a `'… FROM claims …'` label never yields a table reference, a `-- JOIN`
 * comment never yields a join. Never throws: an unterminated string or
 * comment runs to the end of the text.
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const text = typeof sql === 'string' ? sql : '';
  const tokens: SqlToken[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    // E'…' / N'…' / X'…' / B'…' prefixed literals read as one string.
    if (
      /[EeNnXxBb]/.test(ch) &&
      text[i + 1] === "'" &&
      !WORD_PART.test(text[i - 1] ?? ' ')
    ) {
      const read = readString(text, i + 1);
      tokens.push({
        kind: 'string',
        text: text.slice(i, read.end),
        value: read.value,
        start: i,
      });
      i = read.end;
      continue;
    }
    if (ch === "'") {
      const read = readString(text, i);
      tokens.push({
        kind: 'string',
        text: text.slice(i, read.end),
        value: read.value,
        start: i,
      });
      i = read.end;
      continue;
    }
    if (ch === '$') {
      const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
      tag.lastIndex = i;
      const match = tag.exec(text);
      if (match) {
        const close = text.indexOf(match[0], i + match[0].length);
        const end = close < 0 ? n : close + match[0].length;
        tokens.push({
          kind: 'string',
          text: text.slice(i, end),
          value: text.slice(i + match[0].length, close < 0 ? n : close),
          start: i,
        });
        i = end;
        continue;
      }
    }
    if (ch === '"' || ch === '`') {
      let j = i + 1;
      let value = '';
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            value += ch;
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        value += text[j];
        j += 1;
      }
      tokens.push({
        kind: 'identifier',
        text: text.slice(i, j),
        value: value.toLowerCase(),
        quoted: true,
        start: i,
      });
      i = j;
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(text[i + 1] ?? ''))) {
      NUMBER_AT.lastIndex = i;
      const match = NUMBER_AT.exec(text);
      const raw = match ? match[0] : ch;
      tokens.push({
        kind: 'number',
        text: raw,
        value: canonicalNumber(raw),
        start: i,
      });
      i += raw.length;
      continue;
    }
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j += 1;
      const raw = text.slice(i, j);
      const lower = raw.toLowerCase();
      tokens.push({
        kind: KEYWORDS.has(lower) ? 'keyword' : 'identifier',
        text: raw,
        value: lower,
        start: i,
      });
      i = j;
      continue;
    }
    if ('(),.;[]{}'.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, value: ch, start: i });
      i += 1;
      continue;
    }
    const multi = MULTI_CHAR_OPERATORS.find((op) => text.startsWith(op, i));
    const op = multi ?? ch;
    tokens.push({ kind: 'operator', text: op, value: op, start: i });
    i += op.length;
  }
  return tokens;
}

function readString(
  text: string,
  from: number,
): { value: string; end: number } {
  let j = from + 1;
  let value = '';
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\' && j + 1 < text.length) {
      value += text[j + 1];
      j += 2;
      continue;
    }
    if (ch === "'") {
      if (text[j + 1] === "'") {
        value += "'";
        j += 2;
        continue;
      }
      return { value, end: j + 1 };
    }
    value += ch;
    j += 1;
  }
  return { value, end: text.length };
}

/* ------------------------------------------------------- statement scan */

type Clause =
  | 'none'
  | 'select'
  | 'from'
  | 'on'
  | 'where'
  | 'group'
  | 'having'
  | 'order'
  | 'limit'
  | 'window'
  | 'qualify'
  | 'other';

export interface SqlTableRef {
  /** Name parts as written, lower-cased and unquoted (`['health_insurance', 'claims']`). */
  parts: string[];
  alias?: string;
  /** The SELECT this reference belongs to. */
  scope: number;
}

export interface SqlColumnRef {
  /** `['claim', 'status']` for `claim.status`, `['status']` for a bare name. */
  parts: string[];
  quoted: boolean;
  clause: Clause;
  scope: number;
  /** Token span of the reference, for neighbouring-token checks. */
  first: number;
  last: number;
}

export interface SqlStar {
  scope: number;
  /** `claim` for `claim.*`; absent for a bare `*`. */
  qualifier?: string[];
}

export interface SqlScan {
  tokens: SqlToken[];
  /** CTE names defined by `WITH`. */
  ctes: Set<string>;
  tables: SqlTableRef[];
  /** Aliases of subqueries and table functions in FROM — their columns are unknown. */
  derivedAliases: Set<string>;
  /** Output column aliases (`AS x`, implicit aliases, CTE column lists, window names). */
  outputAliases: Set<string>;
  columnRefs: SqlColumnRef[];
  stars: SqlStar[];
  /** Number of SELECT keywords — 1 means a single, flat query. */
  selectCount: number;
  /** A subquery / table function / parenthesised join sits in a FROM clause. */
  hasDerivedFrom: boolean;
  /** Databricks lambdas (`x -> x + 1`) bind names no schema knows. */
  hasLambda: boolean;
  /** Aggregate calls: function name and the token span of its arguments. */
  aggregates: { name: string; open: number; close: number }[];
}

interface Frame {
  /** The statement itself, a subquery, a CTE body or a parenthesised join. */
  query: boolean;
  scope: number;
  clause: Clause;
  /** Function (or `over` / `filter` / `using`) whose argument list this is. */
  fn?: string;
  expectTable: boolean;
  /** The FROM item just read, waiting for an optional alias. */
  pendingAlias: 'table' | 'derived' | null;
  pendingTable?: SqlTableRef;
  /** This paren is a FROM item (subquery / table function) — its alias is derived. */
  derivedItem?: boolean;
  /** Names inside are declarations (CTE / derived column lists), not references. */
  declares?: boolean;
  /** WITH-list state machine. */
  cte?: 'name' | 'afterName' | 'afterAs' | 'afterBody';
  cteBody?: boolean;
  /** A table function name was read in FROM: its `(` opens a derived item. */
  derivedCallPending?: boolean;
  /** An alias was just read: a `(` now opens its column list. */
  declareNext?: boolean;
  openIndex: number;
}

const CAST_FUNCTIONS = new Set(['cast', 'try_cast', 'safe_cast', 'convert']);
const QUERY_STARTERS = new Set(['select', 'with', 'values']);
/** Words that may precede `(` without being a function name. */
const NOT_A_FUNCTION = words(`
  in exists from join as on and or not using values select where when then
  else case by lateral all any some between like ilike is with union
  intersect except having qualify limit offset window recursive materialized
  distinct return returns
`);
const CLAUSE_KEYWORDS: Record<string, Clause> = {
  where: 'where',
  group: 'group',
  having: 'having',
  order: 'order',
  limit: 'limit',
  offset: 'limit',
  fetch: 'limit',
  window: 'window',
  qualify: 'qualify',
  union: 'none',
  intersect: 'none',
  except: 'none',
  minus: 'none',
};

function isWord(token: SqlToken | undefined): boolean {
  return !!token && (token.kind === 'identifier' || token.kind === 'keyword');
}

function isName(token: SqlToken | undefined): boolean {
  return !!token && token.kind === 'identifier';
}

function isPunct(token: SqlToken | undefined, value: string): boolean {
  return !!token && token.kind === 'punct' && token.value === value;
}

/** The name after a FROM item or an `AS`: a table alias, a derived alias or an output alias. */
function bindAlias(
  scan: SqlScan,
  frame: Frame,
  token: SqlToken,
  next: SqlToken | undefined,
): void {
  if (frame.pendingAlias === 'table' && frame.pendingTable) {
    frame.pendingTable.alias = token.value;
  } else if (frame.pendingAlias === 'derived') {
    scan.derivedAliases.add(token.value);
  } else if (!frame.fn || !CAST_FUNCTIONS.has(frame.fn)) {
    scan.outputAliases.add(token.value);
  }
  if (frame.pendingAlias) frame.declareNext = isPunct(next, '(');
  frame.pendingAlias = null;
  frame.pendingTable = undefined;
}

/**
 * Walk the statement once, tracking paren frames, and collect what the
 * checks need: CTEs, FROM items and their aliases, column references with
 * the clause they sit in, `*` projections and aggregate calls.
 *
 * Frames are what make this safe without a grammar: `FROM` only starts a
 * table reference in a query frame, so `EXTRACT(YEAR FROM d)` and
 * `SUBSTRING(x FROM 2)` never do; `ORDER BY` inside `OVER (…)` changes
 * nothing outside it; a CTE's column list declares names instead of
 * referencing them.
 */
export function scanSql(sql: string): SqlScan {
  const tokens = tokenizeSql(sql);
  const scan: SqlScan = {
    tokens,
    ctes: new Set(),
    tables: [],
    derivedAliases: new Set(),
    outputAliases: new Set(),
    columnRefs: [],
    stars: [],
    selectCount: 0,
    hasDerivedFrom: false,
    hasLambda: tokens.some((t) => t.kind === 'operator' && t.value === '->'),
    aggregates: [],
  };
  let nextScope = 0;
  const frames: Frame[] = [
    {
      query: true,
      scope: nextScope,
      clause: 'none',
      expectTable: false,
      pendingAlias: null,
      openIndex: -1,
    },
  ];
  /** Open parens of aggregate calls: frame index → aggregate record. */
  const openAggregates = new Map<
    number,
    { name: string; open: number; close: number }
  >();
  let afterAs = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const frame = frames[frames.length - 1];
    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    /* WITH list: names, optional column list, AS, body, comma. */
    if (frame.cte === 'name' && isWord(token)) {
      if (token.value === 'recursive') continue;
      scan.ctes.add(token.value);
      frame.cte = 'afterName';
      continue;
    }
    if (
      frame.cte === 'afterName' &&
      token.kind === 'keyword' &&
      token.value === 'as'
    ) {
      frame.cte = 'afterAs';
      continue;
    }
    if (
      frame.cte === 'afterAs' &&
      token.kind === 'keyword' &&
      (token.value === 'not' || token.value === 'materialized')
    ) {
      continue;
    }
    if (frame.cte === 'afterBody') {
      if (isPunct(token, ',')) {
        frame.cte = 'name';
        continue;
      }
      frame.cte = undefined;
    }

    /* Parens. */
    if (isPunct(token, '(')) {
      const startsQuery =
        !!next && next.kind === 'keyword' && QUERY_STARTERS.has(next.value);
      const fnName =
        isWord(prev) && !NOT_A_FUNCTION.has(prev.value) && !frame.expectTable
          ? prev.value
          : undefined;
      const child: Frame = {
        query: startsQuery,
        scope: frame.scope,
        clause: startsQuery ? 'none' : frame.clause,
        expectTable: false,
        pendingAlias: null,
        openIndex: i,
      };
      if (frame.cte === 'afterName') {
        child.declares = true;
      } else if (frame.cte === 'afterAs') {
        child.cteBody = true;
        child.query = true;
        frame.cte = 'afterBody';
      } else if (frame.expectTable) {
        // A subquery or a parenthesised join in FROM.
        frame.expectTable = false;
        scan.hasDerivedFrom = true;
        if (startsQuery) {
          child.derivedItem = true;
        } else {
          child.query = true;
          child.clause = 'from';
          child.expectTable = true;
        }
      } else if (frame.declareNext) {
        // `alias(col, …)` — a column alias list declares names.
        child.declares = true;
      } else if (fnName) {
        child.fn = fnName;
        if (frame.derivedCallPending) {
          child.derivedItem = true;
          frame.derivedCallPending = false;
        }
        if (AGGREGATE_FUNCTIONS.has(fnName) && prev.kind === 'identifier') {
          const record = { name: fnName, open: i, close: tokens.length - 1 };
          scan.aggregates.push(record);
          openAggregates.set(frames.length, record);
        }
      }
      frame.declareNext = false;
      frames.push(child);
      afterAs = false;
      continue;
    }
    frame.declareNext = false;
    if (isPunct(token, ')')) {
      if (frames.length > 1) {
        const closed = frames.pop() as Frame;
        const record = openAggregates.get(frames.length);
        if (record) {
          record.close = i;
          openAggregates.delete(frames.length);
        }
        const parent = frames[frames.length - 1];
        if (closed.derivedItem) parent.pendingAlias = 'derived';
      }
      afterAs = false;
      continue;
    }

    /* Keywords that steer the walk. */
    if (token.kind === 'keyword') {
      const word = token.value;
      if (word === 'as') {
        afterAs = true;
        continue;
      }
      if (afterAs) {
        // `AS year`, `AS date`: a keyword-spelled alias (or a cast's type).
        afterAs = false;
        bindAlias(scan, frame, token, tokens[i + 1]);
        continue;
      }
      if (word === 'with' && frame.query && (i === 0 || isPunct(prev, '('))) {
        frame.cte = 'name';
        continue;
      }
      if (frame.pendingAlias) {
        // A keyword right after a FROM item means it has no alias.
        frame.pendingAlias = null;
        frame.pendingTable = undefined;
      }
      if (!frame.query) {
        // Inside a function / OVER / FILTER: clauses are local to the frame.
        if (word === 'where' || word === 'order' || word === 'partition') {
          frame.clause = word === 'where' ? 'where' : 'other';
        }
        continue;
      }
      if (word === 'select') {
        nextScope += 1;
        frame.scope = nextScope;
        frame.clause = 'select';
        frame.expectTable = false;
        scan.selectCount += 1;
        continue;
      }
      if (word === 'from') {
        const distinctFrom =
          prev?.value === 'distinct' &&
          (tokens[i - 2]?.value === 'is' || tokens[i - 3]?.value === 'is');
        if (!distinctFrom) {
          frame.clause = 'from';
          frame.expectTable = true;
        }
        continue;
      }
      if (word === 'join') {
        frame.clause = 'from';
        frame.expectTable = true;
        continue;
      }
      if (word === 'lateral' || word === 'only') continue;
      if (word === 'on' && frame.clause === 'from') {
        frame.clause = 'on';
        frame.expectTable = false;
        continue;
      }
      if (word === 'using' && frame.clause === 'from') {
        frame.expectTable = false;
        continue;
      }
      if (
        (word === 'left' ||
          word === 'right' ||
          word === 'inner' ||
          word === 'full' ||
          word === 'cross' ||
          word === 'natural' ||
          word === 'outer') &&
        (frame.clause === 'from' || frame.clause === 'on')
      ) {
        frame.clause = 'from';
        frame.expectTable = false;
        continue;
      }
      const clause = CLAUSE_KEYWORDS[word];
      if (clause) {
        frame.clause = clause;
        frame.expectTable = false;
        continue;
      }
      continue;
    }

    if (isPunct(token, ',')) {
      afterAs = false;
      // `FROM a x, b y` and `JOIN c ON …, d`: a comma in FROM starts a new item.
      if (frame.query && (frame.clause === 'from' || frame.clause === 'on')) {
        frame.clause = 'from';
        frame.expectTable = true;
        frame.pendingAlias = null;
      }
      continue;
    }

    /* `*` projections. */
    if (token.kind === 'operator' && token.value === '*') {
      if (
        frame.query &&
        frame.clause === 'select' &&
        (prev?.value === 'select' ||
          prev?.value === 'distinct' ||
          prev?.value === 'all' ||
          isPunct(prev, ','))
      ) {
        scan.stars.push({ scope: frame.scope });
      }
      continue;
    }

    if (!isName(token)) {
      afterAs = false;
      continue;
    }

    /* Names. */
    if (afterAs) {
      afterAs = false;
      bindAlias(scan, frame, token, next);
      continue;
    }
    if (frame.declares) {
      scan.outputAliases.add(token.value);
      continue;
    }
    if (frame.pendingAlias) {
      bindAlias(scan, frame, token, next);
      continue;
    }

    // Read a dotted chain: a.b.c, a.*.
    const parts = [token.value];
    let quoted = !!token.quoted;
    let last = i;
    let starQualifier = false;
    while (isPunct(tokens[last + 1], '.')) {
      const part = tokens[last + 2];
      if (!part) break;
      if (part.kind === 'operator' && part.value === '*') {
        starQualifier = true;
        last += 2;
        break;
      }
      if (!isWord(part)) break;
      parts.push(part.value);
      quoted = quoted || !!part.quoted;
      last += 2;
    }
    const after = tokens[last + 1];

    if (frame.expectTable && frame.query) {
      frame.expectTable = false;
      if (isPunct(after, '(')) {
        // Table function (generate_series, unnest, …) — its alias is derived.
        scan.hasDerivedFrom = true;
        frame.derivedCallPending = true;
        i = last;
        continue;
      }
      const ref: SqlTableRef = { parts, scope: frame.scope };
      scan.tables.push(ref);
      frame.pendingAlias = 'table';
      frame.pendingTable = ref;
      i = last;
      continue;
    }

    if (starQualifier) {
      // `SELECT c.*` projects; `COUNT(c.*)` does not.
      if (frame.query && frame.clause === 'select') {
        scan.stars.push({ scope: frame.scope, qualifier: parts });
      }
      i = last;
      continue;
    }
    if (isPunct(after, '(')) {
      // Function call (possibly schema-qualified) — not a column.
      i = last;
      continue;
    }
    if (prev && prev.kind === 'operator' && prev.value === '::') {
      // A type name after a cast.
      i = last;
      continue;
    }
    if (prev && prev.kind === 'keyword' && prev.value === 'over') {
      // `OVER w` names a window.
      i = last;
      continue;
    }
    if (
      after &&
      after.kind === 'operator' &&
      (after.value === '=>' || after.value === '->')
    ) {
      // Named argument or lambda parameter.
      i = last;
      continue;
    }
    if (frame.query && frame.clause === 'window') {
      scan.outputAliases.add(token.value);
      i = last;
      continue;
    }
    if (
      frame.query &&
      frame.clause === 'select' &&
      parts.length === 1 &&
      prev &&
      (isPunct(prev, ')') ||
        prev.kind === 'identifier' ||
        prev.kind === 'number' ||
        prev.kind === 'string' ||
        (prev.kind === 'keyword' && prev.value === 'end')) &&
      (!after ||
        isPunct(after, ',') ||
        isPunct(after, ')') ||
        (after.kind === 'keyword' && after.value === 'from'))
    ) {
      // `SELECT COUNT(*) claims` — an implicit output alias.
      scan.outputAliases.add(token.value);
      i = last;
      continue;
    }
    scan.columnRefs.push({
      parts,
      quoted,
      clause: frame.clause,
      scope: frame.scope,
      first: i,
      last,
    });
    i = last;
  }
  return scan;
}

/* ---------------------------------------------------- entity resolution */

export interface ScopeEntity {
  key: string;
  parts: string[];
  columns?: DatasetColumnSnapshot[];
}

export type QualifierTarget =
  | { kind: 'entity'; entity: ScopeEntity }
  | { kind: 'derived' }
  | { kind: 'ambiguous' }
  | { kind: 'unknown' };

/** Every entity in scope, deduplicated by key (first snapshot with columns wins). */
export function scopeEntities(snapshots: DatasetSnapshot[]): ScopeEntity[] {
  const byKey = new Map<string, ScopeEntity>();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const described = new Map(
      (snapshot?.entities ?? []).map((entity) => [entity.key, entity.columns]),
    );
    const keys = new Set([...(snapshot?.tables ?? []), ...described.keys()]);
    for (const key of keys) {
      if (typeof key !== 'string' || !key) continue;
      const columns = described.get(key);
      const existing = byKey.get(key.toLowerCase());
      if (existing && (existing.columns?.length || !columns?.length)) continue;
      byKey.set(key.toLowerCase(), {
        key,
        parts: key.toLowerCase().split('.'),
        columns: columns?.length ? columns : existing?.columns,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * `schema.table` or `table` as written → the entity whose key ends with
 * those parts. Keys are `catalog.schema.table`; on Postgres the model may
 * drop the catalog, and often the schema too.
 */
export function matchEntity(
  parts: string[],
  entities: ScopeEntity[],
):
  | { status: 'known'; entity: ScopeEntity }
  | { status: 'ambiguous' }
  | { status: 'unknown' } {
  if (!parts.length) return { status: 'unknown' };
  const matches = entities.filter(
    (entity) =>
      entity.parts.length >= parts.length &&
      parts.every(
        (part, index) =>
          entity.parts[entity.parts.length - parts.length + index] === part,
      ),
  );
  if (matches.length === 1) return { status: 'known', entity: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'unknown' };
}

/** Alias / table name → what it points at. A name bound twice to different things is ambiguous. */
export function qualifierMap(
  scan: SqlScan,
  entities: ScopeEntity[],
): Map<string, QualifierTarget> {
  const map = new Map<string, QualifierTarget>();
  const bind = (name: string, target: QualifierTarget) => {
    const existing = map.get(name);
    if (!existing) {
      map.set(name, target);
      return;
    }
    const same =
      existing.kind === target.kind &&
      (existing.kind !== 'entity' ||
        (target.kind === 'entity' &&
          existing.entity.key === target.entity.key));
    if (!same) map.set(name, { kind: 'ambiguous' });
  };
  for (const ref of scan.tables) {
    const target = tableTarget(ref, scan, entities);
    if (ref.alias) {
      bind(ref.alias, target);
    } else {
      bind(ref.parts[ref.parts.length - 1], target);
      if (ref.parts.length > 1) bind(ref.parts.join('.'), target);
      if (ref.parts.length > 2) bind(ref.parts.slice(-2).join('.'), target);
    }
  }
  for (const alias of scan.derivedAliases) bind(alias, { kind: 'derived' });
  for (const cte of scan.ctes) {
    if (!map.has(cte)) map.set(cte, { kind: 'derived' });
  }
  return map;
}

export function tableTarget(
  ref: SqlTableRef,
  scan: SqlScan,
  entities: ScopeEntity[],
): QualifierTarget {
  if (ref.parts.length === 1 && scan.ctes.has(ref.parts[0])) {
    return { kind: 'derived' };
  }
  const match = matchEntity(ref.parts, entities);
  if (match.status === 'known') return { kind: 'entity', entity: match.entity };
  return { kind: match.status };
}

/**
 * Split a column reference into what qualifies it and the column itself.
 * The longest known prefix wins, so `health_insurance.claims.status` and
 * `claim.status` both resolve, and a Databricks struct path
 * `claim.address.city` checks `address` (the column), not `city`.
 */
export function resolveColumnRef(
  ref: SqlColumnRef,
  qualifiers: Map<string, QualifierTarget>,
): { target?: QualifierTarget; column: string; qualifier?: string } | null {
  if (ref.parts.length === 1) return { column: ref.parts[0] };
  for (let k = ref.parts.length - 1; k >= 1; k -= 1) {
    const qualifier = ref.parts.slice(0, k).join('.');
    const target = qualifiers.get(qualifier);
    if (target) return { target, column: ref.parts[k], qualifier };
  }
  return null;
}

/** Entities the statement reads (known, resolved uniquely). */
export function readEntities(
  scan: SqlScan,
  entities: ScopeEntity[],
): ScopeEntity[] {
  const seen = new Map<string, ScopeEntity>();
  for (const ref of scan.tables) {
    const target = tableTarget(ref, scan, entities);
    if (target.kind === 'entity') seen.set(target.entity.key, target.entity);
  }
  return [...seen.values()];
}

/* ------------------------------------------------------ name similarity */

/** Damerau (optimal string alignment) distance — a swapped pair is one typo. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

/**
 * How alike two identifiers are, 0..1. Edit distance alone ranks `amount`
 * far from `paid_amount_cents`; the model's usual mistake is a missing
 * prefix or suffix, so containment and shared `_`-separated words count too.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
  let score = 1 - editDistance(x, y) / Math.max(x.length, y.length);
  if (y.startsWith(x) || x.startsWith(y))
    score = Math.max(score, 0.6 + 0.35 * ratio);
  else if (y.includes(x) || x.includes(y))
    score = Math.max(score, 0.55 + 0.35 * ratio);
  const wordsX = new Set(x.split(/[_\s]+/).filter(Boolean));
  const wordsY = new Set(y.split(/[_\s]+/).filter(Boolean));
  const shared = [...wordsX].filter((word) => wordsY.has(word)).length;
  if (shared) {
    const union = new Set([...wordsX, ...wordsY]).size;
    score = Math.max(score, 0.3 + 0.5 * (shared / union));
  }
  return score;
}

/** The `limit` candidates most like `target`, best first (ties: shorter, then alphabetical). */
export function closestNames(
  target: string,
  candidates: string[],
  limit = 3,
): string[] {
  const unique = [...new Set(candidates.filter(Boolean))];
  return unique
    .map((name) => ({ name, score: nameSimilarity(target, name) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((entry) => entry.name);
}

/** `catalog.schema.table` → `schema.table`: enough to name it in a sentence. */
export function shortEntityName(key: string): string {
  const parts = key.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : key;
}

/* -------------------------------------------------------------- precheck */

/** Context the precheck draws on: curated default filters and governed metrics for the entities in scope. */
export interface PrecheckContext {
  defaultFilters: { entity: string; predicate: string; title?: string }[];
  metrics: {
    entity: string;
    name: string;
    expression: string;
    label?: string;
  }[];
}

/** A table this wide is rarely wanted whole — `SELECT *` there is noise in the context. */
export const WIDE_TABLE_COLUMNS = 15;
/** How many in-scope tables an unknown-table finding lists. */
const LISTED_TABLES = 10;
/** Longest predicate / expression quoted back in a finding. */
const QUOTED_CHARS = 160;

/**
 * Findings about `sql` against the schema in `snapshots`, each a short
 * directive sentence fit to append to `TurnResult.warnings` /
 * `ToolDataRecord.precheck`. Empty = nothing to flag. Never throws.
 */
export function precheckSql(
  sql: string,
  snapshots: DatasetSnapshot[],
  context: PrecheckContext,
): string[] {
  try {
    const entities = scopeEntities(snapshots);
    if (!entities.length || typeof sql !== 'string' || !sql.trim()) return [];
    const scan = scanSql(sql);
    const qualifiers = qualifierMap(scan, entities);
    const findings = [
      ...unknownTables(scan, entities),
      ...unknownColumns(scan, entities, qualifiers),
      ...offEdgeJoins(scan, qualifiers),
      ...wideStars(scan, entities, qualifiers),
      ...missingDefaultFilters(scan, entities, context?.defaultFilters ?? []),
      ...metricMismatches(scan, entities, context?.metrics ?? []),
    ];
    return [...new Set(findings)];
  } catch {
    return [];
  }
}

function unknownTables(scan: SqlScan, entities: ScopeEntity[]): string[] {
  const findings: string[] = [];
  for (const ref of scan.tables) {
    if (tableTarget(ref, scan, entities).kind !== 'unknown') continue;
    const name = ref.parts.join('.');
    const listed = closestNames(
      ref.parts[ref.parts.length - 1],
      entities.map((entity) => entity.parts[entity.parts.length - 1]),
      entities.length,
    )
      .flatMap((table) =>
        entities.filter(
          (entity) => entity.parts[entity.parts.length - 1] === table,
        ),
      )
      .map((entity) => entity.key);
    const shown = listed.slice(0, LISTED_TABLES);
    const more =
      listed.length > shown.length
        ? ` (+${listed.length - shown.length} more)`
        : '';
    findings.push(
      `${name} is not a table in this session's datasets — use one of: ${shown.join(', ')}${more}.`,
    );
  }
  return findings;
}

function unknownColumns(
  scan: SqlScan,
  entities: ScopeEntity[],
  qualifiers: Map<string, QualifierTarget>,
): string[] {
  const findings: string[] = [];
  for (const ref of scan.columnRefs) {
    if (ref.parts.length < 2) continue;
    const resolved = resolveColumnRef(ref, qualifiers);
    if (!resolved?.target || resolved.target.kind !== 'entity') continue;
    const columns = resolved.target.entity.columns;
    if (!columns?.length) continue;
    if (hasColumn(columns, resolved.column)) continue;
    const closest = closestNames(
      resolved.column,
      columns.map((c) => c.name),
    );
    findings.push(
      `${shortEntityName(resolved.target.entity.key)} has no column ${resolved.column} — closest: ${closest.join(', ')}.`,
    );
  }
  findings.push(...unknownBareColumns(scan, entities, qualifiers));
  return findings;
}

/**
 * Bare names are only checked in a flat query: one SELECT, no CTE, no
 * subquery or table function in FROM, every table known with its columns.
 * Anywhere else a bare name may be a CTE column or a derived one, and a
 * guess there is exactly the false positive this module must not make.
 */
function unknownBareColumns(
  scan: SqlScan,
  entities: ScopeEntity[],
  qualifiers: Map<string, QualifierTarget>,
): string[] {
  if (
    scan.selectCount !== 1 ||
    scan.ctes.size ||
    scan.hasDerivedFrom ||
    scan.hasLambda
  ) {
    return [];
  }
  const read: ScopeEntity[] = [];
  for (const ref of scan.tables) {
    const target = tableTarget(ref, scan, entities);
    if (target.kind !== 'entity' || !target.entity.columns?.length) return [];
    read.push(target.entity);
  }
  if (!read.length) return [];
  const findings: string[] = [];
  for (const ref of scan.columnRefs) {
    if (ref.parts.length !== 1 || ref.quoted) continue;
    // A bare name inside FROM is a table function's argument or a Databricks
    // `LATERAL VIEW` binding, never a plain column reference.
    if (ref.clause === 'from') continue;
    const name = ref.parts[0];
    if (scan.outputAliases.has(name) || qualifiers.has(name)) continue;
    if (read.some((entity) => hasColumn(entity.columns ?? [], name))) continue;
    const candidates = read.flatMap((entity) =>
      (entity.columns ?? []).map((column) => column.name),
    );
    const closest = closestNames(name, candidates);
    const where =
      read.length === 1
        ? `${shortEntityName(read[0].key)} has no column ${name}`
        : `No table in this query has a column ${name}`;
    findings.push(`${where} — closest: ${closest.join(', ')}.`);
  }
  return findings;
}

function hasColumn(columns: DatasetColumnSnapshot[], name: string): boolean {
  const lower = name.toLowerCase();
  return columns.some((column) => column.name.toLowerCase() === lower);
}

function columnOf(
  entity: ScopeEntity,
  name: string,
): DatasetColumnSnapshot | undefined {
  const lower = name.toLowerCase();
  return entity.columns?.find((column) => column.name.toLowerCase() === lower);
}

/** `claims` → `claim`, `countries` → `country`: the `<name>_id` convention for keys. */
function singular(table: string): string {
  if (table.endsWith('ies')) return `${table.slice(0, -3)}y`;
  if (table.endsWith('sses') || table.endsWith('xes'))
    return table.slice(0, -2);
  if (table.endsWith('s') && !table.endsWith('ss')) return table.slice(0, -1);
  return table;
}

function isIdLike(column: string): boolean {
  return column === 'id' || column.endsWith('_id');
}

function referencesEntity(
  column: DatasetColumnSnapshot | undefined,
  entity: ScopeEntity,
  target?: string,
): boolean {
  const ref = column?.references;
  if (!ref) return false;
  const match = matchEntity(ref.entity.toLowerCase().split('.'), [entity]);
  return (
    match.status === 'known' &&
    (!target || ref.column.toLowerCase() === target.toLowerCase())
  );
}

/** Every declared or inferred key between two entities, as `a.col = b.col`. */
function edgesBetween(a: ScopeEntity, b: ScopeEntity): string[] {
  const edges: string[] = [];
  for (const column of a.columns ?? []) {
    if (referencesEntity(column, b) && column.references) {
      edges.push(
        `${shortEntityName(a.key)}.${column.name} = ${shortEntityName(b.key)}.${column.references.column}`,
      );
    }
  }
  for (const column of b.columns ?? []) {
    if (referencesEntity(column, a) && column.references) {
      edges.push(
        `${shortEntityName(b.key)}.${column.name} = ${shortEntityName(a.key)}.${column.references.column}`,
      );
    }
  }
  return edges;
}

/**
 * An equality between two tables' columns that is neither a known edge, a
 * same-named key, two keys pointing at the same table, nor the
 * `<table>_id = <table>.id` convention. Flagged only when there is evidence
 * it is a mistake: a known edge between the two tables exists (so this one
 * is the wrong one), or both sides are keys.
 */
function offEdgeJoins(
  scan: SqlScan,
  qualifiers: Map<string, QualifierTarget>,
): string[] {
  const findings: string[] = [];
  const refs = scan.columnRefs;
  for (let r = 0; r + 1 < refs.length; r += 1) {
    const left = refs[r];
    const right = refs[r + 1];
    if (left.clause !== 'on' && left.clause !== 'where') continue;
    if (right.clause !== left.clause) continue;
    const between = scan.tokens[left.last + 1];
    if (!between || between.kind !== 'operator' || between.value !== '=')
      continue;
    if (right.first !== left.last + 2) continue;
    // Part of a larger expression (`a.x = b.y + 1`, `f(a.x) = b.y`) → not a plain key join.
    const before = scan.tokens[left.first - 1];
    const after = scan.tokens[right.last + 1];
    if (
      before &&
      (before.kind === 'operator' ||
        (isPunct(before, '(') && isWord(scan.tokens[left.first - 2])))
    )
      continue;
    if (after && after.kind === 'operator') continue;
    const l = resolveColumnRef(left, qualifiers);
    const rr = resolveColumnRef(right, qualifiers);
    if (!l?.target || !rr?.target) continue;
    if (l.target.kind !== 'entity' || rr.target.kind !== 'entity') continue;
    const a = l.target.entity;
    const b = rr.target.entity;
    // Self-joins (manager_id = id) follow keys no snapshot declares — skip.
    if (a.key === b.key) continue;
    const colA = columnOf(a, l.column);
    const colB = columnOf(b, rr.column);
    if (!colA || !colB) continue; // an unknown column is reported on its own
    const nameA = colA.name.toLowerCase();
    const nameB = colB.name.toLowerCase();
    if (nameA === nameB) continue;
    if (
      referencesEntity(colA, b, colB.name) ||
      referencesEntity(colB, a, colA.name)
    )
      continue;
    if (
      colA.references &&
      colB.references &&
      colA.references.entity.toLowerCase() ===
        colB.references.entity.toLowerCase() &&
      colA.references.column.toLowerCase() ===
        colB.references.column.toLowerCase()
    ) {
      continue;
    }
    const tableA = singular(a.parts[a.parts.length - 1]);
    const tableB = singular(b.parts[b.parts.length - 1]);
    if (nameB === 'id' && nameA.endsWith(`${tableB}_id`)) continue;
    if (nameA === 'id' && nameB.endsWith(`${tableA}_id`)) continue;
    const edges = edgesBetween(a, b);
    if (!edges.length && !(isIdLike(nameA) && isIdLike(nameB))) continue;
    const written = `${left.parts.join('.')} = ${right.parts.join('.')}`;
    const fix = edges.length
      ? `the known key is ${edges.slice(0, 2).join(' or ')}`
      : 'check which columns link them';
    findings.push(
      `The join ${written} does not follow a known key between ${shortEntityName(a.key)} and ${shortEntityName(b.key)} — ${fix}.`,
    );
  }
  return findings;
}

function wideStars(
  scan: SqlScan,
  entities: ScopeEntity[],
  qualifiers: Map<string, QualifierTarget>,
): string[] {
  const findings: string[] = [];
  for (const star of scan.stars) {
    const targets: ScopeEntity[] = [];
    if (star.qualifier) {
      const target = qualifiers.get(star.qualifier.join('.'));
      if (target?.kind === 'entity') targets.push(target.entity);
    } else {
      for (const ref of scan.tables) {
        if (ref.scope !== star.scope) continue;
        const target = tableTarget(ref, scan, entities);
        if (target.kind === 'entity') targets.push(target.entity);
      }
    }
    for (const entity of targets) {
      const width = entity.columns?.length ?? 0;
      if (width < WIDE_TABLE_COLUMNS) continue;
      findings.push(
        `Selecting every column of ${shortEntityName(entity.key)} (${width} columns) — name only the columns the question needs.`,
      );
    }
  }
  return findings;
}

/** Every name the statement mentions, lower-cased — keywords too (`year` may be a column). */
function mentionedNames(scan: SqlScan): Set<string> {
  return new Set(
    scan.tokens
      .filter(
        (token) => token.kind === 'identifier' || token.kind === 'keyword',
      )
      .map((token) => token.value),
  );
}

/**
 * The columns a default-filter predicate is about. Knowledge bodies are
 * often prose ("exclude claims where is_test = true from every aggregate"),
 * so with a column list the answer is "the entity's columns it names";
 * without one, the names that sit next to a comparison.
 */
export function predicateColumns(
  predicate: string,
  columns?: DatasetColumnSnapshot[],
): string[] {
  const tokens = tokenizeSql(predicate ?? '');
  if (columns?.length) {
    const names = new Set(columns.map((column) => column.name.toLowerCase()));
    return [
      ...new Set(
        tokens
          .filter((token) => token.kind !== 'string' && names.has(token.value))
          .map((token) => token.value),
      ),
    ];
  }
  const found: string[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'identifier') return;
    const after = tokens[index + 1];
    const before = tokens[index - 1];
    const compared =
      (after?.kind === 'operator' &&
        ['=', '<>', '!=', '<', '>', '<=', '>='].includes(after.value)) ||
      (after?.kind === 'keyword' &&
        ['is', 'in', 'between', 'like', 'ilike'].includes(after.value)) ||
      (before?.kind === 'keyword' && before.value === 'not');
    if (compared) found.push(token.value);
  });
  return [...new Set(found)];
}

function missingDefaultFilters(
  scan: SqlScan,
  entities: ScopeEntity[],
  filters: PrecheckContext['defaultFilters'],
): string[] {
  if (!filters.length) return [];
  const read = readEntities(scan, entities);
  if (!read.length) return [];
  const mentioned = mentionedNames(scan);
  const findings: string[] = [];
  for (const filter of filters) {
    if (!filter?.entity || !filter.predicate) continue;
    const match = matchEntity(filter.entity.toLowerCase().split('.'), read);
    if (match.status !== 'known') continue;
    const columns = predicateColumns(filter.predicate, match.entity.columns);
    if (!columns.length) continue;
    // Any mention counts: `is_test = false`, `NOT is_test`, `is_test IS
    // FALSE`, `COALESCE(is_test, false) = false` all apply the filter, and
    // grouping by it means the question is about those rows anyway.
    if (columns.some((column) => mentioned.has(column))) continue;
    const title = filter.title ? `"${filter.title}"` : 'a default filter';
    findings.push(
      `${shortEntityName(match.entity.key)} has default filter ${title} but the query never uses ${columns.join(', ')} — apply it (${clip(filter.predicate)}) unless the question asks for the excluded rows.`,
    );
  }
  return findings;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTED_CHARS
    ? `${flat.slice(0, QUOTED_CHARS - 1)}…`
    : flat;
}

/** Tokens with qualifiers dropped (`claim.status` → `status`), joined — for "does it contain the expression". */
function normalizedText(tokens: SqlToken[]): string {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (isWord(token) && isPunct(tokens[i + 1], '.') && isWord(tokens[i + 2])) {
      i += 1;
      continue;
    }
    out.push(token.kind === 'string' ? `'${token.value}'` : token.value);
  }
  return ` ${out.join(' ')} `;
}

interface MetricFeatures {
  measures: Set<string>;
  filterColumns: Set<string>;
  aggregates: Set<string>;
  literals: Set<string>;
  numbers: Set<string>;
  subtracts: boolean;
  divides: boolean;
}

function featuresOf(
  tokens: SqlToken[],
  scan: SqlScan,
  columns?: DatasetColumnSnapshot[],
): MetricFeatures {
  const names = columns?.length
    ? new Set(columns.map((c) => c.name.toLowerCase()))
    : undefined;
  const isColumn = (value: string) => (names ? names.has(value) : true);
  const measures = new Set<string>();
  const aggregates = new Set<string>();
  for (const aggregate of scan.aggregates) {
    aggregates.add(aggregate.name);
    for (let i = aggregate.open + 1; i < aggregate.close; i += 1) {
      const token = tokens[i];
      if (
        token.kind === 'identifier' &&
        !isPunct(tokens[i + 1], '.') &&
        !isPunct(tokens[i + 1], '(') &&
        isColumn(token.value)
      ) {
        measures.add(token.value);
      }
    }
  }
  const filterColumns = new Set<string>();
  for (const token of tokens) {
    if (
      token.kind === 'identifier' &&
      !measures.has(token.value) &&
      names?.has(token.value)
    ) {
      filterColumns.add(token.value);
    }
  }
  return {
    measures,
    filterColumns,
    aggregates,
    literals: new Set(
      tokens.filter((t) => t.kind === 'string').map((t) => t.value),
    ),
    numbers: new Set(
      tokens
        .filter(
          (t) => t.kind === 'number' && !['0', '1', '100'].includes(t.value),
        )
        .map((t) => t.value),
    ),
    subtracts: tokens.some((t) => t.kind === 'operator' && t.value === '-'),
    divides: tokens.some((t) => t.kind === 'operator' && t.value === '/'),
  };
}

/**
 * The statement aggregates a column a governed Metric is defined over, and
 * does it differently. Without the question this cannot know the model
 * meant *that* metric, so it only speaks when the statement engages with the
 * metric's own terms — every literal the metric filters on, or an output
 * named after it — and is missing part of its shape (its aggregate, its
 * subtraction or division, a filter column, a threshold). A statement with
 * all of the metric's parts but a different spelling (`CASE` instead of
 * `FILTER`) is treated as equivalent: unsure, so silent.
 */
function metricMismatches(
  scan: SqlScan,
  entities: ScopeEntity[],
  metrics: PrecheckContext['metrics'],
): string[] {
  if (!metrics.length || !scan.aggregates.length) return [];
  const read = readEntities(scan, entities);
  if (!read.length) return [];
  const statementText = normalizedText(scan.tokens);
  const statement = featuresOf(scan.tokens, scan);
  const outputs = [...scan.outputAliases];
  const findings: string[] = [];
  for (const metric of metrics) {
    if (!metric?.entity || !metric.expression || !metric.name) continue;
    const match = matchEntity(metric.entity.toLowerCase().split('.'), read);
    if (match.status !== 'known') continue;
    const metricScan = scanSql(`SELECT ${metric.expression}`);
    const metricTokens = metricScan.tokens.slice(1);
    const features = featuresOf(
      metricScan.tokens,
      metricScan,
      match.entity.columns,
    );
    if (!features.measures.size) continue;
    const aggregated = [...features.measures].filter((column) =>
      statement.measures.has(column),
    );
    if (!aggregated.length) continue;
    if (statementText.includes(normalizedText(metricTokens).trim())) continue;
    const slug = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    const names = [
      slug(metric.name),
      metric.label ? slug(metric.label) : '',
    ].filter(Boolean);
    const named = outputs.some((alias) =>
      names.some((name) => alias.includes(name)),
    );
    const literals = [...features.literals];
    const allLiterals =
      literals.length > 0 &&
      literals.every((value) => statement.literals.has(value));
    if (!named && !allLiterals) continue;
    const complete =
      [...features.aggregates].every((name) =>
        statement.aggregates.has(name),
      ) &&
      (!features.subtracts || statement.subtracts) &&
      (!features.divides || statement.divides) &&
      [...features.filterColumns].every(
        (column) =>
          statement.measures.has(column) ||
          scan.tokens.some((t) => t.value === column),
      ) &&
      (!literals.length ||
        literals.some((value) => statement.literals.has(value))) &&
      [...features.numbers].every((value) =>
        scan.tokens.some((t) => t.kind === 'number' && t.value === value),
      );
    if (complete) continue;
    const label =
      metric.label && metric.label !== metric.name ? ` (${metric.label})` : '';
    findings.push(
      `The query aggregates ${aggregated.join(', ')} differently from the governed Metric ${metric.name}${label}, defined as ${clip(metric.expression)} — use that definition when the question asks for ${metric.label ?? metric.name}.`,
    );
  }
  return findings;
}
