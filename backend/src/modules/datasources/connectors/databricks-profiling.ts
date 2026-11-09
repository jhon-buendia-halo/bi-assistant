import { Injectable, Logger } from '@nestjs/common';
import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';
import type IOperation from '@databricks/sql/dist/contracts/IOperation';
import type { DatabricksConfig } from '../entities/datasource.entity';
import { normalizeDatabricksHost } from './databricks-host';
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

/** Per-statement (and connection) budget. */
const STATEMENT_TIMEOUT_MS = 15_000;
const UC_API_TIMEOUT_MS = 20_000;
const SYSTEM_CATALOGS = new Set(['system', '__databricks_internal']);

type Row = Record<string, unknown>;
type Run = (sql: string) => Promise<Row[]>;
interface UcObject {
  name?: string;
  browse_only?: boolean;
}

/** The pooled-session scope of one `withSessions` call (BA-323, ADR-0033). */
interface Scope {
  run: Run;
  /** Whole-warehouse inventory (`tables(config)` with no schema), read once. */
  inventory?: Promise<ProfiledTable[]>;
}

/** Databricks profiling queries (unit 6, BA-257). Spark SQL, aggregate-only. */
@Injectable()
export class DatabricksProfiler implements ProfilingConnector<DatabricksConfig> {
  readonly kind = 'databricks' as const;
  private readonly logger = new Logger(DatabricksProfiler.name);
  /** Set only on the scoped copy handed out by `withSessions`. */
  private scope?: Scope;

  /**
   * BA-323: run `fn` with a profiler reusing at most `size` client+session
   * pairs (opened lazily, queued when all are busy), all closed when `fn`
   * settles. An abort cancels in-flight statements and rejects new ones.
   */
  async withSessions<T>(
    config: DatabricksConfig,
    size: number,
    signal: AbortSignal | undefined,
    fn: (scoped: ScopedProfiler<DatabricksConfig>) => Promise<T>,
  ): Promise<T> {
    const pool = new SessionPool(config, Math.max(1, Math.floor(size)), signal);
    const scoped = Object.create(this) as DatabricksProfiler;
    scoped.scope = { run: (sql) => pool.run(sql) };
    try {
      return await fn(scoped);
    } catch (err) {
      throw this.scrub(err, config);
    } finally {
      await pool.close();
    }
  }

  async rowCount(
    config: DatabricksConfig,
    schema: string,
    table: string,
  ): Promise<number> {
    const rows = await this.query(
      config,
      `SELECT COUNT(*) AS n FROM ${qualify(schema, table)}`,
    );
    return num(rows[0]?.n);
  }

  async tables(
    config: DatabricksConfig,
    schema?: string,
  ): Promise<ProfiledTable[]> {
    const scope = this.scope;
    if (!schema && scope) {
      scope.inventory ??= this.readTables(config).catch((err: unknown) => {
        scope.inventory = undefined;
        throw err;
      });
      return scope.inventory;
    }
    return this.readTables(config, schema);
  }

