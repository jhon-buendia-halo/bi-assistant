/**
 * A LEFT JOIN keeps every row of the tables before it, whatever its ON clause
 * says. A condition on the joined table written there only turns that table's
 * columns NULL on the rows outside it. That is the point when the query reads
 * those columns (a group with no matching rows still shows, with an empty
 * measure), and it does nothing at all when no other part of the query reads
 * the table: every row outside the condition is still counted, and the result
 * looks fine.
 *
 * This finds the second shape. Heuristics only, no SQL parser, and biased
 * towards false negatives like result-guards: a subquery as the joined item,
 * an OR at the top of the ON clause, a bare name the joined table might own or
 * a SELECT * beside the join all mean "nothing to report".
 */

export interface IneffectiveJoinFilter {
  /** The join as written, from LEFT to the alias. */
  join: string;
  /** The name the rest of the query would read the table by: its alias, else its last name part. */
  alias: string;
  /** The ON-clause terms on that table alone, as written. */
  conditions: string[];
}

/**
 * `columnsOf` gives the known columns of a table as written, so that one of
 * them used without its table's name still counts as reading the table.
 */
export function ineffectiveLeftJoinFilters(
  sql: string,
  columnsOf: (table: string) => string[] = () => [],
): IneffectiveJoinFilter[] {
  // Advisory parsing: any surprise in the input degrades to "nothing to
  // report", never to a refused statement.
  try {
    const tokens = tokenize(sql);
    const groups = enclosingParens(tokens);
    const stars = starGroups(tokens, groups);
    const found: IneffectiveJoinFilter[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const join = leftJoinAt(tokens, i);
      if (!join || stars.has(groups[i])) continue;
      const known = columnsOf(sql.slice(join.tableStart, join.tableEnd));
      const finding = deadFilter(sql, tokens, join, known);
      if (finding) found.push(finding);
    }
    return found;
  } catch {
    return [];
  }
}

interface Token {
  kind: 'word' | 'quoted' | 'literal' | 'symbol';
  /** Lower-cased, quotes removed, for names; the text itself otherwise. */
  name: string;
  start: number;
  end: number;
}

interface LeftJoin {
  /** Token index of LEFT. */
  from: number;
  /** Character span of the table name as written. */
  tableStart: number;
  tableEnd: number;
  alias: Token;
  /** Token span of the ON clause's condition, end exclusive. */
  onFrom: number;
  onTo: number;
}

function deadFilter(
  sql: string,
  tokens: Token[],
  join: LeftJoin,
  known: string[],
): IneffectiveJoinFilter | null {
  const terms = conjuncts(tokens, join.onFrom, join.onTo);
  if (!terms) return null;
  const ref = join.alias.name;
  const filters: Array<[number, number]> = [];
  let joined = false;
  for (const term of terms) {
    const reads = qualifiersIn(tokens, term);
    if (reads === null) continue;
    if (reads.has(ref) && reads.size === 1) filters.push(term);
    else if (reads.has(ref)) joined = true;
  }
  // With no join condition the ON clause is a cross join with a filter: a
  // different defect, and moving the filter would not fix it.
  if (!filters.length || !joined) return null;
  const columns = ownColumns(tokens, join, ref);
  for (const column of known) columns.add(column.toLowerCase());
  if (readElsewhere(tokens, join, columns)) return null;
  return {
    join: oneLine(sql.slice(tokens[join.from].start, join.alias.end)),
    alias: sql.slice(join.alias.start, join.alias.end),
    conditions: filters.map(([from, to]) =>
      oneLine(sql.slice(tokens[from].start, tokens[to - 1].end)),
    ),
  };
}

/** LEFT [OUTER] JOIN <dotted name> [[AS] alias] ON …, or null for any other shape. */
function leftJoinAt(tokens: Token[], i: number): LeftJoin | null {
  if (!isWord(tokens[i], 'left')) return null;
  let k = i + 1;
  if (isWord(tokens[k], 'outer')) k += 1;
  if (!isWord(tokens[k], 'join')) return null;
  k += 1;
  // A subquery or a nested join as the joined item is out of scope.
  if (!isName(tokens[k])) return null;
  const tableStart = tokens[k].start;
  k = chainEnd(tokens, k);
  const tableEnd = tokens[k].end;
  let alias = tokens[k];
  k += 1;
  const explicit = isWord(tokens[k], 'as');
  if (explicit) k += 1;
  if (isName(tokens[k]) && !isWord(tokens[k], 'on')) {
    alias = tokens[k];
    k += 1;
  } else if (explicit) {
    return null;
  }
  if (!isWord(tokens[k], 'on')) return null;
  const onFrom = k + 1;
  const onTo = onClauseEnd(tokens, onFrom);
  if (onTo <= onFrom) return null;
  return { from: i, tableStart, tableEnd, alias, onFrom, onTo };
}

