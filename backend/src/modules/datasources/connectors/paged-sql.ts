/**
 * The paged, filtered and sorted read of a stored query's result
 * (datasources R52, ADR-0050, plan docs/plans/m1-28-result-explorer.md 1).
 * Pure: the stored SQL goes through the read-only guard once, the wrapper
 * around it is code, its identifiers checked against the result's columns
 * and quoted per dialect, its values bound as parameters, LIMIT and OFFSET
 * checked integers.
 */
import { BadRequestException } from '@nestjs/common';
import { cleanReadOnlySql } from './connector';
import {
  FILTER_OPS,
  FILTERS_MAX,
  FILTER_VALUES_MAX,
  PAGE_MAX_ROWS,
  PAGE_SIZE_MAX,
  SORT_KEYS_MAX,
  type ColumnKind,
  type FilterSpec,
  type FilterValue,
  type PagedRows,
  type PagedStatement,
} from './paged-sql.types';
import {
  maskLiterals,
  outerLimit,
  topLevel,
  withExportLimit,
  withoutTrailingFraming,
} from './sql-text';

export type SqlDialect = 'postgres' | 'databricks' | 'sqlite';

/** The window total's alias; stripped from the page before it leaves the connector. */
export const TOTAL_COLUMN = '__qti_total';

/** The statements of one page and the parameters both of them bind. */
export interface PagedSql {
  /** The page, with `COUNT(*) OVER ()` as `TOTAL_COLUMN`. */
  text: string;
  /** The matching rows' count alone, for a page past the end. */
  countText: string;
  /** Bound in order: `$n`, `:pN` (N = index + 1) or `?`. */
  params: (FilterValue | number)[];
}

interface Dialect {
  quote(identifier: string): string;
  placeholder(n: number): string;
  /** A text parameter as the dialect can lower it. */
  textParam(placeholder: string): string;
  textType: string;
  likeEscape: string;
  /** SQLite binds no booleans. */
  bind(value: FilterValue): FilterValue | number;
}

const doubleQuote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const asIs = (value: FilterValue) => value;

const DIALECTS: Record<SqlDialect, Dialect> = {
  postgres: {
    quote: doubleQuote,
    placeholder: (n) => `$${n}`,
    // `LOWER($n)` alone is ambiguous to Postgres (text or range).
    textParam: (p) => `CAST(${p} AS TEXT)`,
    textType: 'TEXT',
    likeEscape: '',
    bind: asIs,
  },
  databricks: {
    quote: (id) => `\`${id.replace(/`/g, '``')}\``,
    placeholder: (n) => `:p${n}`,
    textParam: (p) => p,
    textType: 'STRING',
    likeEscape: '',
    bind: asIs,
  },
  sqlite: {
    quote: doubleQuote,
    placeholder: () => '?',
    textParam: (p) => p,
    textType: 'TEXT',
    // SQLite's LIKE has no default escape character.
    likeEscape: " ESCAPE '\\'",
    bind: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
  },
};

function bad(message: string): BadRequestException {
  return new BadRequestException(message);
}

/** The one column `name` names, or the api.md 400. */
function columnOf(columns: string[], name: unknown): string {
  const count = columns.filter((c) => c === name).length;
  if (typeof name !== 'string' || count === 0) {
    throw bad(`Unknown column "${String(name)}"`);
  }
  if (count > 1) {
    throw bad(
      `Column "${name}" appears more than once in the result; it cannot be filtered or sorted`,
    );
  }
  return name;
}

function missing(value: unknown): boolean {
  return value === undefined || value === null;
}

