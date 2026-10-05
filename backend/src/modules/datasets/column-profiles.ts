/**
 * Save-time column profiling: cheap, best-effort statistics computed with two
 * SQL round-trips per table (an aggregate pass, then a `GROUP BY` top-N pass
 * per low-cardinality column) instead of pulling rows into Node. `describe_entity`
 * and the schema cards use the result so the assistant knows a column is
 * constant, mostly null, low-cardinality or stored in cents before it writes
 * SQL against it — see `ColumnProfile` in `repositories/datasets.repository.ts`.
 *
 * Pure SQL-string builders + row parsers, plus one small orchestrator that
 * takes a `run(sql)` callback so it has no Nest/datasource dependency and is
 * cheap to unit test with a mocked runner.
 */

import type {
  ColumnProfile,
  DatasetColumnSnapshot,
} from './repositories/datasets.repository';

export type ProfileDialect = 'postgres' | 'databricks';

/** A statement result shape narrow enough for both connectors' `QueryResult`. */
export interface ProfileQueryResult {
  rows: Record<string, unknown>[];
}

export type ProfileRunner = (sql: string) => Promise<ProfileQueryResult>;

/** Column count profiled per table — a wide `describe_entity` table stays cheap. */
export const DEFAULT_MAX_COLUMNS = 60;
/** Also the `GROUP BY` cardinality threshold: a column qualifies for top values
 * exactly when its distinct count is at or under this cap. */
export const DEFAULT_TOP_VALUES = 25;
/** Per-statement budget; a slow/locked table yields no profile, not a hung save. */
export const DEFAULT_PROFILE_TIMEOUT_MS = 15_000;

const ROWS_ALIAS = 'rows_total';
const VALUE_ALIAS = 'value';
const COUNT_ALIAS = 'value_count';

/** Types whose values have no meaningful `MIN`/`MAX` ordering. */
const UNORDERED_TYPE_PATTERN =
  /\b(bool(?:ean)?|json(?:b)?|array|map|struct|binary|bytea)\b/i;

function isUnorderedType(type: string): boolean {
  const trimmed = (type ?? '').trim();
  if (!trimmed) return false;
  // Postgres spells an array type `<elem>[]` (e.g. `text[]`), not the word
  // "array" the ARRAY<...> (Databricks) shape matches on its own.
  return UNORDERED_TYPE_PATTERN.test(trimmed) || /\[]\s*$/.test(trimmed);
}

/** Double-quote (postgres) or backtick (databricks) escape one identifier segment. */
function quoteIdent(ident: string, dialect: ProfileDialect): string {
  return dialect === 'postgres'
    ? `"${ident.replace(/"/g, '""')}"`
    : `\`${ident.replace(/`/g, '``')}\``;
}

/**
 * `catalog.schema.table` → a FROM-clause-ready identifier, quoted exactly the
 * way `sampleRows` quotes it in `connectors/{postgres,databricks}.connector.ts`:
 * postgres addresses `"schema"."table"` only (the connector never qualifies by
 * catalog — the client already connects to one database), databricks addresses
 * all three segments backticked.
 */
function qualifiedTable(entity: string, dialect: ProfileDialect): string {
  const parts = (entity ?? '')
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  const segments = dialect === 'postgres' ? parts.slice(-2) : parts;
  return segments.map((p) => quoteIdent(p, dialect)).join('.');
}

/** `TEXT` (postgres) or `STRING` (Spark SQL / Databricks) — the string cast target. */
function textType(dialect: ProfileDialect): string {
  return dialect === 'postgres' ? 'TEXT' : 'STRING';
}

interface StatAliases {
  nonNull: string;
  distinct: string;
  min: string;
  max: string;
}

/** Index-based aliases so column names with odd characters never need escaping. */
function statAliases(index: number): StatAliases {
  return {
    nonNull: `c${index}_nonnull`,
    distinct: `c${index}_distinct`,
    min: `c${index}_min`,
    max: `c${index}_max`,
  };
}

/**
 * One aggregate `SELECT` for the whole table: `COUNT(*)` plus, per column,
 * `COUNT(col)`, `COUNT(DISTINCT col)` and (when the type has a meaningful
 * order) `MIN`/`MAX` cast to text so every value comes back as a string. The
 * cast wraps the aggregate, not the column, so numeric/date ordering is
 * computed correctly before the result is stringified.
 */