  private async readTables(
    config: DatabricksConfig,
    schema?: string,
  ): Promise<ProfiledTable[]> {
    return this.withSession(config, async (run) => {
      let catalogs: string[];
      let schemaFilter: string | undefined;
      if (schema) {
        const [catalog, name] = splitSchema(schema);
        catalogs = [catalog];
        schemaFilter = name;
      } else {
        catalogs = await listUserCatalogs(run);
      }
      const out: ProfiledTable[] = [];
      for (const catalog of catalogs) {
        const base = `${qIdent(catalog)}.information_schema`;
        const where = `WHERE table_schema <> 'information_schema'${
          schemaFilter ? ` AND table_schema = ${qStr(schemaFilter)}` : ''
        }`;
        let cols: Row[];
        let tabs: Row[];
        try {
          cols = await run(
            `SELECT table_schema, table_name, column_name, full_data_type, is_nullable
             FROM ${base}.columns ${where}
             ORDER BY table_schema, table_name, ordinal_position`,
          );
          tabs = await run(
            `SELECT table_schema, table_name, last_altered
             FROM ${base}.tables ${where}
             ORDER BY table_schema, table_name`,
          );
        } catch (err) {
          if (schema) throw err;
          this.logger.warn(
            `[tables] skipping catalog "${catalog}": ${(err as Error).message}`,
          );
          continue;
        }
        const byTable = new Map<string, ProfiledTable>();
        for (const t of tabs) {
          const s = `${catalog}.${text(t.table_schema)}`;
          const name = text(t.table_name);
          const iso = toIso(t.last_altered);
          byTable.set(`${s}\u0000${name}`, {
            schema: s,
            table: name,
            columns: [],
            ...(iso ? { lastModifiedAt: iso } : {}),
          });
        }
        for (const c of cols) {
          const s = `${catalog}.${text(c.table_schema)}`;
          const name = text(c.table_name);
          const key = `${s}\u0000${name}`;
          let entry = byTable.get(key);
          if (!entry) {
            entry = { schema: s, table: name, columns: [] };
            byTable.set(key, entry);
          }
          entry.columns.push({
            name: text(c.column_name),
            type: text(c.full_data_type),
            nullable: text(c.is_nullable).toUpperCase() === 'YES',
          });
        }
        out.push(...byTable.values());
      }
      return out;
    });
  }

  async columnStats(
    config: DatabricksConfig,
    schema: string,
    table: string,
    nullableColumns: string[],
    allColumns: string[],
    comparableColumns: string[],
    extras?: ColumnStatsExtras,
  ): Promise<ColumnStats> {
    const parts: string[] = ['COUNT(*) AS total'];
    nullableColumns.forEach((c, i) =>
      parts.push(`COUNT_IF(${qIdent(c)} IS NULL) AS n${i}`),
    );
    allColumns.forEach((c, i) =>
      parts.push(`COUNT(DISTINCT ${qIdent(c)}) AS d${i}`),
    );
    comparableColumns.forEach((c, i) => {
      parts.push(`CAST(MIN(${qIdent(c)}) AS STRING) AS mn${i}`);
      parts.push(`CAST(MAX(${qIdent(c)}) AS STRING) AS mx${i}`);
    });
    const normalized = extras?.normalizedDistinct ?? [];
    const formats = extras?.formats ?? [];
    normalized.forEach((c, i) =>
      parts.push(`COUNT(DISTINCT ${normalizedExpr(c)}) AS nd${i}`),
    );
    formats.forEach((f, i) =>
      parts.push(
        `COUNT_IF(${qIdent(f.column)} IS NOT NULL AND ${invalidPredicate(f.column, f.pattern)}) AS f${i}`,
      ),
    );
    const rows = await this.query(
      config,
      `SELECT ${parts.join(', ')} FROM ${qualify(schema, table)}`,
    );
    const row = rows[0] ?? {};
    const total = Number(row.total ?? 0);
    const nullCounts: Record<string, number> = {};
    const distinctCounts: Record<string, number> = {};
    const minValues: Record<string, string> = {};
    const maxValues: Record<string, string> = {};
    nullableColumns.forEach((c, i) => {
      const v = row[`n${i}`];
      if (v !== undefined && v !== null) nullCounts[c] = Number(v);
    });
    allColumns.forEach((c, i) => {
      const v = row[`d${i}`];
      if (v !== undefined && v !== null) distinctCounts[c] = Number(v);
    });
    comparableColumns.forEach((c, i) => {
      const mn = row[`mn${i}`];
      const mx = row[`mx${i}`];
      if (mn !== undefined && mn !== null) minValues[c] = scalar(mn);
      if (mx !== undefined && mx !== null) maxValues[c] = scalar(mx);
    });
    const stats: ColumnStats = {
      totalRows: Number.isFinite(total) ? total : 0,
      nullCounts,
      distinctCounts,
      minValues,
      maxValues,
    };
    if (normalized.length > 0) {
      const counts: Record<string, number> = {};
      normalized.forEach((c, i) => {
        const v = row[`nd${i}`];
        if (v !== undefined && v !== null) counts[c] = Number(v);
      });
      stats.normalizedDistinctCounts = counts;
    }
    if (formats.length > 0) {
      const counts: Record<string, number> = {};
      formats.forEach((f, i) => {
        const v = row[`f${i}`];
        if (v !== undefined && v !== null) counts[f.column] = Number(v);
      });
      stats.invalidFormatCounts = counts;
    }
    return stats;
  }