const ON_CLAUSE_END = new Set([
  'join',
  'inner',
  'cross',
  'full',
  'natural',
  'where',
  'group',
  'having',
  'order',
  'limit',
  'offset',
  'fetch',
  'window',
  'qualify',
  'union',
  'intersect',
  'except',
]);

function onClauseEnd(tokens: Token[], from: number): number {
  let depth = 0;
  for (let k = from; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (isSymbol(token, '(')) depth += 1;
    else if (isSymbol(token, ')')) {
      if (depth === 0) return k;
      depth -= 1;
    } else if (depth > 0) continue;
    else if (isSymbol(token, ',') || isSymbol(token, ';')) return k;
    else if (token.kind === 'word') {
      // LEFT( and RIGHT( are string functions, not the next join.
      if (token.name === 'left' || token.name === 'right') {
        if (!isSymbol(tokens[k + 1], '(')) return k;
      } else if (ON_CLAUSE_END.has(token.name)) return k;
    }
  }
  return tokens.length;
}

/** The top-level AND terms, or null when an OR at the top makes them a choice. */
function conjuncts(
  tokens: Token[],
  from: number,
  to: number,
): Array<[number, number]> | null {
  const terms: Array<[number, number]> = [];
  let depth = 0;
  let betweens = 0;
  let start = from;
  for (let k = from; k < to; k += 1) {
    const token = tokens[k];
    if (isSymbol(token, '(') || isWord(token, 'case')) depth += 1;
    else if (isSymbol(token, ')') || isWord(token, 'end')) depth -= 1;
    else if (depth > 0) continue;
    else if (isWord(token, 'or')) return null;
    else if (isWord(token, 'between')) betweens += 1;
    else if (isWord(token, 'and')) {
      // The AND of BETWEEN x AND y belongs to it, not to the ON clause.
      if (betweens > 0) {
        betweens -= 1;
        continue;
      }
      if (k > start) terms.push([start, k]);
      start = k + 1;
    }
  }
  if (to > start) terms.push([start, to]);
  return terms;
}

/** Words a condition on one table's columns may hold besides its columns, literals and calls. */
const CONDITION_WORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'unknown',
  'between',
  'symmetric',
  'like',
  'ilike',
  'rlike',
  'regexp',
  'similar',
  'to',
  'escape',
  'distinct',
  'from',
  'as',
  'any',
  'all',
  'some',
  'case',
  'when',
  'then',
  'else',
  'end',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'interval',
  'with',
  'without',
  'zone',
  'at',
  'current_date',
  'current_time',
  'current_timestamp',
  'localtime',
  'localtimestamp',
  'year',
  'quarter',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
  'int',
  'integer',
  'bigint',
  'smallint',
  'numeric',
  'decimal',
  'real',
  'double',
  'precision',
  'float',
  'text',
  'varchar',
  'char',
  'character',
  'varying',
  'string',
  'boolean',
  'bool',
]);

/**
 * The tables a term reads its columns from, by the part before the last dot.
 * Null when it holds a bare name that is neither a keyword nor a call: that
 * may be any table's column, so the term cannot be told apart.
 */
function qualifiersIn(
  tokens: Token[],
  [from, to]: [number, number],
): Set<string> | null {
  const qualifiers = new Set<string>();
  for (let k = from; k < to; k += 1) {
    const token = tokens[k];
    if (!isName(token)) continue;
    const end = chainEnd(tokens, k);
    const call = isSymbol(tokens[end + 1], '(');
    if (end > k && !call) qualifiers.add(tokens[end - 2].name);
    else if (
      !call &&
      !isSymbol(tokens[k - 1], '::') &&
      !(token.kind === 'word' && CONDITION_WORDS.has(token.name))
    ) {
      return null;
    }
    k = end;
  }
  return qualifiers;
}

/** The columns the ON clause reads from the joined table. */
function ownColumns(tokens: Token[], join: LeftJoin, ref: string): Set<string> {
  const columns = new Set<string>();
  for (let k = join.onFrom; k < join.onTo; k += 1) {
    if (!isName(tokens[k])) continue;
    const end = chainEnd(tokens, k);
    if (end > k && tokens[end - 2].name === ref) columns.add(tokens[end].name);
    k = end;
  }
  return columns;
}

