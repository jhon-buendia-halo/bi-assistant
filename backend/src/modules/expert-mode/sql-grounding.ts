/**
 * Best-effort, dependency-free reading of one SQL statement for business
 * expert mode: which bound dataset entities it reads, which qualified columns
 * it touches, and which `JOIN … ON a.x = b.y` pairs it makes — plus the checks
 * the confidence signals are built from (does the table / column exist in the
 * session's datasets, does the join follow a declared or inferred edge).
 *
 * This is not a SQL parser. It tokenizes, recognises the handful of shapes
 * that carry table and join information (FROM / JOIN targets with aliases,
 * CTE names, ON / USING conditions) and ignores everything else. Two rules:
 *
 * - Never throw. A statement it cannot read yields fewer references, never an
 *   exception — the trace must not fail because of an unusual query.
 * - Unknown is not wrong. A reference it cannot resolve (a CTE column, a
 *   derived-table alias, an entity whose columns were never snapshotted) is
 *   left out of the measurement rather than counted as missing, because the
 *   final SQL executed successfully: everything it names exists somewhere.
 *   What the checks measure is whether it exists in the *session's* datasets.
 */

export interface GroundingColumn {
  name: string;
  references?: { entity: string; column: string; source?: string };
}

export interface GroundingEntity {
  /** Fully-qualified `catalog.schema.table`. */
  key: string;
  columns: GroundingColumn[];
}

/** One join equality between two bound entities, as written in the SQL. */
export interface SqlJoin {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  /** The pair matches a declared or inferred `references` edge, either direction. */
  grounded: boolean;
}

export interface SqlGrounding {
  /** Bound entity keys the statement reads, first-seen order, deduplicated. */
  entities: string[];
  /** FROM / JOIN targets that are neither a CTE nor a bound entity. */
  unknownTables: string[];
  /** Names of the statement's common table expressions. */
  ctes: string[];
  /** Distinct qualified column references whose entity has a column snapshot. */
  columns: { entity: string; column: string; exists: boolean }[];
  /** Columns used per bound entity (qualified references and USING lists). */
  columnsByEntity: Record<string, string[]>;
  /** Join pairs whose both sides resolve to bound entities. */
  joins: SqlJoin[];
  /** Join pairs with a side that is a CTE / derived table / unknown table. */
  unverifiableJoins: number;
}

// ------------------------------------------------------------- tokenizer

type Item =
  | { t: 'kw'; v: string }
  | { t: 'name'; parts: string[]; star: boolean }
  | { t: 'p'; v: string }
  | { t: 'lit' };

/** Structural words — never a table alias, never part of a bare name. */
const KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'NATURAL',
  'LATERAL',
  'ON',
  'USING',
  'WHERE',
  'GROUP',
  'BY',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'MINUS',
  'ALL',
  'DISTINCT',
  'AS',
  'WITH',
  'RECURSIVE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'OVER',
  'PARTITION',
  'WINDOW',
  'QUALIFY',
  'VALUES',
  'BETWEEN',
  'LIKE',
  'ILIKE',
  'RLIKE',
  'EXISTS',
  'TRUE',
  'FALSE',
  'INTERVAL',
  'FILTER',
  'ASC',
  'DESC',
  'NULLS',
  'ANY',
  'SOME',
  'MATERIALIZED',
  'TABLESAMPLE',
  'PIVOT',
  'UNPIVOT',
  'CAST',
]);

/** Keywords that end an ON condition at its own nesting level. */
const ON_TERMINATORS = new Set([
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'NATURAL',
  'WHERE',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'MINUS',
  'WINDOW',
  'QUALIFY',
  'OFFSET',
  'FETCH',
]);

/** Functions whose argument list uses FROM as a separator, not a clause. */
const FROM_ARGUMENT_FUNCTIONS = new Set([
  'extract',
  'substring',
  'substr',
  'trim',
  'overlay',
]);

const MULTI_CHAR_OPERATORS = [
  '::',
  '>=',
  '<=',
  '<>',
  '!=',
  '||',
  '->>',
  '->',
  '=>',
];

