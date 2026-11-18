import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DuckDBConnection } from '@duckdb/node-api';
import { existsSync } from 'fs';
import type {
  CatalogInfo,
  FileDatasourceConfig,
  QueryResult,
  TableInfo,
} from '../entities/datasource.entity';
import {
  assertReadOnlySql,
  clampRows,
  DatasourceConnector,
  RunSqlOptions,
  splitEntity,
  SQL_ROWS_MAX,
} from './connector';
import {
  asText,
  duckDbMessage,
  plainRows,
  quoteIdent,
  sqlString,
  withDuckDb,
} from './duckdb';
import { buildPagedSql, readPagedRows } from './paged-sql';
import type { PagedRows, PagedStatement } from './paged-sql.types';

/** The catalog every `file` entity lives in: `file.<schema>.<table>`. */
export const FILE_CATALOG = 'file';

/**
 * What the connector receives: the saved config plus the path of the
 * datasource's `data.duckdb`, which `DatasourcesService` fills from the
 * datasource id on every call. The path is never stored.
 */
export type FileConnectorConfig = FileDatasourceConfig & {
  databasePath: string;
};

/** The statement timeout of `runReadOnlySql` and `runPagedSql`, as Postgres's. */
const STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Open the datasource's database in the sandbox of ADR-0052 and run `fn`:
 * a fresh in-memory instance (extension auto-install and auto-load off),
 * the database attached READ_ONLY as `file`, then external access off and
 * the configuration locked, so no statement can read another file, attach
 * another database, load an extension or undo either setting. Closed after.
 */
export async function withFileDatabase<T>(
  databasePath: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  if (!databasePath) {
    throw new BadRequestException(
      'Save the Excel / CSV datasource before reading it',
    );
  }
  if (!existsSync(databasePath)) {
    throw new BadRequestException(
      'No files have been imported into this datasource yet',
    );
  }
  return withDuckDb(':memory:', async (connection) => {
    await connection.run(
      `ATTACH ${sqlString(databasePath)} AS ${FILE_CATALOG} (READ_ONLY)`,
    );
    await connection.run('SET enable_external_access = false');
    await connection.run('SET lock_configuration = true');
    return fn(connection);
  });
}

/**
 * Interrupt the running statement once `ms` have passed, or as soon as
 * `signal` aborts (the statement then fails with an INTERRUPT error).
 */
async function withTimeout<T>(
  connection: DuckDBConnection,
  ms: number,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const interrupt = () => connection.interrupt();
  const timer = setTimeout(interrupt, ms);
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    signal?.throwIfAborted();
    return await run();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', interrupt);
  }
}

/** The `file` kind (ADR-0052): sheets and CSV files imported into DuckDB. */
@Injectable()
export class FileConnector implements DatasourceConnector<FileConnectorConfig> {
  private readonly logger = new Logger(FileConnector.name);

  summary(config: FileDatasourceConfig): string {
    const files = config.files ?? [];
    const tables = files.reduce(
      (n, f) => n + (f.sheets ?? []).filter((s) => s.include).length,
      0,
    );
    const plural = (n: number, word: string) =>
      `${n} ${word}${n === 1 ? '' : 's'}`;
    return `${plural(files.length, 'file')} · ${plural(tables, 'table')}`;
  }

  /** No secret field. */
  mask(config: FileConnectorConfig): FileConnectorConfig {
    return config;
  }

  async testConnection(config: FileConnectorConfig): Promise<void> {
    await this.run(config, (c) => c.run('SELECT 1'));
  }

