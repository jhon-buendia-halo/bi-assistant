/**
 * What the `file` kind's connector and importer share about DuckDB
 * (ADR-0052): opening an instance with extension auto-loading off, quoting,
 * and turning result values into JSON-safe ones.
 */
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { join } from 'path';

/** Never fetch or auto-load an extension behind the caller's back. */
const INSTANCE_OPTIONS = {
  autoinstall_known_extensions: 'false',
  autoload_known_extensions: 'false',
};

/**
 * `<dataDir>/files/<datasourceId>/data.duckdb`, the data dir resolved as
 * `database.module.ts` resolves it (APP_DATA_DIR, else `<cwd>/data`).
 */
export function fileDatabasePath(datasourceId: string): string {
  const dataDir = process.env.APP_DATA_DIR ?? join(process.cwd(), 'data');
  return join(dataDir, 'files', datasourceId, 'data.duckdb');
}

/** Open `path` (`:memory:` or a database file), run `fn`, always close. */
export async function withDuckDb<T>(
  path: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const instance = await DuckDBInstance.create(path, INSTANCE_OPTIONS);
  let connection: DuckDBConnection | undefined;
  try {
    connection = await instance.connect();
    return await fn(connection);
  } finally {
    connection?.closeSync();
    instance.closeSync();
  }
}

/** A single-quoted SQL string literal. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A double-quoted SQL identifier. */
export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * DuckDB's JS values made safe for JSON: BIGINT and HUGEINT come back as
 * `bigint`, which `JSON.stringify` refuses; they become numbers when exact,
 * else strings. Lists and structs are walked.
 */
export function plainValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map(plainValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      plainValue(v),
    ]),
  );
}

/** A catalog value (always VARCHAR) as a string. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

/** Rows as objects keyed by `columns`, values made plain. */
export function plainRows(
  columns: string[],
  rows: unknown[][],
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, plainValue(row[i])])),
  );
}

/**
 * A DuckDB error's message. Its first line carries the cause; the lines
 * after it (`Did you mean "…"?`, `LINE 1: …`) help the SQL repair loop, so
 * only `firstLine` callers drop them.
 */
export function duckDbMessage(err: unknown, firstLine = false): string {
  const message = (err instanceof Error ? err.message : String(err)).trim();
  return (
    (firstLine ? message.split('\n')[0].trim() : message) || 'unknown error'
  );
}
