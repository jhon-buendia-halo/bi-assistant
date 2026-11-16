import { Injectable, Logger } from '@nestjs/common';
import { Client, type QueryConfig } from 'pg';
import type { PostgresConfig } from '../entities/datasource.entity';
import type {
  ColumnStats,
  ColumnStatsExtras,
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
  ScopedProfiler,
  TablePrivilege,
} from './profiling';
import {
  isAbort,
  isShortRead,
  limitMethod,
  outcomeError,
  retryPercent,
  samplePercent,
  type RowSampler,
  type SampleOutcome,
} from './sampling';
import { SAMPLE_SIZE_MAX } from '../../synthetic-data/limits';

const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Table-like relations, the same set the inventory lists
 * (`PostgresConnector.inventory`): ordinary tables, views, materialized views,
 * partitioned tables and foreign tables.
 */
const TABLE_RELKINDS = `('r', 'v', 'm', 'p', 'f')`;
const NON_SYSTEM_SCHEMA = `n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`;
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

/** Per-query parser set: every column comes back as the server's own text. */
const RAW_TEXT_TYPES = {
  getTypeParser: () => (value: string) => value,
} as unknown as QueryConfig['types'];

function rawQuery(text: string, values: unknown[]): QueryConfig {
  return { text, values, types: RAW_TEXT_TYPES };
}

function toResult<R>(result: {
  rows?: unknown[];
  fields?: { name: string }[];
}): { rows: R[]; columns: string[] } {
  return {
    rows: (result.rows ?? []) as R[],
    columns: (result.fields ?? []).map((f) => f.name),
  };
}

function abortError(): Error {
  return Object.assign(new Error('Postgres profiling aborted'), {
    name: 'AbortError',
  });
}

/** Postgres error 57014 (query_canceled) is what statement_timeout raises. */
function isStatementTimeout(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === '57014';
}

/**
 * Every client gets an 'error' listener: pg emits it for a connection lost
 * while idle (server restart, network drop), and an unhandled 'error' event
 * would crash the process. `onError` lets a pooled session mark itself broken.
 */
function newClient(config: PostgresConfig, onError?: () => void): Client {
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
  client.on('error', () => onError?.());
  return client;
}

/**
 * BA-323 / ADR-0033: up to `size` clients, each connected once and kept in one
 * READ ONLY transaction, opened lazily and reused for every statement of an
 * assessment. A failed statement aborts the Postgres transaction, so the
 * session rolls back and re-begins before its next statement.
 */
class SessionScope {
  private readonly idle: Client[] = [];
  private readonly all = new Set<Client>();
  private readonly busy = new Set<Client>();
  /** Pooled clients whose connection emitted 'error': never reused. */
  private readonly dead = new WeakSet<Client>();
  private readonly waiters: {
    resolve: (c: Client) => void;
    reject: (e: Error) => void;
  }[] = [];
  private opening = 0;
  aborted = false;
  closed = false;
  readonly abortPromise: Promise<never>;
  private rejectAbort!: (e: Error) => void;
  privileges?: Promise<TablePrivilege[]>;

  constructor(
    private readonly config: PostgresConfig,
    private readonly size: number,
  ) {
    this.abortPromise = new Promise<never>((_, reject) => {
      this.rejectAbort = reject;
    });
    this.abortPromise.catch(() => undefined);
  }