export function buildProfileSql(
  entity: string,
  columns: DatasetColumnSnapshot[],
  dialect: ProfileDialect,
): string {
  const table = qualifiedTable(entity, dialect);
  const cast = textType(dialect);
  const selects = [`COUNT(*) AS ${quoteIdent(ROWS_ALIAS, dialect)}`];
  columns.forEach((column, index) => {
    const col = quoteIdent(column.name, dialect);
    const alias = statAliases(index);
    selects.push(`COUNT(${col}) AS ${quoteIdent(alias.nonNull, dialect)}`);
    selects.push(
      `COUNT(DISTINCT ${col}) AS ${quoteIdent(alias.distinct, dialect)}`,
    );
    if (!isUnorderedType(column.type)) {
      selects.push(
        `CAST(MIN(${col}) AS ${cast}) AS ${quoteIdent(alias.min, dialect)}`,
      );
      selects.push(
        `CAST(MAX(${col}) AS ${cast}) AS ${quoteIdent(alias.max, dialect)}`,
      );
    }
  });
  return `SELECT ${selects.join(', ')} FROM ${table}`;
}

/** `GROUP BY` top-N for one column — only meaningful when its distinct count is low. */
export function buildTopValuesSql(
  entity: string,
  column: string,
  dialect: ProfileDialect,
  limit: number = DEFAULT_TOP_VALUES,
): string {
  const table = qualifiedTable(entity, dialect);
  const col = quoteIdent(column, dialect);
  const cast = textType(dialect);
  const valueAlias = quoteIdent(VALUE_ALIAS, dialect);
  const countAlias = quoteIdent(COUNT_ALIAS, dialect);
  const cappedLimit = Math.max(1, Math.floor(limit) || DEFAULT_TOP_VALUES);
  return (
    `SELECT CAST(${col} AS ${cast}) AS ${valueAlias}, COUNT(*) AS ${countAlias} ` +
    `FROM ${table} WHERE ${col} IS NOT NULL GROUP BY ${col} ` +
    `ORDER BY ${countAlias} DESC LIMIT ${cappedLimit}`
  );
}

/** Raw per-column numbers parsed off one aggregate row, before profile math. */
export interface ParsedColumnStats {
  nonNull: number;
  distinctCount: number;
  min?: string;
  max?: string;
}

function toCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

/** Unpack `buildProfileSql`'s single result row back into per-column stats. */
export function parseProfileRow(
  row: Record<string, unknown> | undefined,
  columns: DatasetColumnSnapshot[],
): { sampledRows: number; stats: ParsedColumnStats[] } {
  const sampledRows = toCount(row?.[ROWS_ALIAS]);
  const stats = columns.map((_column, index) => {
    const alias = statAliases(index);
    return {
      nonNull: toCount(row?.[alias.nonNull]),
      distinctCount: toCount(row?.[alias.distinct]),
      min: toStringOrUndefined(row?.[alias.min]),
      max: toStringOrUndefined(row?.[alias.max]),
    };
  });
  return { sampledRows, stats };
}

const CENTS_LIKE_MIN = 1e5;
const LARGE_INTEGER_MIN = 1e9;
/** Column-name heuristics feeding the magnitude guess — not exhaustive by design. */
const CENTS_SUFFIX = /_cents$/i;
const MONEYISH_NAME =
  /(amount|price|cost|fee|balance|total|paid|charge|payment|revenue|spend)/i;
const COUNT_NAME = /(?:_count|^n_)/i;

/**
 * Heuristic reading of a numeric column's scale from its name and observed
 * range — never authoritative, just enough to steer the model away from
 * treating a cents column as dollars or a fraction as a percentage already
 * multiplied by 100. Non-numeric `min`/`max` (including unordered types, where
 * they are absent) yield no magnitude.
 */