/** Raw lexing: comments dropped, literals collapsed, identifiers kept. */
function lex(
  sql: string,
): (
  | { k: 'word'; v: string }
  | { k: 'quoted'; v: string }
  | { k: 'lit' }
  | { k: 'p'; v: string }
)[] {
  const out: (
    | { k: 'word'; v: string }
    | { k: 'quoted'; v: string }
    | { k: 'lit' }
    | { k: 'p'; v: string }
  )[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out.push({ k: 'lit' });
      continue;
    }
    if (c === '"' || c === '`') {
      let j = i + 1;
      let value = '';
      while (j < n) {
        if (sql[j] === c && sql[j + 1] === c) {
          value += c;
          j += 2;
        } else if (sql[j] === c) break;
        else value += sql[j++];
      }
      out.push({ k: 'quoted', v: value });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      out.push({ k: 'word', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9.eE]/.test(sql[j])) j++;
      out.push({ k: 'lit' });
      i = j;
      continue;
    }
    const operator = MULTI_CHAR_OPERATORS.find((op) => sql.startsWith(op, i));
    if (operator) {
      out.push({ k: 'p', v: operator });
      i += operator.length;
      continue;
    }
    out.push({ k: 'p', v: c });
    i++;
  }
  return out;
}

/** Lexemes grouped into keywords, dotted names, punctuation and literals. */
function tokenize(sql: string): Item[] {
  const raw = lex(sql);
  const items: Item[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (token.k === 'lit') {
      items.push({ t: 'lit' });
      continue;
    }
    if (token.k === 'p') {
      items.push({ t: 'p', v: token.v });
      continue;
    }
    const followedByDot =
      raw[i + 1]?.k === 'p' && (raw[i + 1] as { v: string }).v === '.';
    if (
      token.k === 'word' &&
      KEYWORDS.has(token.v.toUpperCase()) &&
      !followedByDot
    ) {
      items.push({ t: 'kw', v: token.v.toUpperCase() });
      continue;
    }
    const parts = [token.v.toLowerCase()];
    let star = false;
    while (
      raw[i + 1]?.k === 'p' &&
      (raw[i + 1] as { v: string }).v === '.' &&
      raw[i + 2]
    ) {
      const next = raw[i + 2];
      if (next.k === 'word' || next.k === 'quoted') {
        parts.push(next.v.toLowerCase());
        i += 2;
      } else if (next.k === 'p' && next.v === '*') {
        star = true;
        i += 2;
        break;
      } else break;
    }
    items.push({ t: 'name', parts, star });
  }
  return items;
}

const isP = (item: Item | undefined, v: string): boolean =>
  item?.t === 'p' && item.v === v;
const isKw = (item: Item | undefined, v: string): boolean =>
  item?.t === 'kw' && item.v === v;
const isSimpleName = (
  item: Item | undefined,
): item is { t: 'name'; parts: string[]; star: boolean } =>
  item?.t === 'name' && item.parts.length === 1 && !item.star;