  async acquire(): Promise<Client> {
    if (this.aborted) throw abortError();
    let free = this.idle.pop();
    while (free && this.dead.has(free)) {
      // Lost while idle: discard it; its slot reopens below.
      this.all.delete(free);
      void free.end().catch(() => undefined);
      free = this.idle.pop();
    }
    if (free) {
      this.busy.add(free);
      return free;
    }
    if (this.all.size + this.opening < Math.max(1, this.size)) {
      this.opening += 1;
      const client: Client = newClient(this.config, () =>
        this.dead.add(client),
      );
      try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
      } catch (err) {
        this.opening -= 1;
        await client.end().catch(() => undefined);
        // The slot is free again: wake one waiter so it does not hang.
        const waiter = this.waiters.shift();
        if (waiter) this.acquire().then(waiter.resolve, waiter.reject);
        throw err;
      }
      this.opening -= 1;
      if (this.aborted || this.closed) {
        await client.end().catch(() => undefined);
        throw abortError();
      }
      this.all.add(client);
      this.busy.add(client);
      return client;
    }
    return new Promise<Client>((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }

  /** Return a session; `broken` ones are discarded and their slot reopens. */
  async release(client: Client, broken: boolean): Promise<void> {
    this.busy.delete(client);
    if (broken || this.dead.has(client) || this.aborted || this.closed) {
      this.all.delete(client);
      await client.end().catch(() => undefined);
      const waiter = this.waiters.shift();
      if (waiter) this.acquire().then(waiter.resolve, waiter.reject);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      this.busy.add(client);
      waiter.resolve(client);
    } else {
      this.idle.push(client);
    }
  }

  /** After a failed statement: leave the aborted transaction, start a new one. */
  async reset(client: Client): Promise<boolean> {
    try {
      await client.query('ROLLBACK');
      await client.query('BEGIN READ ONLY');
      return true;
    } catch {
      return false;
    }
  }

  /** Cancel in-flight statements on the server and reject the waiters. */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.rejectAbort(abortError());
    for (const w of this.waiters.splice(0)) w.reject(abortError());
    for (const client of this.busy) {
      const pid = (client as unknown as { processID?: number }).processID;
      if (typeof pid === 'number') void this.cancelBackend(pid);
    }
  }

  private async cancelBackend(pid: number): Promise<void> {
    const killer = newClient(this.config);
    try {
      await killer.connect();
      await killer.query('SELECT pg_cancel_backend($1)', [pid]);
    } catch {
      // best effort: the client is ended when the scope closes
    } finally {
      await killer.end().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w.reject(abortError());
    const clients = Array.from(this.all);
    this.all.clear();
    this.idle.length = 0;
    this.busy.clear();
    await Promise.all(
      clients.map(async (c) => {
        await c.query('ROLLBACK').catch(() => undefined);
        await c.end().catch(() => undefined);
      }),
    );
  }
}

/**
 * Postgres profiling queries (unit 5, BA-256). Aggregate statistics only,
 * outside the user read-only SQL path; every statement still runs inside a
 * READ ONLY transaction. Ported from data-readiness-agent's PostgresService.
 */
@Injectable()
export class PostgresProfiler
  implements ProfilingConnector<PostgresConfig>, RowSampler<PostgresConfig>
{
  readonly kind = 'postgres' as const;
  private readonly logger = new Logger(PostgresProfiler.name);
  /** Set on the scoped copy `withSessions` hands to its callback. */
  private scope?: SessionScope;

  async withSessions<T>(
    config: PostgresConfig,
    size: number,
    signal: AbortSignal | undefined,
    fn: (scoped: ScopedProfiler<PostgresConfig>) => Promise<T>,
  ): Promise<T> {
    const scope = new SessionScope(config, size);
    const scoped = Object.create(this) as PostgresProfiler;
    scoped.scope = scope;
    const onAbort = () => scope.abort();
    if (signal?.aborted) scope.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fn(scoped);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await scope.close();
    }
  }