function computeMagnitude(
  name: string,
  type: string,
  min: string | undefined,
  max: string | undefined,
): ColumnProfile['magnitude'] {
  if (isUnorderedType(type)) return undefined;
  const maxNum = max === undefined ? undefined : Number(max);
  const minNum = min === undefined ? undefined : Number(min);
  if (maxNum === undefined || !Number.isFinite(maxNum)) return undefined;

  const isInteger = Number.isInteger(maxNum);
  const moneyish = CENTS_SUFFIX.test(name) || MONEYISH_NAME.test(name);
  if (
    CENTS_SUFFIX.test(name) ||
    (moneyish && isInteger && maxNum > CENTS_LIKE_MIN)
  ) {
    return 'cents-like';
  }
  if (
    minNum !== undefined &&
    Number.isFinite(minNum) &&
    minNum >= 0 &&
    maxNum <= 1
  ) {
    return 'fraction';
  }
  if (isInteger && COUNT_NAME.test(name)) return 'count';
  if (isInteger && maxNum > LARGE_INTEGER_MIN) return 'large-integer';
  return undefined;
}

/** Reject when `promise` outlives `timeoutMs`; the caller's call keeps running. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Profiling timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Run `worker` over `items`, at most `limit` in flight — mirrors the datasets service helper. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        await worker(items[cursor++]);
      }
    },
  );
  await Promise.all(runners);
}

const TOP_VALUES_CONCURRENCY = 5;

/**
 * Profile every column of one table: one aggregate statement, then one
 * `GROUP BY` top-N statement per column whose distinct count is at or under
 * `opts.topValues`. Best-effort throughout — an aggregate failure or timeout
 * yields no profiles for the table (never throws), and a single column's top-N
 * failure only drops that column's `topValues`.
 */
export async function profileColumns(
  run: ProfileRunner,
  entity: string,
  columns: DatasetColumnSnapshot[],
  dialect: ProfileDialect,
  opts?: { maxColumns?: number; topValues?: number; timeoutMs?: number },
): Promise<Record<string, ColumnProfile>> {
  const maxColumns = opts?.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const topValuesLimit = opts?.topValues ?? DEFAULT_TOP_VALUES;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PROFILE_TIMEOUT_MS;
  const targets = (columns ?? []).filter((c) => c?.name).slice(0, maxColumns);
  if (!targets.length) return {};

  let aggregateRow: Record<string, unknown> | undefined;
  try {
    const sql = buildProfileSql(entity, targets, dialect);
    const result = await withTimeout(run(sql), timeoutMs);
    aggregateRow = result?.rows?.[0];
  } catch {
    return {};
  }
  if (!aggregateRow) return {};

  const profiledAt = new Date().toISOString();
  const { sampledRows, stats } = parseProfileRow(aggregateRow, targets);
  const profiles: Record<string, ColumnProfile> = {};
  const topValueTargets: DatasetColumnSnapshot[] = [];

  targets.forEach((column, index) => {
    const s = stats[index];
    // 0 non-null rows is treated as constant/empty: there is nothing to vary,
    // and dividing by a 0 population would otherwise report a bogus null rate.
    const nullRate = sampledRows > 0 ? 1 - s.nonNull / sampledRows : 0;
    const constant = s.nonNull === 0 || s.distinctCount === 1;
    const profile: ColumnProfile = {
      sampledRows,
      nullRate,
      distinctCount: s.distinctCount,
      constant,
      profiledAt,
    };
    if (s.min !== undefined) profile.min = s.min;
    if (s.max !== undefined) profile.max = s.max;
    const magnitude = computeMagnitude(column.name, column.type, s.min, s.max);
    if (magnitude) profile.magnitude = magnitude;
    profiles[column.name] = profile;
    if (s.distinctCount > 0 && s.distinctCount <= topValuesLimit) {
      topValueTargets.push(column);
    }
  });

  await mapWithConcurrency(
    topValueTargets,
    TOP_VALUES_CONCURRENCY,
    async (column) => {
      try {
        const sql = buildTopValuesSql(
          entity,
          column.name,
          dialect,
          topValuesLimit,
        );
        const result = await withTimeout(run(sql), timeoutMs);
        const topValues = (result?.rows ?? [])
          .map((row) => ({
            value: toStringOrUndefined(row[VALUE_ALIAS]),
            count: toCount(row[COUNT_ALIAS]),
          }))
          .filter(
            (tv): tv is { value: string; count: number } =>
              tv.value !== undefined,
          );
        if (topValues.length) profiles[column.name].topValues = topValues;
      } catch {
        // Best-effort: this column simply has no topValues.
      }
    },
  );

  return profiles;
}
