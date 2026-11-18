import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Client, Query } from 'pg';
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
  ForeignKeyEdge,
  MASKED,
  RunSqlOptions,
  splitEntity,
  SQL_ROWS_MAX,
} from './connector';
import { buildPagedSql, readPagedRows } from './paged-sql';
import type { PagedRows, PagedStatement } from './paged-sql.types';

const SYSTEM_SCHEMAS = new Set([
  'pg_catalog',
  'information_schema',
  'pg_toast',
]);

interface ForeignKeyRow {
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
}

/**
 * Declared foreign keys for the schemas in `$1`. `conkey`/`confkey` are
 * parallel column-number arrays, so they are unnested WITH ORDINALITY and
 * matched position by position — a composite key yields one row (one edge)
 * per column pair, which is precise enough for analytics schemas.
 */
const FOREIGN_KEY_SQL = `
  SELECT fn.nspname AS from_schema, fc.relname AS from_table,
         fa.attname AS from_column,
         tn.nspname AS to_schema, tc.relname AS to_table,
         ta.attname AS to_column
  FROM pg_constraint con
  JOIN pg_class fc ON fc.oid = con.conrelid
  JOIN pg_namespace fn ON fn.oid = fc.relnamespace
  JOIN pg_class tc ON tc.oid = con.confrelid
  JOIN pg_namespace tn ON tn.oid = tc.relnamespace
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS fk(attnum, ord) ON TRUE
  JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord)
    ON pk.ord = fk.ord
  JOIN pg_attribute fa
    ON fa.attrelid = con.conrelid AND fa.attnum = fk.attnum
  JOIN pg_attribute ta
    ON ta.attrelid = con.confrelid AND ta.attnum = pk.attnum
  WHERE con.contype = 'f'
    AND fn.nspname = ANY($1::text[])
  ORDER BY fn.nspname, fc.relname, fa.attname
`;

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

  /**
   * Declared foreign keys among `entities`, read straight from `pg_constraint`.
   * The schema snapshot alone tells the model which columns exist but not which
   * ones join, so it guesses (`goals.team_id` for `goals.scoring_team_id`) and
   * the query dies. These edges are that missing half.
   *
   * Never throws: a relationship hint is a nice-to-have, so any failure
   * (permissions, timeout, unreachable host) degrades to "no hint".
   */
  async foreignKeys(
    config: PostgresConfig,
    entities: string[],
  ): Promise<ForeignKeyEdge[]> {
    // Only entities in this datasource's database can have edges here; the
    // catalog segment is the database name, exactly as `inventory()` emits it.
    const wanted = new Set<string>();
    const schemas = new Set<string>();
    for (const entity of entities ?? []) {
      const parts = (entity ?? '').split('.').map((p) => p.trim());
      if (parts.length !== 3 || parts.some((p) => !p)) continue;
      if (parts[0].toLowerCase() !== config.database.toLowerCase()) continue;
      wanted.add(parts.join('.').toLowerCase());
      schemas.add(parts[1]);
    }
    if (!schemas.size) return [];

    try {
      return await this.withClient(config, 10_000, async (client) => {
        const result = await client.query<ForeignKeyRow>(FOREIGN_KEY_SQL, [
          Array.from(schemas),
        ]);
        const edges: ForeignKeyEdge[] = [];
        for (const row of result.rows) {
          const from = `${config.database}.${row.from_schema}.${row.from_table}`;
          const to = `${config.database}.${row.to_schema}.${row.to_table}`;
          // Both ends must be in the dataset, otherwise the hint points at a
          // table the model cannot query.
          if (!wanted.has(from.toLowerCase())) continue;
          if (!wanted.has(to.toLowerCase())) continue;
          edges.push({
            from: { entity: from, column: row.from_column },
            to: { entity: to, column: row.to_column },
          });
        }
        return edges;
      });
    } catch (err) {
      this.logger.debug(
        `Postgres foreign keys unavailable, continuing without relationship hints: ${describeError(err)}`,
      );
      return [];
    }
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
   * rejects any write the syntactic guard missed. Rows are consumed as they
   * arrive (`readCapped`): the first `rowLimit` kept, the rest only counted
   * for `totalRows`. An abort of `options.signal` cancels the backend query
   * (datasources R38).
   */
  async runReadOnlySql(
    config: PostgresConfig,
    sql: string,
    rowLimit: number,
    maxRows = SQL_ROWS_MAX,
    options: RunSqlOptions = {},
  ): Promise<QueryResult> {
    const safeSql = assertReadOnlySql(sql);
    const lim = clampRows(rowLimit, 100, maxRows);
    options.signal?.throwIfAborted();
    return this.withClient(
      config,
      30_000,
      async (client) => {
        await client.query('BEGIN READ ONLY');
        try {
          return await readCapped(client, safeSql, lim);
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
        }
      },
      options.signal,
    );
  }

  /**
   * One page of a stored statement's result (datasources R52): the wrapper
   * from `buildPagedSql` with `$n` parameters, in the same READ ONLY
   * transaction and 30 s statement timeout as `runReadOnlySql`.
   */
  async runPagedSql(
    config: PostgresConfig,
    stmt: PagedStatement,
  ): Promise<PagedRows> {
    const built = buildPagedSql('postgres', stmt);
    return this.withClient(config, 30_000, async (client) => {
      await client.query('BEGIN READ ONLY');
      try {
        return await readPagedRows(built, stmt.offset, async (text) => {
          const result = await client.query(text, built.params);
          return {
            columns: result.fields.map((f) => f.name),
            rows: result.rows as Record<string, unknown>[],
          };
        });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    });
  }

  /**
   * Run `run` on a fresh client, always ended after. When `signal` aborts,
   * the backend query is cancelled (`cancelBackend`) and the call rejects
   * with `signal.reason` instead of the Postgres error the cancel causes.
   */
  private async withClient<T>(
    config: PostgresConfig,
    statementTimeoutMs: number,
    run: (client: Client) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const client = new Client(clientConfig(config, statementTimeoutMs));
    let grace: NodeJS.Timeout | undefined;
    const onAbort = () => {
      // Closing the socket is the fallback: when the cancel request cannot
      // be sent, or the statement has not stopped a moment after it.
      const close = () => void client.end().catch(() => undefined);
      grace = setTimeout(close, CANCEL_GRACE_MS);
      void this.cancelBackend(config, client).catch(close);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await client.connect();
      signal?.throwIfAborted();
      return await run(client);
    } catch (err) {
      signal?.throwIfAborted();
      const message = describeError(err);
      this.logger.warn(`Postgres call failed: ${message}`);
      throw new Error(`Postgres — ${message}`);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(grace);
      await client.end().catch(() => undefined);
    }
  }

  /**
   * Cancel what `client` is running, as psql's Ctrl-C does: a second
   * connection with the same credentials asks for `pg_cancel_backend` of the
   * client's backend process (allowed for one's own role, and over the same
   * TLS settings, unlike pg's raw cancel request). The statement then fails
   * with 57014. Throws when the request cannot be sent.
   */
  private async cancelBackend(
    config: PostgresConfig,
    client: Client,
  ): Promise<void> {
    const pid = (client as unknown as { processID?: number | null }).processID;
    if (!pid) throw new Error('not connected yet');
    const canceller = new Client(clientConfig(config, 5_000));
    try {
      await canceller.connect();
      await canceller.query('SELECT pg_cancel_backend($1)', [pid]);
    } finally {
      await canceller.end().catch(() => undefined);
    }
  }
}

/** How long a cancelled statement may take to stop before its socket is closed. */
const CANCEL_GRACE_MS = 2_000;

function clientConfig(config: PostgresConfig, statementTimeoutMs: number) {
  return {
    host: config.host,
    port: Number(config.port) || 5432,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5_000,
    statement_timeout: statementTimeoutMs,
  };
}

/**
 * Run `sql` and consume its rows one by one as the wire delivers them: pg's
 * `Query` keeps no rows of its own once a `row` listener is attached, so
 * only the first `limit` rows are ever held, however many the statement
 * produces. `totalRows` counts them all; rows, their order, the column
 * names and the value parsing are what `client.query(sql)` gives.
 */
function readCapped(
  client: Client,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    let totalRows = 0;
    const query = new Query<Record<string, unknown>>(sql);
    query.on('row', (row) => {
      totalRows += 1;
      if (rows.length < limit) rows.push(row);
    });
    query.on('error', reject);
    query.on('end', (result) =>
      resolve({ columns: result.fields.map((f) => f.name), rows, totalRows }),
    );
    client.query(query);
  });
}