/** `value` as the column's kind stores it, or a 400 before any query. */
function coerce(
  column: string,
  kind: ColumnKind,
  value: FilterValue,
): FilterValue {
  const shown = `Filter on ${column}: "${String(value)}"`;
  switch (kind) {
    case 'number': {
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim()
            ? Number(value.trim())
            : NaN;
      if (!Number.isFinite(n)) throw bad(`${shown} is not a number`);
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const text = String(value).trim().toLowerCase();
      if (text === 'true' || text === '1') return true;
      if (text === 'false' || text === '0') return false;
      throw bad(`${shown} is not true or false`);
    }
    case 'date': {
      if (typeof value === 'boolean') throw bad(`${shown} is not a date`);
      const text = typeof value === 'string' ? value.trim() : '';
      const time = typeof value === 'number' ? value : Date.parse(text);
      if (!Number.isFinite(time)) throw bad(`${shown} is not a date`);
      // An ISO date keeps its own precision; anything else becomes ISO.
      return /^\d{4}-\d{2}-\d{2}/.test(text)
        ? text
        : new Date(time).toISOString();
    }
    case 'text':
      return String(value);
    default:
      return value;
  }
}

/** `%`, `_` and the escape itself, escaped for LIKE with `\`. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

class Compiler {
  readonly params: (FilterValue | number)[] = [];

  constructor(
    private readonly d: Dialect,
    private readonly stmt: PagedStatement,
  ) {}

  private param(value: FilterValue): string {
    this.params.push(this.d.bind(value));
    return this.d.placeholder(this.params.length);
  }

  private lowered(id: string): string {
    return `LOWER(CAST(${id} AS ${this.d.textType}))`;
  }

  private loweredParam(value: FilterValue): string {
    return `LOWER(${this.d.textParam(this.param(value))})`;
  }

  predicate(filter: FilterSpec): string {
    const column = columnOf(this.stmt.columns, filter?.column);
    const { op } = filter;
    if (!FILTER_OPS.includes(op)) {
      throw bad(`Filter on ${column}: unknown operator "${String(op)}"`);
    }
    const needs = () => bad(`Filter on ${column}: ${op} needs a value`);
    const id = this.d.quote(column);
    const kind = this.stmt.kinds?.[column] ?? 'unknown';
    const value = (v: FilterValue) => coerce(column, kind, v);
    const textual = (values: FilterValue[]) =>
      kind === 'text' ||
      (kind === 'unknown' && values.every((v) => typeof v === 'string'));
    const keepNulls = (expr: string) => `(${expr} OR ${id} IS NULL)`;

    switch (op) {
      case 'is_null':
        return `${id} IS NULL`;
      case 'not_null':
        return `${id} IS NOT NULL`;
      case 'contains':
      case 'not_contains':
      case 'starts_with': {
        if (missing(filter.value) || filter.value === '') throw needs();
        const text = likeLiteral(String(filter.value));
        const pattern = op === 'starts_with' ? `${text}%` : `%${text}%`;
        const like = `${this.lowered(id)} ${op === 'not_contains' ? 'NOT LIKE' : 'LIKE'} ${this.loweredParam(pattern)}${this.d.likeEscape}`;
        return op === 'not_contains' ? keepNulls(like) : like;
      }
      case 'between': {
        if (missing(filter.value) || missing(filter.valueTo)) throw needs();
        const from = this.param(value(filter.value as FilterValue));
        const to = this.param(value(filter.valueTo as FilterValue));
        return `${id} BETWEEN ${from} AND ${to}`;
      }
      case 'in':
      case 'not_in': {
        const raw = filter.values;
        if (!Array.isArray(raw) || !raw.length || raw.some(missing)) {
          throw needs();
        }
        if (raw.length > FILTER_VALUES_MAX) {
          throw bad(
            `Filter on ${column}: ${op} takes at most ${FILTER_VALUES_MAX} values`,
          );
        }
        const values = raw.map(value);
        const list = textual(values)
          ? `${this.lowered(id)} ${op === 'in' ? 'IN' : 'NOT IN'} (${values.map((v) => this.loweredParam(v)).join(', ')})`
          : `${id} ${op === 'in' ? 'IN' : 'NOT IN'} (${values.map((v) => this.param(v)).join(', ')})`;
        return op === 'in' ? list : keepNulls(list);
      }
      default: {
        if (missing(filter.value)) throw needs();
        const v = value(filter.value as FilterValue);
        if (op === 'eq' || op === 'neq') {
          const sign = op === 'eq' ? '=' : '<>';
          const cmp = textual([v])
            ? `${this.lowered(id)} ${sign} ${this.loweredParam(v)}`
            : `${id} ${sign} ${this.param(v)}`;
          return op === 'eq' ? cmp : keepNulls(cmp);
        }
        const sign = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
        return `${id} ${sign} ${this.param(v)}`;
      }
    }
  }
}

interface OrderKey {
  /** 1-based column ordinal. */
  ordinal: number;
  direction: 'ASC' | 'DESC';
  nulls?: 'NULLS FIRST' | 'NULLS LAST';
}