/**
 * Whether anything outside the join reads the table: its name anywhere, or a
 * bare name one of its columns has (an unqualified column may be its own).
 */
function readElsewhere(
  tokens: Token[],
  join: LeftJoin,
  columns: Set<string>,
): boolean {
  for (let k = 0; k < tokens.length; k += 1) {
    if (k >= join.from && k < join.onTo) continue;
    const token = tokens[k];
    if (!isName(token)) continue;
    if (token.name === join.alias.name) return true;
    if (columns.has(token.name) && !isSymbol(tokens[k - 1], '.')) return true;
  }
  return false;
}

/** For each token, the index of the innermost open paren around it; -1 at the top. */
function enclosingParens(tokens: Token[]): number[] {
  const open: number[] = [];
  return tokens.map((token, k) => {
    if (isSymbol(token, ')')) open.pop();
    const group = open.length ? open[open.length - 1] : -1;
    if (isSymbol(token, '(')) open.push(k);
    return group;
  });
}

/**
 * The paren groups holding a SELECT *: it returns the joined tables' columns,
 * NULL outside the condition, so a join in the same group is read.
 */
function starGroups(tokens: Token[], groups: number[]): Set<number> {
  const found = new Set<number>();
  tokens.forEach((token, k) => {
    if (
      isSymbol(token, '*') &&
      (isSymbol(tokens[k - 1], ',') ||
        isWord(tokens[k - 1], 'select') ||
        isWord(tokens[k - 1], 'distinct') ||
        isWord(tokens[k - 1], 'all'))
    ) {
      found.add(groups[k]);
    }
  });
  return found;
}

/** The index of the last part of the dotted name starting at k. */
function chainEnd(tokens: Token[], k: number): number {
  let end = k;
  while (
    isSymbol(tokens[end + 1], '.') &&
    (isName(tokens[end + 2]) || isSymbol(tokens[end + 2], '*'))
  ) {
    end += 2;
  }
  return end;
}

function isName(token: Token | undefined): boolean {
  return token?.kind === 'word' || token?.kind === 'quoted';
}

function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === 'word' && token.name === word;
}

function isSymbol(token: Token | undefined, symbol: string): boolean {
  return token?.kind === 'symbol' && token.name === symbol;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
const NUMBER = /\d+(\.\d+)?([eE][+-]?\d+)?/y;

/** Names, quoted names, literals and symbols; comments and whitespace dropped. */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close < 0 ? sql.length : close + 2;
    } else if (ch === "'") {
      const end = quotedEnd(sql, i);
      tokens.push({ kind: 'literal', name: sql.slice(i, end), start: i, end });
      i = end;
    } else if (ch === '"' || ch === '`') {
      const end = quotedEnd(sql, i);
      const name = sql.slice(i + 1, end - 1).toLowerCase();
      tokens.push({ kind: 'quoted', name, start: i, end });
      i = end;
    } else if (/[A-Za-z_]/.test(ch)) {
      WORD.lastIndex = i;
      const word = WORD.exec(sql)?.[0] ?? ch;
      const end = i + word.length;
      tokens.push({ kind: 'word', name: word.toLowerCase(), start: i, end });
      i = end;
    } else if (/\d/.test(ch)) {
      NUMBER.lastIndex = i;
      const number = NUMBER.exec(sql)?.[0] ?? ch;
      const end = i + number.length;
      tokens.push({ kind: 'literal', name: number, start: i, end });
      i = end;
    } else if (ch === ':' && sql[i + 1] === ':') {
      tokens.push({ kind: 'symbol', name: '::', start: i, end: i + 2 });
      i += 2;
    } else {
      tokens.push({ kind: 'symbol', name: ch, start: i, end: i + 1 });
      i += 1;
    }
  }
  return tokens;
}

/** End (exclusive) of the quoted text opening at i; a doubled quote stays inside. */
function quotedEnd(sql: string, i: number): number {
  const quote = sql[i];
  let k = i + 1;
  while (k < sql.length) {
    if (quote === "'" && sql[k] === '\\' && k + 1 < sql.length) {
      k += 2;
      continue;
    }
    if (sql[k] === quote) {
      if (sql[k + 1] === quote) {
        k += 2;
        continue;
      }
      return k + 1;
    }
    k += 1;
  }
  return sql.length;
}