  async rowCount(
    config: PostgresConfig,
    schema: string,
    table: string,
  ): Promise<number> {
    const rows = await this.run<{ n: string }>(
      config,
      `SELECT COUNT(*)::bigint AS n FROM ${q(schema)}.${q(table)}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Plan 2.1: the row estimate is `pg_class.reltuples` (no COUNT(*)). Up to
   * `sampleSize` rows: read all; up to 1 M: BERNOULLI; above: SYSTEM; unknown,
   * or TABLESAMPLE refused (view, foreign or partitioned table): LIMIT.
   * Values are raw text. A failure leaves `error` and no rows; raw rows are
   * never logged or put in an error message.
   */
  async sampleTable(
    config: PostgresConfig,
    namespace: string,
    table: string,
    opts: { sampleSize: number; repeatableSeed: number },
  ): Promise<SampleOutcome> {
    const started = Date.now();
    const limit = Math.max(1, Math.min(opts.sampleSize, SAMPLE_SIZE_MAX));
    const from = `${q(namespace)}.${q(table)}`;
    const out: SampleOutcome = {
      namespace,
      table,
      rowCountEstimate: null,
      method: 'limit',
      columns: [],
      rows: [],
      durationMs: 0,
    };
    const read = async (sql: string) => {
      const r = await this.exec<Record<string, string | null>>(
        config,
        sql,
        [],
        true,
      );
      out.rows = r.rows;
      out.columns = r.columns;
    };
    const readLimit = async () => {
      await read(`SELECT * FROM ${from} LIMIT ${limit}`);
      out.method = limitMethod(out.rows.length, limit);
    };
    try {
      let estimate: number | null = null;
      try {
        const est = await this.run<{ n: string | number | null }>(
          config,
          `SELECT c.reltuples::bigint AS n FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2`,
          [namespace, table],
        );
        const raw = est[0]?.n;
        const n = raw === null || raw === undefined ? NaN : Number(raw);
        estimate = Number.isFinite(n) && n >= 0 ? n : null;
      } catch (err) {
        if (isAbort(err)) throw err;
        estimate = null;
      }
      out.rowCountEstimate = estimate;

      if (estimate === null) {
        await readLimit();
      } else if (estimate <= limit) {
        await read(`SELECT * FROM ${from} LIMIT ${limit}`);
        out.method = out.rows.length >= limit ? 'limit' : 'full';
      } else {
        const kind = estimate > 1_000_000 ? 'SYSTEM' : 'BERNOULLI';
        const seed = Math.trunc(opts.repeatableSeed);
        const tablesample = (p: number) =>
          `SELECT * FROM ${from} TABLESAMPLE ${kind} (${p}) REPEATABLE (${seed}) LIMIT ${limit}`;
        const p = samplePercent(limit, estimate);
        try {
          await read(tablesample(p));
          out.method = 'tablesample';
          if (p < 100 && isShortRead(out.rows.length, limit, estimate)) {
            await read(tablesample(retryPercent(p)));
          }
        } catch (err) {
          if (isAbort(err)) throw err;
          await readLimit();
        }
      }
    } catch (err) {
      if (isAbort(err)) throw err;
      out.rows = [];
      out.error = outcomeError(err);
    }
    out.durationMs = Date.now() - started;
    return out;
  }

  /**
   * Every table-like relation the inventory lists (TABLE_RELKINDS) and its
   * columns, from pg_catalog. Unlike information_schema, pg_catalog also lists
   * relations the role cannot read, so accessibility (R17) can count them.
   * A relation with no column is still listed, as in the inventory. Types come
   * from format_type (e.g. `integer[]`).
   */
  async tables(
    config: PostgresConfig,
    schema?: string,
  ): Promise<ProfiledTable[]> {
    const params: string[] = [];
    let filter = NON_SYSTEM_SCHEMA;
    if (schema) {
      params.push(schema);
      filter += ` AND n.nspname = $1`;
    }
    const rows = await this.run<{
      schema: string;
      table: string;
      column: string | null;
      type: string | null;
      nullable: boolean | null;
    }>(
      config,
      `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column",
              format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid
         AND a.attnum > 0
         AND NOT a.attisdropped
       WHERE c.relkind IN ${TABLE_RELKINDS}
         AND ${filter}
       ORDER BY n.nspname, c.relname, a.attnum`,
      params,
    );
    const byKey = new Map<string, ProfiledTable>();
    for (const r of rows) {
      const key = `${r.schema}\u0000${r.table}`;
      let t = byKey.get(key);
      if (!t) {
        t = { schema: r.schema, table: r.table, columns: [] };
        byKey.set(key, t);
      }
      if (r.column === null) continue;
      t.columns.push({
        name: r.column,
        type: r.type ?? '',
        nullable: r.nullable ?? true,
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
    extras?: ColumnStatsExtras,
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
    // BA-323: same expressions as normalizedDistinctCount / invalidFormatCount.
    const normalized = extras?.normalizedDistinct ?? [];
    normalized.forEach((c, i) =>
      aggregates.push(
        `COUNT(DISTINCT lower(btrim(${q(c)}::text)))::bigint AS "nd${i}"`,
      ),
    );
    const formats = extras?.formats ?? [];
    const params: unknown[] = [];
    formats.forEach((f, i) => {
      params.push(f.pattern);
      aggregates.push(
        `COUNT(*) FILTER (WHERE ${q(f.column)} IS NOT NULL AND ${q(f.column)}::text !~* $${params.length})::bigint AS "f${i}"`,
      );
    });
    const rows = await this.run<Record<string, string | null>>(
      config,
      `SELECT ${aggregates.join(', ')} FROM ${q(schema)}.${q(table)}`,
      params,
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
    const stats: ColumnStats = {
      totalRows: Number(row.total ?? 0),
      nullCounts,
      distinctCounts,
      minValues,
      maxValues,
    };
    if (extras?.normalizedDistinct) {
      const counts: Record<string, number> = {};
      normalized.forEach((c, i) => (counts[c] = Number(row[`nd${i}`] ?? 0)));
      stats.normalizedDistinctCounts = counts;
    }
    if (extras?.formats) {
      const counts: Record<string, number> = {};
      formats.forEach((f, i) => (counts[f.column] = Number(row[`f${i}`] ?? 0)));
      stats.invalidFormatCounts = counts;
    }
    return stats;
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

  /** Cached per scope: the privilege inventory does not change mid-assessment. */
  async tablePrivileges(config: PostgresConfig): Promise<TablePrivilege[]> {
    const scope = this.scope;
    if (!scope) return this.readPrivileges(config);
    scope.privileges ??= this.readPrivileges(config);
    try {
      return await scope.privileges;
    } catch (err) {
      scope.privileges = undefined;
      throw err;
    }
  }

  private async readPrivileges(
    config: PostgresConfig,
  ): Promise<TablePrivilege[]> {
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
       WHERE c.relkind IN ${TABLE_RELKINDS}
         AND ${NON_SYSTEM_SCHEMA}`,
    );
    return rows.map((r) => ({
      schema: r.schema,
      table: r.table,
      selectable: r.selectable,
    }));
  }