/** Index of the `)` matching the `(` at `open`, or the last index. */
function matching(items: Item[], open: number): number {
  let depth = 0;
  for (let i = open; i < items.length; i++) {
    if (isP(items[i], '(')) depth++;
    else if (isP(items[i], ')')) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return items.length - 1;
}

// -------------------------------------------------------------- resolution

/** Split a dotted, possibly quoted entity name into lower-cased parts. */
export function nameParts(name: string): string[] {
  return (name ?? '')
    .split('.')
    .map((part) =>
      part
        .trim()
        .replace(/^["`[]|["`\]]$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean);
}

/**
 * Resolve a (possibly partial) dotted name against the bound entity keys by
 * suffix: `hr.employees` and `world_cup.hr.employees` both find
 * `world_cup.hr.employees`. A bare table name resolves too. The exact key
 * wins over a suffix match; otherwise the first match in key order.
 */
export function resolveEntityKey(
  name: string | string[],
  keys: string[],
): string | undefined {
  const parts = Array.isArray(name) ? name : nameParts(name);
  if (!parts.length) return undefined;
  let suffixMatch: string | undefined;
  for (const key of keys) {
    const keyParts = nameParts(key);
    if (keyParts.length < parts.length) continue;
    const tail = keyParts.slice(keyParts.length - parts.length);
    if (!tail.every((part, index) => part === parts[index])) continue;
    if (keyParts.length === parts.length) return key;
    suffixMatch ??= key;
  }
  return suffixMatch;
}

/** Does a declared/inferred edge link `a.x` and `b.y`, in either direction? */
export function joinIsGrounded(
  a: { entity: string; column: string },
  b: { entity: string; column: string },
  entities: GroundingEntity[],
): boolean {
  const points = (
    from: { entity: string; column: string },
    to: { entity: string; column: string },
  ): boolean => {
    const entity = entities.find(
      (e) => e.key.toLowerCase() === from.entity.toLowerCase(),
    );
    const column = entity?.columns.find(
      (c) => c.name.toLowerCase() === from.column.toLowerCase(),
    );
    const reference = column?.references;
    if (!reference?.entity || !reference.column) return false;
    return (
      reference.column.toLowerCase() === to.column.toLowerCase() &&
      (reference.entity.toLowerCase() === to.entity.toLowerCase() ||
        resolveEntityKey(reference.entity, [to.entity]) === to.entity)
    );
  };
  return points(a, b) || points(b, a);
}

// ----------------------------------------------------------------- analysis

type Target =
  | { kind: 'entity'; key: string }
  | { kind: 'cte' }
  | { kind: 'derived' }
  | { kind: 'unknown' };

interface TableRef {
  parts: string[];
  alias?: string;
  target: Target;
}

interface RawPair {
  left: { qualifier: string; column: string };
  right: { qualifier: string; column: string };
}

/** Common table expression names declared by `WITH … AS (…)` lists. */
function cteNames(items: Item[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!isKw(items[i], 'WITH')) continue;
    let j = i + 1;
    if (isKw(items[j], 'RECURSIVE')) j++;
    for (;;) {
      const item = items[j];
      if (!isSimpleName(item)) break;
      let k = j + 1;
      if (isP(items[k], '(')) k = matching(items, k) + 1;
      if (!isKw(items[k], 'AS')) break;
      k++;
      if (isKw(items[k], 'NOT')) k++;
      if (isKw(items[k], 'MATERIALIZED')) k++;
      if (!isP(items[k], '(')) break;
      names.push(item.parts[0]);
      k = matching(items, k) + 1;
      if (!isP(items[k], ',')) break;
      j = k + 1;
    }
  }
  return names;
}

/**
 * Read one statement. Pure and total: any input, including garbage, returns a
 * (possibly empty) grounding.
 */
export function analyzeSql(
  sql: string,
  entities: GroundingEntity[],
): SqlGrounding {
  const empty: SqlGrounding = {
    entities: [],
    unknownTables: [],
    ctes: [],
    columns: [],
    columnsByEntity: {},
    joins: [],
    unverifiableJoins: 0,
  };
  try {
    return analyze(sql ?? '', entities ?? []);
  } catch {
    return empty;
  }
}

function analyze(sql: string, entities: GroundingEntity[]): SqlGrounding {
  const items = tokenize(sql);
  const keys = entities.map((e) => e.key);
  const ctes = cteNames(items);
  const cteSet = new Set(ctes);
  const refs: TableRef[] = [];
  const pairs: RawPair[] = [];
  /** Name items consumed as table targets or aliases — not column refs. */
  const consumed = new Set<number>();

  const targetFor = (parts: string[]): Target => {
    if (parts.length === 1 && cteSet.has(parts[0])) return { kind: 'cte' };
    const key = resolveEntityKey(parts, keys);
    return key ? { kind: 'entity', key } : { kind: 'unknown' };
  };

  /** `[AS] alias [(col, …)]` starting at `k`; returns the index after it. */
  const readAlias = (k: number, ref: TableRef): number => {
    let at = k;
    if (isKw(items[at], 'AS')) at++;
    const item = items[at];
    if (isSimpleName(item) && !isP(items[at + 1], '.')) {
      ref.alias = item.parts[0];
      consumed.add(at);
      at++;
      if (isP(items[at], '(')) at = matching(items, at) + 1;
      return at;
    }
    return k;
  };

  /** One FROM / JOIN target at `i`; returns the index after it (and its alias). */
  const readTarget = (i: number): { next: number; ref?: TableRef } => {
    let at = i;
    if (isKw(items[at], 'LATERAL')) at++;
    const item = items[at];
    if (isP(item, '(')) {
      const ref: TableRef = { parts: [], target: { kind: 'derived' } };
      const next = readAlias(matching(items, at) + 1, ref);
      refs.push(ref);
      return { next, ref };
    }
    if (item?.t !== 'name' || item.star) return { next: at };
    consumed.add(at);
    if (isP(items[at + 1], '(')) {
      // Table function (`unnest(…)`, `generate_series(…)`): rows, not an entity.
      const ref: TableRef = { parts: [], target: { kind: 'derived' } };
      const next = readAlias(matching(items, at + 1) + 1, ref);
      refs.push(ref);
      return { next, ref };
    }
    const ref: TableRef = { parts: item.parts, target: targetFor(item.parts) };
    const next = readAlias(at + 1, ref);
    refs.push(ref);
    return { next, ref };
  };

  /** Equalities of two qualified columns inside `[start, end)`. */
  const readEqualities = (start: number, end: number): void => {
    const operand = (index: number, before: boolean) => {
      let at = index;
      // `a.x::text = …` — step over a cast on the left-hand side.
      if (before && items[at]?.t === 'name' && isP(items[at - 1], '::')) {
        at -= 2;
      }
      const item = items[at];
      if (item?.t !== 'name' || item.star || item.parts.length < 2) {
        return undefined;
      }
      if (!before && isP(items[at + 1], '(')) return undefined;
      return {
        qualifier: item.parts.slice(0, -1).join('.'),
        column: item.parts[item.parts.length - 1],
      };
    };
    for (let m = start; m < end; m++) {
      if (!isP(items[m], '=')) continue;
      const left = operand(m - 1, true);
      const right = operand(m + 1, false);
      if (left && right && left.qualifier !== right.qualifier) {
        pairs.push({ left, right });
      }
    }
  };

  /** Indices of the ON condition that starts after `on`. */
  const onConditionEnd = (on: number): number => {
    let depth = 0;
    let k = on + 1;
    for (; k < items.length; k++) {
      const item = items[k];
      if (isP(item, '(')) depth++;
      else if (isP(item, ')')) {
        if (depth === 0) break;
        depth--;
      } else if (isP(item, ';')) break;
      else if (depth === 0 && item.t === 'kw' && ON_TERMINATORS.has(item.v)) {
        break;
      }
    }
    return k;
  };

  const openers: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isP(item, '(')) {
      const before = items[i - 1];
      openers.push(before?.t === 'name' ? before.parts.join('.') : '');
      continue;
    }
    if (isP(item, ')')) {
      openers.pop();
      continue;
    }
    if (isKw(item, 'FROM')) {
      if (FROM_ARGUMENT_FUNCTIONS.has(openers.at(-1) ?? '')) continue;
      // `a IS [NOT] DISTINCT FROM b` is a comparison.
      if (isKw(items[i - 1], 'DISTINCT')) continue;
      let next = readTarget(i + 1).next;
      while (isP(items[next], ',')) next = readTarget(next + 1).next;
      continue;
    }
    if (isKw(item, 'JOIN')) {
      const previous = refs.at(-1);
      const { next, ref } = readTarget(i + 1);
      if (
        ref &&
        previous &&
        isKw(items[next], 'USING') &&
        isP(items[next + 1], '(')
      ) {
        const close = matching(items, next + 1);
        const leftQualifier = previous.alias ?? previous.parts.join('.');
        const rightQualifier = ref.alias ?? ref.parts.join('.');
        for (let k = next + 2; k < close; k++) {
          const column = items[k];
          if (!isSimpleName(column) || !leftQualifier || !rightQualifier) {
            continue;
          }
          consumed.add(k);
          pairs.push({
            left: { qualifier: leftQualifier, column: column.parts[0] },
            right: { qualifier: rightQualifier, column: column.parts[0] },
          });
        }
      }
      continue;
    }
    if (isKw(item, 'ON')) {
      // Postgres `SELECT DISTINCT ON (…)` is not a join condition.
      if (isKw(items[i - 1], 'DISTINCT')) continue;
      readEqualities(i + 1, onConditionEnd(i));
    }
  }

  // Alias map: explicit aliases first, then each table's own names.
  const aliases = new Map<string, Target>();
  for (const ref of refs) {
    if (ref.alias && !aliases.has(ref.alias))
      aliases.set(ref.alias, ref.target);
  }
  for (const ref of refs) {
    if (!ref.parts.length) continue;
    const full = ref.parts.join('.');
    if (!aliases.has(full)) aliases.set(full, ref.target);
    const last = ref.parts[ref.parts.length - 1];
    if (!aliases.has(last)) aliases.set(last, ref.target);
  }
  for (const cte of ctes)
    if (!aliases.has(cte)) aliases.set(cte, { kind: 'cte' });

  const resolveQualifier = (qualifier: string): Target | undefined => {
    const known = aliases.get(qualifier);
    if (known) return known;
    const key = resolveEntityKey(qualifier.split('.'), keys);
    return key ? { kind: 'entity', key } : undefined;
  };

  const entityByKey = new Map(entities.map((e) => [e.key, e]));
  const referenced: string[] = [];
  const unknownTables: string[] = [];
  for (const ref of refs) {
    if (ref.target.kind === 'entity' && !referenced.includes(ref.target.key)) {
      referenced.push(ref.target.key);
    }
    if (ref.target.kind === 'unknown') {
      const raw = ref.parts.join('.');
      if (!unknownTables.includes(raw)) unknownTables.push(raw);
    }
  }

  const columnsByEntity: Record<string, string[]> = {};
  const addUsed = (key: string, column: string) => {
    const known = entityByKey
      .get(key)
      ?.columns.find((c) => c.name.toLowerCase() === column);
    const name = known?.name ?? column;
    const list = (columnsByEntity[key] ??= []);
    if (!list.includes(name)) list.push(name);
  };

  const columns: SqlGrounding['columns'] = [];
  const seenColumns = new Set<string>();
  items.forEach((item, index) => {
    if (item.t !== 'name' || item.star || item.parts.length < 2) return;
    if (consumed.has(index) || isP(items[index + 1], '(')) return;
    const qualifier = item.parts.slice(0, -1).join('.');
    const column = item.parts[item.parts.length - 1];
    const target = resolveQualifier(qualifier);
    if (target?.kind !== 'entity') return;
    addUsed(target.key, column);
    const snapshot = entityByKey.get(target.key);
    if (!snapshot?.columns.length) return;
    const id = `${target.key}|${column}`;
    if (seenColumns.has(id)) return;
    seenColumns.add(id);
    columns.push({
      entity: target.key,
      column:
        snapshot.columns.find((c) => c.name.toLowerCase() === column)?.name ??
        column,
      exists: snapshot.columns.some((c) => c.name.toLowerCase() === column),
    });
  });

  const joins: SqlJoin[] = [];
  let unverifiableJoins = 0;
  const seenJoins = new Set<string>();
  for (const pair of pairs) {
    const left = resolveQualifier(pair.left.qualifier);
    const right = resolveQualifier(pair.right.qualifier);
    if (left?.kind !== 'entity' || right?.kind !== 'entity') {
      unverifiableJoins++;
      continue;
    }
    const canonical = (key: string, column: string) =>
      entityByKey.get(key)?.columns.find((c) => c.name.toLowerCase() === column)
        ?.name ?? column;
    const join: SqlJoin = {
      from: left.key,
      fromColumn: canonical(left.key, pair.left.column),
      to: right.key,
      toColumn: canonical(right.key, pair.right.column),
      grounded: false,
    };
    const id = [
      `${join.from}.${join.fromColumn}`,
      `${join.to}.${join.toColumn}`,
    ]
      .map((side) => side.toLowerCase())
      .sort()
      .join('=');
    if (seenJoins.has(id)) continue;
    seenJoins.add(id);
    addUsed(join.from, pair.left.column);
    addUsed(join.to, pair.right.column);
    join.grounded = joinIsGrounded(
      { entity: join.from, column: join.fromColumn },
      { entity: join.to, column: join.toColumn },
      entities,
    );
    joins.push(join);
  }

  return {
    entities: referenced,
    unknownTables,
    ctes,
    columns,
    columnsByEntity,
    joins,
    unverifiableJoins,
  };
}

// ------------------------------------------------------ verbatim clauses

/**
 * Find `fragment` inside `sql` ignoring case and whitespace differences, and
 * return the matching piece of `sql` itself — verbatim, so the UI can
 * highlight it with a plain substring search. First pass collapses
 * whitespace runs; the fallback ignores whitespace entirely (`a.x=b.y` finds
 * `a.x = b.y`). `undefined` when the fragment is not in the statement.
 */
export function locateVerbatim(
  sql: string,
  fragment: string,
): string | undefined {
  const needle = (fragment ?? '').trim();
  if (!sql || !needle) return undefined;
  for (const mode of ['collapse', 'strip'] as const) {
    const haystack = projection(sql, mode);
    const target = projection(needle, mode).text;
    if (!target) continue;
    const at = haystack.text.indexOf(target);
    if (at < 0) continue;
    const start = haystack.origin[at];
    const end = haystack.origin[at + target.length - 1] + 1;
    return sql.slice(start, end).trim();
  }
  return undefined;
}

/** Lower-cased, whitespace-normalised copy of `text` with an index map back. */
function projection(
  text: string,
  mode: 'collapse' | 'strip',
): { text: string; origin: number[] } {
  let out = '';
  const origin: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      pendingSpace = mode === 'collapse' && out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      origin.push(i - 1);
      pendingSpace = false;
    }
    // Lower-casing can lengthen a character; map every produced unit back.
    for (const unit of c.toLowerCase()) {
      out += unit;
      origin.push(i);
    }
  }
  return { text: out, origin };
}