  async keys(config: DatabricksConfig): Promise<KeyConstraint[]> {
    return this.withSession(config, async (run) => {
      const keys: KeyConstraint[] = [];
      for (const catalog of await listUserCatalogs(run)) {
        const base = `${qIdent(catalog)}.information_schema`;
        let rows: Row[];
        try {
          rows = await run(
            `SELECT tc.table_schema AS schema_name, tc.table_name AS table_name,
                    tc.constraint_name AS constraint_name,
                    tc.constraint_type AS kind, kcu.column_name AS column_name,
                    kcu.ordinal_position AS ordinal
             FROM ${base}.table_constraints tc
             JOIN ${base}.key_column_usage kcu
               ON kcu.table_catalog = tc.table_catalog
              AND kcu.table_schema = tc.table_schema
              AND kcu.table_name = tc.table_name
              AND kcu.constraint_name = tc.constraint_name
             WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
               AND tc.table_schema <> 'information_schema'
             ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`,
          );
        } catch (err) {
          this.logger.warn(
            `[keys] constraint query failed for catalog "${catalog}", skipping: ${(err as Error).message}`,
          );
          continue;
        }
        const grouped = new Map<string, KeyConstraint>();
        for (const r of rows) {
          const type = text(r.kind).toUpperCase();
          const kind =
            type === 'PRIMARY KEY'
              ? 'primary'
              : type === 'UNIQUE'
                ? 'unique'
                : null;
          if (!kind) continue;
          const schema = `${catalog}.${text(r.schema_name)}`;
          const table = text(r.table_name);
          const key = `${schema}\u0000${table}\u0000${text(r.constraint_name)}`;
          let entry = grouped.get(key);
          if (!entry) {
            entry = { schema, table, kind, columns: [] };
            grouped.set(key, entry);
          }
          entry.columns.push(text(r.column_name));
        }
        keys.push(...grouped.values());
      }
      return keys;
    });
  }