  /**
   * One statement, inside a READ ONLY transaction: on a pooled session when
   * scoped, otherwise in its own client.
   */
  private async run<R>(
    config: PostgresConfig,
    sql: string,
    params: unknown[] = [],
  ): Promise<R[]> {
    return (await this.exec<R>(config, sql, params, false)).rows;
  }

  /**
   * `raw` reads every value as the server's text (a per-query type parser, so
   * `timestamp` never becomes a host-time-zone `Date`); the client config and
   * the readiness statements are untouched.
   */
  private async exec<R>(
    config: PostgresConfig,
    sql: string,
    params: unknown[],
    raw: boolean,
  ): Promise<{ rows: R[]; columns: string[] }> {
    if (this.scope) return this.execScoped<R>(this.scope, sql, params, raw);
    const client = newClient(config);
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      try {
        const result = raw
          ? await client.query(rawQuery(sql, params))
          : await client.query(sql, params);
        return toResult<R>(result);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    } catch (err) {
      throw this.failure(err);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async execScoped<R>(
    scope: SessionScope,
    sql: string,
    params: unknown[],
    raw: boolean,
  ): Promise<{ rows: R[]; columns: string[] }> {
    let client: Client;
    try {
      client = await scope.acquire();
    } catch (err) {
      throw scope.aborted ? abortError() : this.failure(err);
    }
    let broken = false;
    try {
      const pending = raw
        ? client.query(rawQuery(sql, params))
        : client.query(sql, params);
      const result = await Promise.race([pending, scope.abortPromise]);
      return toResult<R>(result);
    } catch (err) {
      if (scope.aborted) {
        broken = true;
        throw abortError();
      }
      broken = !(await scope.reset(client));
      throw this.failure(err);
    } finally {
      await scope.release(client, broken);
    }
  }

  /** Never stringify the error object; classify statement timeouts. */
  private failure(err: unknown): Error {
    if (isStatementTimeout(err)) {
      this.logger.warn('Postgres profiling statement timed out');
      return Object.assign(
        new Error(
          `Postgres — statement timed out after ${STATEMENT_TIMEOUT_MS / 1000} s`,
        ),
        { name: 'TimeoutError' },
      );
    }
    const message = describeError(err);
    this.logger.warn(`Postgres profiling failed: ${message}`);
    return new Error(`Postgres — ${message}`);
  }
}
