import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import type { PostgresConfig } from '../entities/datasource.entity';
import type {
  ColumnStats,
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
  TablePrivilege,
} from './profiling';

const CONNECT_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 15_000;

/** Double-quote a PostgreSQL identifier, escaping embedded quotes. */
function q(ident: string): string {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

/**
 * Message from an error without ever stringifying the error object (it can
 * carry the client config, password included).
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) {
    const parts = err.errors.map(describeError).filter(Boolean);
    if (parts.length) return Array.from(new Set(parts)).join('; ');
  }
  if (err instanceof Error) {
    const { code } = err as { code?: unknown };
    return (
      err.message ||
      (typeof code === 'string' && code ? code : err.constructor.name)
    );
  }
  return 'unknown error';
}

/**
 * Postgres profiling queries (unit 5, BA-256). Aggregate statistics only,
 * outside the user read-only SQL path; every statement still runs inside a
 * READ ONLY transaction. Ported from data-readiness-agent's PostgresService.
 */
@Injectable()
export class PostgresProfiler implements ProfilingConnector<PostgresConfig> {
  readonly kind = 'postgres' as const;
  private readonly logger = new Logger(PostgresProfiler.name);

  async tables(
    config: PostgresConfig,
    schema?: string,
  ): Promise<ProfiledTable[]> {
    const params: string[] = [];
    let filter = `table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`;
    if (schema) {
      params.push(schema);
      filter += ` AND table_schema = $1`;
    }
    const rows = await this.run<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      config,
      `SELECT table_schema, table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE ${filter}
       ORDER BY table_schema, table_name, ordinal_position`,
      params,
    );
    const byKey = new Map<string, ProfiledTable>();
    for (const r of rows) {
      const key = `${r.table_schema}\u0000${r.table_name}`;
      let t = byKey.get(key);
      if (!t) {
        t = { schema: r.table_schema, table: r.table_name, columns: [] };
        byKey.set(key, t);
      }
      t.columns.push({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
      });
    }
    return Array.from(byKey.values());
  }

  async columnStats(
    config: PostgresConfig,
    schema: string,
    table: string,
    nullableColumns: string[],
    allColumns: string[],
    comparableColumns: string[],
  ): Promise<ColumnStats> {
    const aggregates: string[] = ['COUNT(*)::bigint AS total'];
    nullableColumns.forEach((c, i) =>
      aggregates.push(
        `COUNT(*) FILTER (WHERE ${q(c)} IS NULL)::bigint AS "n${i}"`,
      ),
    );
    allColumns.forEach((c, i) =>
      aggregates.push(`COUNT(DISTINCT ${q(c)})::bigint AS "d${i}"`),
    );
    comparableColumns.forEach((c, i) => {
      aggregates.push(`MIN(${q(c)})::text AS "mn${i}"`);
      aggregates.push(`MAX(${q(c)})::text AS "mx${i}"`);
    });
    const rows = await this.run<Record<string, string | null>>(
      config,
      `SELECT ${aggregates.join(', ')} FROM ${q(schema)}.${q(table)}`,
    );
    const row = rows[0] ?? {};
    const nullCounts: Record<string, number> = {};
    nullableColumns.forEach(
      (c, i) => (nullCounts[c] = Number(row[`n${i}`] ?? 0)),
    );
    const distinctCounts: Record<string, number> = {};
    allColumns.forEach(
      (c, i) => (distinctCounts[c] = Number(row[`d${i}`] ?? 0)),
    );
    const minValues: Record<string, string> = {};
    const maxValues: Record<string, string> = {};
    comparableColumns.forEach((c, i) => {
      const mn = row[`mn${i}`];
      const mx = row[`mx${i}`];
      if (mn !== null && mn !== undefined) minValues[c] = String(mn);
      if (mx !== null && mx !== undefined) maxValues[c] = String(mx);
    });
    return {
      totalRows: Number(row.total ?? 0),
      nullCounts,
      distinctCounts,
      minValues,
      maxValues,
    };
  }

  async keys(config: PostgresConfig): Promise<KeyConstraint[]> {
    const rows = await this.run<{
      schema: string;
      table: string;
      contype: string;
      columns: string[];
    }>(
      config,
      `SELECT n.nspname AS schema, c.relname AS "table", con.contype AS contype,
              array_agg(a.attname::text ORDER BY array_position(con.conkey, a.attnum)) AS columns
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
       WHERE con.contype IN ('p', 'u')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       GROUP BY n.nspname, c.relname, con.conname, con.contype
       ORDER BY n.nspname, c.relname`,
    );
    return rows.map((r) => ({
      schema: r.schema,
      table: r.table,
      kind: r.contype === 'p' ? ('primary' as const) : ('unique' as const),
      columns: r.columns,
    }));
  }

  async foreignKeys(config: PostgresConfig): Promise<FkEdge[]> {
    const rows = await this.run<{
      from_schema: string;
      from_table: string;
      from_column: string;
      to_schema: string;
      to_table: string;
      to_column: string;
    }>(
      config,
      `SELECT fn.nspname AS from_schema, fc.relname AS from_table, fa.attname AS from_column,
              tn.nspname AS to_schema, tc.relname AS to_table, ta.attname AS to_column
       FROM pg_constraint con
       JOIN pg_class fc ON fc.oid = con.conrelid
       JOIN pg_namespace fn ON fn.oid = fc.relnamespace
       JOIN pg_class tc ON tc.oid = con.confrelid
       JOIN pg_namespace tn ON tn.oid = tc.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS fk(attnum, ord) ON TRUE
       JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = fk.ord
       JOIN pg_attribute fa ON fa.attrelid = con.conrelid AND fa.attnum = fk.attnum
       JOIN pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = pk.attnum
       WHERE con.contype = 'f'
         AND fn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY fn.nspname, fc.relname, fa.attname`,
    );
    return rows.map((r) => ({
      schema: r.from_schema,
      table: r.from_table,
      column: r.from_column,
      refSchema: r.to_schema,
      refTable: r.to_table,
      refColumn: r.to_column,
    }));
  }

  /** Excess duplicate rows for a (possibly composite) key: SUM(groupSize - 1). */
  async duplicateCount(
    config: PostgresConfig,
    schema: string,
    table: string,
    fields: string[],
  ): Promise<number> {
    if (fields.length === 0) return 0;
    const cols = fields.map(q).join(', ');
    const rows = await this.run<{ dup_rows: string }>(
      config,
      `SELECT COALESCE(SUM(c - 1), 0)::bigint AS dup_rows FROM (
         SELECT COUNT(*) AS c FROM ${q(schema)}.${q(table)}
         GROUP BY ${cols} HAVING COUNT(*) > 1
       ) g`,
    );
    return Number(rows[0]?.dup_rows ?? 0);
  }

  async orphanCount(config: PostgresConfig, edge: FkEdge): Promise<number> {
    const rows = await this.run<{ orphans: string }>(
      config,
      `SELECT COUNT(*)::bigint AS orphans
       FROM ${q(edge.schema)}.${q(edge.table)} c
       LEFT JOIN ${q(edge.refSchema)}.${q(edge.refTable)} p
         ON c.${q(edge.column)} = p.${q(edge.refColumn)}
       WHERE c.${q(edge.column)} IS NOT NULL AND p.${q(edge.refColumn)} IS NULL`,
    );
    return Number(rows[0]?.orphans ?? 0);
  }

  async invalidFormatCount(
    config: PostgresConfig,
    schema: string,
    table: string,
    column: string,
    pattern: string,
  ): Promise<number> {
    const rows = await this.run<{ bad: string }>(
      config,
      `SELECT COUNT(*)::bigint AS bad FROM ${q(schema)}.${q(table)}
       WHERE ${q(column)} IS NOT NULL AND ${q(column)}::text !~* $1`,
      [pattern],
    );
    return Number(rows[0]?.bad ?? 0);
  }

  async normalizedDistinctCount(
    config: PostgresConfig,
    schema: string,
    table: string,
    column: string,
  ): Promise<number> {
    const rows = await this.run<{ n: string }>(
      config,
      `SELECT COUNT(DISTINCT lower(btrim(${q(column)}::text)))::bigint AS n
       FROM ${q(schema)}.${q(table)}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async tablePrivileges(config: PostgresConfig): Promise<TablePrivilege[]> {
    const rows = await this.run<{
      schema: string;
      table: string;
      selectable: boolean;
    }>(
      config,
      `SELECT n.nspname AS schema, c.relname AS "table",
              has_table_privilege(c.oid, 'SELECT') AS selectable
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`,
    );
    return rows.map((r) => ({
      schema: r.schema,
      table: r.table,
      selectable: r.selectable,
    }));
  }

  /** One statement in its own client, inside a READ ONLY transaction. */
  private async run<R>(
    config: PostgresConfig,
    sql: string,
    params: unknown[] = [],
  ): Promise<R[]> {
    const client = new Client({
      host: config.host,
      port: Number(config.port) || 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    });
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      try {
        const result = await client.query(sql, params);
        return result.rows as R[];
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    } catch (err) {
      const message = describeError(err);
      this.logger.warn(`Postgres profiling failed: ${message}`);
      throw new Error(`Postgres — ${message}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