  async foreignKeys(config: DatabricksConfig): Promise<FkEdge[]> {
    try {
      return await this.withSession(config, async (run) => {
        const edges: FkEdge[] = [];
        for (const catalog of await listUserCatalogs(run)) {
          const base = `${qIdent(catalog)}.information_schema`;
          let rows: Row[];
          try {
            rows = await run(
              `SELECT kcu.table_schema AS child_schema, kcu.table_name AS child_table,
                      kcu.column_name AS child_col, ref.table_schema AS parent_schema,
                      ref.table_name AS parent_table, ref.column_name AS parent_col
               FROM ${base}.referential_constraints rc
               JOIN ${base}.key_column_usage kcu
                 ON kcu.constraint_catalog = rc.constraint_catalog
                AND kcu.constraint_schema = rc.constraint_schema
                AND kcu.constraint_name = rc.constraint_name
               JOIN ${base}.key_column_usage ref
                 ON ref.constraint_catalog = rc.unique_constraint_catalog
                AND ref.constraint_schema = rc.unique_constraint_schema
                AND ref.constraint_name = rc.unique_constraint_name
                AND ref.ordinal_position = kcu.position_in_unique_constraint
               WHERE kcu.table_schema <> 'information_schema'
               ORDER BY kcu.table_schema, kcu.table_name, kcu.constraint_name, kcu.ordinal_position`,
            );
          } catch (err) {
            this.logger.warn(
              `[foreignKeys] failed for catalog "${catalog}", skipping: ${(err as Error).message}`,
            );
            continue;
          }
          for (const r of rows) {
            edges.push({
              schema: `${catalog}.${text(r.child_schema)}`,
              table: text(r.child_table),
              column: text(r.child_col),
              refSchema: `${catalog}.${text(r.parent_schema)}`,
              refTable: text(r.parent_table),
              refColumn: text(r.parent_col),
            });
          }
        }
        return edges;
      });
    } catch (err) {
      // Informational constraints are often unreadable: not an error.
      this.logger.debug(
        `Databricks foreign keys unavailable: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async duplicateCount(
    config: DatabricksConfig,
    schema: string,
    table: string,
    fields: string[],
  ): Promise<number> {
    if (fields.length === 0) return 0;
    const cols = fields.map(qIdent).join(', ');
    const rows = await this.query(
      config,
      `SELECT COALESCE(SUM(c - 1), 0) AS dup_excess
       FROM (SELECT ${cols}, COUNT(*) c FROM ${qualify(schema, table)} GROUP BY ${cols} HAVING COUNT(*) > 1)`,
    );
    return num(rows[0]?.dup_excess);
  }

  async orphanCount(config: DatabricksConfig, edge: FkEdge): Promise<number> {
    const rows = await this.query(
      config,
      `SELECT COUNT(*) AS orphan_count
       FROM ${qualify(edge.schema, edge.table)} c
       LEFT JOIN ${qualify(edge.refSchema, edge.refTable)} p
         ON c.${qIdent(edge.column)} = p.${qIdent(edge.refColumn)}
       WHERE c.${qIdent(edge.column)} IS NOT NULL AND p.${qIdent(edge.refColumn)} IS NULL`,
    );
    return num(rows[0]?.orphan_count);
  }

  async invalidFormatCount(
    config: DatabricksConfig,
    schema: string,
    table: string,
    column: string,
    pattern: string,
  ): Promise<number> {
    const rows = await this.query(
      config,
      `SELECT COUNT(*) AS invalid FROM ${qualify(schema, table)}
       WHERE ${qIdent(column)} IS NOT NULL
         AND ${invalidPredicate(column, pattern)}`,
    );
    return num(rows[0]?.invalid);
  }

  async normalizedDistinctCount(
    config: DatabricksConfig,
    schema: string,
    table: string,
    column: string,
  ): Promise<number> {
    const rows = await this.query(
      config,
      `SELECT COUNT(DISTINCT ${normalizedExpr(column)}) AS d
       FROM ${qualify(schema, table)}`,
    );
    return num(rows[0]?.d);
  }

  /**
   * Accessible = the schema is listed by the Unity Catalog REST API without
   * `browse_only` (SQL probes cannot tell BROWSE from SELECT access).
   */
  async tablePrivileges(config: DatabricksConfig): Promise<TablePrivilege[]> {
    const inventory = await this.tables(config);
    const catalogs = new Set(inventory.map((t) => splitSchema(t.schema)[0]));
    const accessibleCatalogs = new Set<string>();
    for (const c of await this.ucList(config, 'catalogs')) {
      if (c.browse_only !== true && c.name) accessibleCatalogs.add(c.name);
    }
    const accessibleSchemas = new Set<string>();
    for (const catalog of catalogs) {
      if (!accessibleCatalogs.has(catalog)) continue;
      for (const s of await this.ucList(config, 'schemas', catalog)) {
        if (s.browse_only !== true && s.name) {
          accessibleSchemas.add(`${catalog}.${s.name}`);
        }
      }
    }
    return inventory.map((t) => ({
      schema: t.schema,
      table: t.table,
      selectable: accessibleSchemas.has(t.schema),
    }));
  }

  private async ucList(
    config: DatabricksConfig,
    kind: 'catalogs' | 'schemas',
    catalog?: string,
  ): Promise<UcObject[]> {
    const items: UcObject[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `https://${normalizeDatabricksHost(config.host)}/api/2.1/unity-catalog/${kind}`,
      );
      url.searchParams.set('include_browse', 'true');
      if (catalog) url.searchParams.set('catalog_name', catalog);
      if (pageToken) url.searchParams.set('page_token', pageToken);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UC_API_TIMEOUT_MS);
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${config.token}` },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(
            `Unity Catalog API ${res.status} ${res.statusText}`.trim(),
          );
        }
        const body = (await res.json()) as {
          catalogs?: UcObject[];
          schemas?: UcObject[];
          next_page_token?: string;
        };
        items.push(
          ...((kind === 'catalogs' ? body.catalogs : body.schemas) ?? []),
        );
        pageToken = body.next_page_token;
      } catch (err) {
        throw this.scrub(err, config);
      } finally {
        clearTimeout(timer);
      }
    } while (pageToken);
    return items;
  }

  /** One statement in its own session. */
  private query(config: DatabricksConfig, sql: string): Promise<Row[]> {
    return this.withSession(config, (run) => run(sql));
  }

  private async withSession<T>(
    config: DatabricksConfig,
    fn: (run: Run) => Promise<T>,
  ): Promise<T> {
    if (this.scope) {
      try {
        return await fn(this.scope.run);
      } catch (err) {
        throw this.scrub(err, config);
      }
    }
    let conn: Connection | undefined;
    try {
      conn = await openConnection(config);
      const s = conn.session;
      return await fn((sql) => executeOn(s, sql, undefined));
    } catch (err) {
      throw this.scrub(err, config);
    } finally {
      await conn?.close();
    }
  }

  /** An Error whose message never carries the access token. */
  private scrub(err: unknown, config: DatabricksConfig): Error {
    const msg = err instanceof Error ? err.message : String(err);
    const clean = config.token ? msg.split(config.token).join('***') : msg;
    const out = new Error(clean);
    if (err instanceof Error && NAMED_ERRORS.has(err.name)) out.name = err.name;
    return out;
  }
}

const NAMED_ERRORS = new Set(['AbortError', 'TimeoutError']);

interface Connection {
  session: IDBSQLSession;
  close(): Promise<void>;
}

/** One client + session pair (telemetry off, host normalised). */
async function openConnection(config: DatabricksConfig): Promise<Connection> {
  const client = new DBSQLClient();
  let session: IDBSQLSession | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return; // idempotent: close() and a late acquire may both call
    closed = true;
    await session?.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  };
  try {
    await raceTimeout(
      client.connect({
        host: normalizeDatabricksHost(config.host),
        path: `/sql/1.0/warehouses/${config.warehouseId}`,
        authType: 'access-token',
        token: config.token,
        socketTimeout: STATEMENT_TIMEOUT_MS,
        telemetryEnabled: false,
      }),
      'connection',
    );
    session = await client.openSession();
  } catch (err) {
    await close();
    throw err;
  }
  return { session, close };
}

/**
 * Run one statement with the 15 s budget. On timeout or abort the operation
 * is cancelled and closed on the server, not left running.
 */
function executeOn(
  session: IDBSQLSession,
  sql: string,
  signal: AbortSignal | undefined,
): Promise<Row[]> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<Row[]>((resolve, reject) => {
    let op: IOperation | undefined;
    let settled = false;
    const stopOp = () => {
      const o = op;
      if (!o) return;
      void Promise.resolve()
        .then(() => o.cancel())
        .catch(() => undefined)
        .then(() => o.close())
        .catch(() => undefined);
    };
    const finish = (fail?: Error): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (fail) {
        stopOp();
        reject(fail);
      }
      return true;
    };
    const timer = setTimeout(
      () => finish(timeoutError('query')),
      STATEMENT_TIMEOUT_MS,
    );
    const onAbort = () => finish(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    session
      .executeStatement(sql)
      .then((o) => {
        op = o;
        if (settled) {
          stopOp();
          return undefined;
        }
        return o.fetchAll();
      })
      .then((res: unknown) => {
        if (res === undefined || !finish()) return;
        resolve(
          Array.isArray(res)
            ? (res.filter((r) => typeof r === 'object' && r !== null) as Row[])
            : [],
        );
      })
      .catch((err: unknown) => {
        finish(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/** Lazily opened, bounded pool of sessions for one `withSessions` scope. */
class SessionPool {
  private readonly all: Promise<Connection>[] = [];
  private readonly free: Connection[] = [];
  private readonly waiters: (() => void)[] = [];
  private opened = 0;
  private closed = false;

  constructor(
    private readonly config: DatabricksConfig,
    private readonly size: number,
    private readonly signal: AbortSignal | undefined,
  ) {
    signal?.addEventListener('abort', () => this.wakeAll(), { once: true });
  }

  async run(sql: string): Promise<Row[]> {
    const conn = await this.acquire();
    try {
      return await executeOn(conn.session, sql, this.signal);
    } finally {
      this.free.push(conn);
      this.waiters.shift()?.();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.wakeAll();
    const conns = await Promise.allSettled(this.all);
    await Promise.all(
      conns.map((c) =>
        c.status === 'fulfilled' ? c.value.close() : Promise.resolve(),
      ),
    );
  }

  private async acquire(): Promise<Connection> {
    for (;;) {
      if (this.signal?.aborted) throw abortError();
      // A straggler statement after the scope closed must not open a session.
      if (this.closed)
        throw new Error('The Databricks session scope is closed');
      const idle = this.free.pop();
      if (idle) return idle;
      if (this.opened < this.size) {
        this.opened++;
        const opening = openConnection(this.config);
        this.all.push(opening);
        try {
          const conn = await opening;
          if (this.closed) {
            // Finished opening after close(): nobody will close it later.
            await conn.close().catch(() => undefined);
            throw this.signal?.aborted
              ? abortError()
              : new Error('The Databricks session scope is closed');
          }
          return conn;
        } catch (err) {
          this.opened--;
          this.waiters.shift()?.();
          throw err;
        }
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private wakeAll(): void {
    for (const w of this.waiters.splice(0)) w();
  }
}

function abortError(): Error {
  const err = new Error('Databricks statement aborted');
  err.name = 'AbortError';
  return err;
}

function timeoutError(what: 'connection' | 'query'): Error {
  const err = new Error(
    `Databricks ${what} timed out after ${STATEMENT_TIMEOUT_MS / 1000}s`,
  );
  err.name = 'TimeoutError';
  return err;
}

/** `lower(trim(col))` as text: the normalized-distinct expression. */
function normalizedExpr(column: string): string {
  return `lower(trim(CAST(${qIdent(column)} AS STRING)))`;
}

/**
 * True when the value does NOT match the pattern. `(?i)` makes the match
 * case-insensitive, as Postgres `!~*` does (R7); executeStatement does no
 * parameter binding, so the pattern is inlined as a raw literal.
 */
function invalidPredicate(column: string, pattern: string): string {
  return `NOT regexp_like(CAST(${qIdent(column)} AS STRING), ${qRawStr(`(?i)${pattern}`)})`;
}

async function listUserCatalogs(run: Run): Promise<string[]> {
  const rows = await run('SHOW CATALOGS');
  return rows
    .map((r) => text(r['catalog'] ?? Object.values(r)[0]))
    .filter((c) => c && !SYSTEM_CATALOGS.has(c.toLowerCase()))
    .sort();
}

/** `catalog.schema` → [catalog, schema]. */
function splitSchema(schema: string): [string, string] {
  const i = schema.indexOf('.');
  if (i <= 0) throw new Error(`Expected "catalog.schema", got "${schema}"`);
  return [schema.slice(0, i), schema.slice(i + 1)];
}

/** Backtick-quote one identifier, escaping embedded backticks. */
function qIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``;
}

/** `catalog.schema` + table → `` `catalog`.`schema`.`table` ``. */
function qualify(schema: string, table: string): string {
  const [catalog, name] = splitSchema(schema);
  return `${qIdent(catalog)}.${qIdent(name)}.${qIdent(table)}`;
}

/** Spark string literal (backslashes first, then single quotes). */
function qStr(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Spark raw string literal `r'...'`: the pattern reaches Spark verbatim, so it
 * does not depend on `spark.sql.parser.escapedStringLiterals`. A raw literal
 * cannot hold its closing quote, and patterns come from a fixed internal
 * table (spec R7) that has none, so a single quote is rejected, never escaped.
 */
function qRawStr(value: string): string {
  if (value.includes("'")) {
    throw new Error('A raw Spark regex literal cannot contain a single quote');
  }
  return `r'${value}'`;
}

function num(v: unknown): number {
  return Number(v ?? 0) || 0;
}

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean')
    return String(v);
  return '';
}

function scalar(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return text(v);
}

function toIso(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(scalar(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function raceTimeout<T>(
  work: Promise<T>,
  what: 'connection' | 'query',
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(what)), STATEMENT_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