const STORED_KEY =
  /^(?:(\d+)|"((?:[^"]|"")+)"|`((?:[^`]|``)+)`|([A-Za-z_][A-Za-z0-9_$]*))(?:\s+(asc|desc))?(?:\s+nulls\s+(first|last))?$/i;

/** The 1-based ordinal of the one column a stored ORDER BY key names. */
function ordinalOf(key: RegExpExecArray, columns: string[]): number {
  const [, ordinal, dquoted, bquoted, bare] = key;
  if (ordinal !== undefined) {
    const n = Number(ordinal);
    return n >= 1 && n <= columns.length ? n : 0;
  }
  const quoted =
    dquoted?.replace(/""/g, '"') ?? bquoted?.replace(/``/g, '`') ?? undefined;
  const name = quoted ?? bare;
  const exact = columns.flatMap((c, i) => (c === name ? [i + 1] : []));
  if (exact.length || quoted !== undefined) {
    return exact.length === 1 ? exact[0] : 0;
  }
  // An unquoted name folds case (Postgres lowers it, Databricks ignores it).
  const folded = columns.flatMap((c, i) =>
    c.toLowerCase() === name.toLowerCase() ? [i + 1] : [],
  );
  return folded.length === 1 ? folded[0] : 0;
}

/**
 * The stored statement's own top-level ORDER BY, as ordinals of the result,
 * when every key is an output column name or an ordinal; else undefined.
 */
export function storedOrder(
  sql: string,
  columns: string[],
): OrderKey[] | undefined {
  const top = topLevel(maskLiterals(sql));
  const clauses = [...top.matchAll(/\border\s+by\b/gi)];
  const last = clauses[clauses.length - 1];
  if (!last) return undefined;
  const from = last.index + last[0].length;
  const stop = /\b(limit|offset|fetch)\b/i.exec(top.slice(from));
  const to = stop ? from + stop.index : top.length;
  const keys: OrderKey[] = [];
  let start = from;
  for (let i = from; i <= to; i += 1) {
    if (i < to && top[i] !== ',') continue;
    const key = STORED_KEY.exec(sql.slice(start, i).trim());
    const ordinal = key ? ordinalOf(key, columns) : 0;
    if (!key || !ordinal) return undefined;
    keys.push({
      ordinal,
      direction: key[5]?.toLowerCase() === 'desc' ? 'DESC' : 'ASC',
      nulls: key[6]
        ? key[6].toLowerCase() === 'first'
          ? 'NULLS FIRST'
          : 'NULLS LAST'
        : undefined,
    });
    start = i + 1;
  }
  return keys;
}

function orderBy(d: Dialect, stmt: PagedStatement, sql: string): string {
  const { columns } = stmt;
  if (!columns.length) return '';
  const used = new Set<number>();
  const keys: string[] = [];
  if (stmt.sort.length) {
    for (const sort of stmt.sort) {
      const column = columnOf(columns, sort?.column);
      const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
      keys.push(`${d.quote(column)} ${direction} NULLS LAST`);
      used.add(columns.indexOf(column) + 1);
    }
  } else {
    const stored = storedOrder(sql, columns) ?? [
      { ordinal: 1, direction: 'ASC', nulls: 'NULLS LAST' },
    ];
    for (const key of stored) {
      keys.push(
        [key.ordinal, key.direction, key.nulls].filter(Boolean).join(' '),
      );
      used.add(key.ordinal);
    }
  }
  // Every other column breaks ties, except those of unknown kind (a JSON
  // or MAP column cannot be ordered).
  for (let ordinal = 1; ordinal <= columns.length; ordinal += 1) {
    const kind = stmt.kinds[columns[ordinal - 1]];
    if (!used.has(ordinal) && kind !== 'unknown') keys.push(String(ordinal));
  }
  return keys.join(', ');
}

