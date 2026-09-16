import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import type {
  CatalogInfo,
  PostgresConfig,
  QueryResult,
  TableInfo,
} from '../entities/datasource.entity';
import {
  assertReadOnlySql,
  clampRows,
  DatasourceConnector,
  MASKED,
  splitEntity,
} from './connector';

const SYSTEM_SCHEMAS = new Set([
  'pg_catalog',
  'information_schema',
  'pg_toast',
]);

/** Postgres connector, mirrored from data-readiness-agent's PostgresService. */
@Injectable()
export class PostgresConnector implements DatasourceConnector<PostgresConfig> {
  private readonly logger = new Logger(PostgresConnector.name);

  summary(config: PostgresConfig): string {
    return `${config.host}:${config.port || 5432}/${config.database}`;
  }

  mask(config: PostgresConfig): PostgresConfig {
    return { ...config, password: config.password ? MASKED : '' };
  }

  async testConnection(config: PostgresConfig): Promise<void> {
    await this.withClient(config, 5_000, async (client) => {
      await client.query('SELECT 1');
    });
  }

  /** One catalog (the database) → schemas → tables, walking pg_catalog. */
  async inventory(config: PostgresConfig): Promise<CatalogInfo[]> {
    return this.withClient(config, 10_000, async (client) => {
      const tables = await client.query<{
        schema_name: string;
        table_name: string;
      }>(`
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.relname
      `);
      const columns = await client.query<{
        schema_name: string;
        table_name: string;
        column_name: string;
        data_type: string;
        nullable: boolean;
      }>(`
        SELECT n.nspname AS schema_name, c.relname AS table_name,
               a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               NOT a.attnotnull AS nullable
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
          AND a.attnum > 0 AND NOT a.attisdropped
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.relname, a.attnum
      `);

      const tableByKey = new Map<string, TableInfo>();
      const schemas = new Map<string, TableInfo[]>();
      for (const row of tables.rows) {
        if (SYSTEM_SCHEMAS.has(row.schema_name)) continue;
        const table: TableInfo = { name: row.table_name, columns: [] };
        tableByKey.set(`${row.schema_name}.${row.table_name}`, table);
        const list = schemas.get(row.schema_name) ?? [];
        list.push(table);
        schemas.set(row.schema_name, list);
      }
      for (const row of columns.rows) {
        tableByKey.get(`${row.schema_name}.${row.table_name}`)?.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.nullable,
        });
      }
      return [
        {
          name: config.database,
          schemas: Array.from(schemas.entries()).map(([name, tbls]) => ({
            name,
            tables: tbls,
          })),
        },
      ];
    });
  }

  async sampleRows(
    config: PostgresConfig,
    entity: string,
    limit: number,
  ): Promise<QueryResult> {
    const [database, schema, table] = splitEntity(entity);
    if (database.toLowerCase() !== config.database.toLowerCase()) {
      throw new BadRequestException(
        `Entity "${entity}" is in database "${database}" but this datasource is "${config.database}"`,
      );
    }
    const lim = clampRows(limit, 10, 100);
    return this.withClient(config, 15_000, async (client) => {
      const result = await client.query(
        `SELECT * FROM "${qIdent(schema)}"."${qIdent(table)}" LIMIT $1`,
        [lim],
      );
      return {
        columns: result.fields.map((f) => f.name),
        rows: result.rows as Record<string, unknown>[],
      };
    });
  }

  /**
   * The authoritative guard is the READ ONLY transaction — Postgres itself
   * rejects any write the syntactic guard missed.
   */
  async runReadOnlySql(
    config: PostgresConfig,
    sql: string,
    rowLimit: number,
  ): Promise<QueryResult> {
    const safeSql = assertReadOnlySql(sql);
    const lim = clampRows(rowLimit, 100, 500);
    return this.withClient(config, 30_000, async (client) => {
      await client.query('BEGIN READ ONLY');
      try {
        const result = await client.query(safeSql);
        return {
          columns: result.fields.map((f) => f.name),
          rows: (result.rows as Record<string, unknown>[]).slice(0, lim),
        };
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    });
  }

  private async withClient<T>(
    config: PostgresConfig,
    statementTimeoutMs: number,
    run: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({
      host: config.host,
      port: Number(config.port) || 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 5_000,
      statement_timeout: statementTimeoutMs,
    });
    try {
      await client.connect();
      return await run(client);
    } catch (err) {
      const message = describeError(err);
      this.logger.warn(`Postgres call failed: ${message}`);
      throw new Error(`Postgres — ${message}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/**
 * Flatten an error into a legible message. `pg` throws an `AggregateError`
 * (empty `.message`) when a host resolves to several addresses and each
 * attempt fails — e.g. `localhost` → both `::1` and `127.0.0.1`. Without
 * unwrapping its `.errors`, the surfaced message is blank and hides the real
 * cause (connection refused, auth failure, …).
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) {
    const parts = err.errors.map(describeError).filter(Boolean);
    if (parts.length) return Array.from(new Set(parts)).join('; ');
  }
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return err.message || (code ? String(code) : err.constructor.name);
  }
  return String(err) || 'unknown error';
}

/** Double-quote escape a PostgreSQL identifier for interpolation. */
function qIdent(ident: string): string {
  return ident.replace(/"/g, '""');
}