  /** One catalog, `file`; one schema per file; DuckDB's own type names. */
  async inventory(config: FileConnectorConfig): Promise<CatalogInfo[]> {
    return this.run(config, async (connection) => {
      const reader = await connection.runAndReadAll(
        `SELECT table_schema, table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_catalog = ${sqlString(FILE_CATALOG)}
         ORDER BY table_schema, table_name, ordinal_position`,
      );
      const schemas = new Map<string, Map<string, TableInfo>>();
      for (const row of reader.getRowObjectsJS()) {
        const schema = asText(row.table_schema);
        const name = asText(row.table_name);
        const tables = schemas.get(schema) ?? new Map<string, TableInfo>();
        schemas.set(schema, tables);
        const table = tables.get(name) ?? { name, columns: [] };
        tables.set(name, table);
        table.columns.push({
          name: asText(row.column_name),
          type: asText(row.data_type),
          nullable: row.is_nullable === 'YES',
        });
      }
      return [
        {
          name: FILE_CATALOG,
          schemas: Array.from(schemas, ([name, tables]) => ({
            name,
            tables: Array.from(tables.values()),
          })),
        },
      ];
    });
  }

  async sampleRows(
    config: FileConnectorConfig,
    entity: string,
    limit: number,
  ): Promise<QueryResult> {
    const [catalog, schema, table] = splitEntity(entity);
    if (catalog.toLowerCase() !== FILE_CATALOG) {
      throw new BadRequestException(
        `Entity "${entity}" is not in this datasource; its entities are ${FILE_CATALOG}.<schema>.<table>`,
      );
    }
    const lim = clampRows(limit, 10, 100);
    return this.run(config, async (connection) => {
      const reader = await connection.runAndReadAll(
        `SELECT * FROM ${FILE_CATALOG}.${quoteIdent(schema)}.${quoteIdent(table)} LIMIT ${lim}`,
      );
      const columns = reader.deduplicatedColumnNames();
      return { columns, rows: plainRows(columns, reader.getRowsJS()) };
    });
  }

  /**
   * The R33 guard first; the engine is the authoritative guard (read-only
   * attach, no external access). Every row is counted for `totalRows`, only
   * the first `rowLimit` are converted. An abort of `options.signal`
   * interrupts the statement, as the timeout does (datasources R38).
   */
  async runReadOnlySql(
    config: FileConnectorConfig,
    sql: string,
    rowLimit: number,
    maxRows = SQL_ROWS_MAX,
    options: RunSqlOptions = {},
  ): Promise<QueryResult> {
    const { signal } = options;
    const safeSql = assertReadOnlySql(sql);
    const lim = clampRows(rowLimit, 100, maxRows);
    signal?.throwIfAborted();
    return this.run(
      config,
      (connection) =>
        withTimeout(
          connection,
          STATEMENT_TIMEOUT_MS,
          async () => {
            const reader = await connection.streamAndReadUntil(safeSql, lim);
            const columns = reader.deduplicatedColumnNames();
            const rows = plainRows(columns, reader.getRowsJS().slice(0, lim));
            await reader.readAll();
            return { columns, rows, totalRows: reader.currentRowCount };
          },
          signal,
        ),
      signal,
    );
  }

  /** One page of a stored statement's result (datasources R52), `$n` bound. */
  async runPagedSql(
    config: FileConnectorConfig,
    stmt: PagedStatement,
  ): Promise<PagedRows> {
    const built = buildPagedSql('duckdb', stmt);
    return this.run(config, (connection) =>
      withTimeout(connection, STATEMENT_TIMEOUT_MS, () =>
        readPagedRows(built, stmt.offset, async (text) => {
          const reader = await connection.runAndReadAll(text, built.params);
          const columns = reader.deduplicatedColumnNames();
          return { columns, rows: plainRows(columns, reader.getRowsJS()) };
        }),
      ),
    );
  }

  /** `fn` in the R35 sandbox; an abort of `signal` rejects with its reason. */
  private async run<T>(
    config: FileConnectorConfig,
    fn: (connection: DuckDBConnection) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await withFileDatabase(config.databasePath, fn);
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof BadRequestException) throw err;
      const message = duckDbMessage(err);
      this.logger.warn(`DuckDB call failed: ${message}`);
      throw new Error(`DuckDB — ${message}`);
    }
  }
}