/**
 * The page statement and its count statement for `stmt` (plan 1.28.1, 3):
 *
 *   SELECT _qti.*, COUNT(*) OVER () AS "__qti_total"
 *   FROM (
 *   <stored SQL, guarded; its own top-level LIMIT raised to 50,001>
 *   ) AS _qti
 *   WHERE <predicates> ORDER BY <keys>, <remaining ordinals>
 *   LIMIT n OFFSET m
 */
export function buildPagedSql(
  dialect: SqlDialect,
  stmt: PagedStatement,
): PagedSql {
  const d = DIALECTS[dialect];
  const { limit, offset } = stmt;
  if (
    !Number.isSafeInteger(limit) ||
    !Number.isSafeInteger(offset) ||
    limit < 1 ||
    limit > PAGE_SIZE_MAX ||
    offset < 0 ||
    offset > PAGE_MAX_ROWS
  ) {
    throw bad(`Page window out of range: limit ${limit}, offset ${offset}`);
  }
  if (stmt.filters.length > FILTERS_MAX) {
    throw bad(`At most ${FILTERS_MAX} filters`);
  }
  if (stmt.sort.length > SORT_KEYS_MAX) {
    throw bad(`At most ${SORT_KEYS_MAX} sort keys`);
  }
  const sql = cleanReadOnlySql(stmt.sql);
  const compiler = new Compiler(d, stmt);
  const predicates = stmt.filters.map((f) => compiler.predicate(f));
  const order = orderBy(d, stmt, sql);
  const total = d.quote(TOTAL_COLUMN);
  // A stored LIMIT is raised to 50,001, as the CSV does; a statement without
  // one stays unlimited, so filters and sort see its whole result and only
  // the outer LIMIT/OFFSET cap the page (datasources R52).
  const inner = outerLimit(sql)
    ? withExportLimit(sql, PAGE_MAX_ROWS + 1)
    : withoutTrailingFraming(sql);
  const from = `FROM (\n${inner}\n) AS _qti`;
  const where = predicates.length ? `\nWHERE ${predicates.join(' AND ')}` : '';
  return {
    text:
      `SELECT _qti.*, COUNT(*) OVER () AS ${total}\n${from}${where}` +
      `${order ? `\nORDER BY ${order}` : ''}\nLIMIT ${limit} OFFSET ${offset}`,
    countText: `SELECT COUNT(*) AS ${total}\n${from}${where}`,
    params: compiler.params,
  };
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** What a connector's driver returned for one statement. */
export interface DriverRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Run the page, strip the window total off it, and when a page past the end
 * comes back empty run the count once (plan 1.28.1, 3). `exec` runs one
 * statement of `built` with `built.params`.
 */
export async function readPagedRows(
  built: PagedSql,
  offset: number,
  exec: (text: string) => Promise<DriverRows>,
): Promise<PagedRows> {
  const page = await exec(built.text);
  let matchedRows = 0;
  const rows = page.rows.map((row) => {
    const { [TOTAL_COLUMN]: total, ...rest } = row;
    matchedRows = toCount(total);
    return rest;
  });
  if (!rows.length && offset > 0) {
    const count = await exec(built.countText);
    matchedRows = toCount(count.rows[0]?.[TOTAL_COLUMN]);
  }
  return {
    columns: page.columns.filter((c) => c !== TOTAL_COLUMN),
    rows,
    matchedRows,
  };
}