/**
 * Flatten an error into a legible message. `pg` throws an `AggregateError`
 * (empty `.message`) when a host resolves to several addresses and each
 * attempt fails — e.g. `localhost` → both `::1` and `127.0.0.1`. Without
 * unwrapping its `.errors`, the surfaced message is blank and hides the real
 * cause (connection refused, auth failure, …).
 *
 * `.detail` and `.hint` are appended because Postgres puts its own fix on the
 * hint — `Perhaps you meant to reference the column "g.scoring_team_id"` — and
 * the SQL repair loop only ever sees this string. Named fields only: the error
 * object is never stringified wholesale, since `pg` hangs the client config
 * (password included) off it.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) {
    const parts = err.errors.map(describeError).filter(Boolean);
    if (parts.length) return Array.from(new Set(parts)).join('; ');
  }
  if (err instanceof Error) {
    const { code, detail, hint } = err as {
      code?: string;
      detail?: unknown;
      hint?: unknown;
    };
    const base = err.message || (code ? String(code) : err.constructor.name);
    const extras = [
      ['DETAIL', detail],
      ['HINT', hint],
    ]
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(
        ([label, value]) => `${label as string}: ${(value as string).trim()}`,
      );
    return [base, ...extras].join(' — ');
  }
  return String(err) || 'unknown error';
}

/** Double-quote escape a PostgreSQL identifier for interpolation. */
function qIdent(ident: string): string {
  return ident.replace(/"/g, '""');
}
