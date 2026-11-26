import { Injectable, Logger } from '@nestjs/common';
import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';
import type IOperation from '@databricks/sql/dist/contracts/IOperation';
import type { DatabricksConfig } from '../entities/datasource.entity';
import { normalizeDatabricksHost } from './databricks-host';
import type {
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
  ProfilingReach,
  ScopedProfiler,
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
import {
  DATABRICKS_TABLESAMPLE_MAX_BYTES,
  SAMPLE_SIZE_MAX,
} from '../../synthetic-data/limits';

/** Per-statement (and connection) budget. */
const STATEMENT_TIMEOUT_MS = 15_000;
const SYSTEM_CATALOGS = new Set(['system', '__databricks_internal']);

type Row = Record<string, unknown>;
type Run = (sql: string) => Promise<Row[]>;

/** The pooled-session scope of one `withSessions` call (BA-323, ADR-0033). */
interface Scope {
  run: Run;
  /** Inventory (`tables(config)` with no schema), read once. */
  inventory?: Promise<ProfiledTable[]>;
  /** What the catalogue reads cover; every listed catalog when absent. */
  reach?: ProfilingReach;
}

/** One catalog a catalogue read visits, narrowed when the scope has a reach. */
export interface CatalogRead {
  catalog: string;
  /** Schema names (without the catalog) to read; every schema when absent. */
  schemas?: string[];
  /** The scope's own tables in this catalog, read alone when a schema is too large. */
  tables?: { schema: string; name: string }[];
}

interface SkippedCatalog {
  catalog: string;
  error: unknown;
}

/** At most this many skipped catalogs are named in the one warning. */
const MAX_SKIPPED_NAMED = 10;
/** Each skipped catalog's reason is cut to this many characters. */
const MAX_SKIP_REASON = 160;

/**
 * Databricks profiling queries (unit 6, BA-257). Spark SQL: catalogue reads
 * and row samples for the Synthetic data profile.
 */
@Injectable()
export class DatabricksProfiler
  implements ProfilingConnector<DatabricksConfig>, RowSampler<DatabricksConfig>
{
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
    reach?: ProfilingReach,
  ): Promise<T> {
    const pool = new SessionPool(config, Math.max(1, Math.floor(size)), signal);
    const scoped = Object.create(this) as DatabricksProfiler;
    scoped.scope = {
      run: (sql) => pool.run(sql),
      ...(reach && reach.namespaces.length > 0 ? { reach } : {}),
    };
    try {
      return await fn(scoped);
    } catch (err) {
      throw this.scrub(err, config);
    } finally {
      await pool.close();
    }
  }

  /**
   * Plan 2.1: `COUNT(*)` plus `DESCRIBE DETAIL` sizeInBytes pick the tier. Up to
   * `sampleSize` rows: read all; above, below 50 GiB: TABLESAMPLE (p PERCENT);
   * from 50 GiB (52 s cold on 160 GB), unknown, or TABLESAMPLE refused (views):
   * LIMIT. Every value is normalised to a string. A failure leaves `error` and
   * no rows; raw rows are never logged or put in an error message.
   */
  async sampleTable(
    config: DatabricksConfig,
    namespace: string,
    table: string,
    opts: { sampleSize: number; repeatableSeed: number },
  ): Promise<SampleOutcome> {
    const started = Date.now();
    const limit = Math.max(1, Math.min(opts.sampleSize, SAMPLE_SIZE_MAX));
    const from = qualify(namespace, table);
    const out: SampleOutcome = {
      namespace,
      table,
      rowCountEstimate: null,
      method: 'limit',
      columns: [],
      rows: [],
      durationMs: 0,
    };
    try {
      await this.withSession(config, async (run) => {
        const read = async (sql: string) => {
          const rows = await run(sql);
          out.columns = rows.length ? Object.keys(rows[0]) : [];
          out.rows = rows.map((r) => {
            const o: Record<string, string | null> = {};
            for (const k of out.columns) o[k] = sampleValue(r[k]);
            return o;
          });
        };
        const readLimit = async () => {
          await read(`SELECT * FROM ${from} LIMIT ${limit}`);
          out.method = limitMethod(out.rows.length, limit);
        };
        let count: number | null = null;
        try {
          const rows = await run(`SELECT COUNT(*) AS n FROM ${from}`);
          const n = Number(rows[0]?.n);
          count = Number.isFinite(n) && n >= 0 ? n : null;
        } catch (err) {
          if (isAbort(err)) throw err;
        }
        out.rowCountEstimate = count;
        if (count === null) return readLimit();
        if (count <= limit) {
          await read(`SELECT * FROM ${from} LIMIT ${limit}`);
          out.method = out.rows.length >= limit ? 'limit' : 'full';
          return undefined;
        }
        let bytes: number | null = null;
        try {
          const rows = await run(`DESCRIBE DETAIL ${from}`);
          const n = Number(rows[0]?.sizeInBytes);
          bytes = Number.isFinite(n) && n >= 0 ? n : null;
        } catch (err) {
          if (isAbort(err)) throw err;
        }
        if (bytes === null || bytes >= DATABRICKS_TABLESAMPLE_MAX_BYTES) {
          return readLimit();
        }
        const seed = Math.trunc(opts.repeatableSeed);
        const tablesample = (p: number) =>
          `SELECT * FROM ${from} TABLESAMPLE (${p} PERCENT) REPEATABLE (${seed}) LIMIT ${limit}`;
        const p = samplePercent(limit, count);
        try {
          await read(tablesample(p));
          out.method = 'tablesample';
          if (p < 100 && isShortRead(out.rows.length, limit, count)) {
            await read(tablesample(retryPercent(p)));
          }
        } catch (err) {
          if (isAbort(err)) throw err;
          return readLimit();
        }
        return undefined;
      });
    } catch (err) {
      if (isAbort(err)) throw err;
      out.rows = [];
      out.error = outcomeError(err);
    }
    out.durationMs = Date.now() - started;
    return out;
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
      if (schema) {
        const [catalog, name] = splitSchema(schema);
        return readCatalogTables(
          run,
          catalog,
          ` AND table_schema = ${qStr(name)}`,
        );
      }
      const plan = await this.catalogPlan(run);
      const out: ProfiledTable[] = [];
      const skipped: SkippedCatalog[] = [];
      for (const read of plan) {
        let failure: unknown;
        try {
          out.push(
            ...(await readCatalogTables(
              run,
              read.catalog,
              inClause('table_schema', read.schemas),
            )),
          );
          continue;
        } catch (err) {
          if (isAbort(err)) throw err;
          failure = err;
        }
        // A schema too large to list in one statement: still read the
        // assessment's own tables, so they are not lost (R28).
        if (read.tables?.length) {
          try {
            out.push(
              ...(await readCatalogTables(
                run,
                read.catalog,
                tablesClause(read.tables),
              )),
            );
            continue;
          } catch (err) {
            if (isAbort(err)) throw err;
            failure = err;
          }
        }
        skipped.push({ catalog: read.catalog, error: failure });
      }
      this.logSkipped('tables', skipped, plan.length);
      return out;
    });
  }

  /**
   * The catalogs (and, for a reached scope, the schemas and tables) the
   * catalogue reads cover: the scope's reach when `withSessions` was given
   * one, else every catalog the user can list.
   */
  private async catalogPlan(run: Run): Promise<CatalogRead[]> {
    const reach = this.scope?.reach;
    if (reach) return catalogReads(reach);
    return (await listUserCatalogs(run)).map((catalog) => ({ catalog }));
  }

  /** One warning for every catalog a catalogue read had to skip. */
  private logSkipped(
    what: string,
    skipped: SkippedCatalog[],
    total: number,
  ): void {
    if (skipped.length === 0) return;
    this.logger.warn(skippedCatalogsMessage(what, skipped, total));
  }

  async keys(config: DatabricksConfig): Promise<KeyConstraint[]> {
    return this.withSession(config, async (run) => {
      const keys: KeyConstraint[] = [];
      const plan = await this.catalogPlan(run);
      const skipped: SkippedCatalog[] = [];
      for (const { catalog, schemas } of plan) {
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
               AND tc.table_schema <> 'information_schema'${inClause('tc.table_schema', schemas)}
             ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`,
          );
        } catch (err) {
          if (isAbort(err)) throw err;
          skipped.push({ catalog, error: err });
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
      this.logSkipped('keys', skipped, plan.length);
      return keys;
    });
  }

  async foreignKeys(config: DatabricksConfig): Promise<FkEdge[]> {
    try {
      return await this.withSession(config, async (run) => {
        const edges: FkEdge[] = [];
        const plan = await this.catalogPlan(run);
        const skipped: SkippedCatalog[] = [];
        for (const { catalog, schemas } of plan) {
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
               WHERE kcu.table_schema <> 'information_schema'${inClause('kcu.table_schema', schemas)}
               ORDER BY kcu.table_schema, kcu.table_name, kcu.constraint_name, kcu.ordinal_position`,
            );
          } catch (err) {
            if (isAbort(err)) throw err;
            skipped.push({ catalog, error: err });
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
        this.logSkipped('foreignKeys', skipped, plan.length);
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

/**
 * One catalog's tables and columns from its `information_schema`, narrowed by
 * `filter` (an ` AND …` clause over `table_schema` / `table_name`).
 */
async function readCatalogTables(
  run: Run,
  catalog: string,
  filter: string,
): Promise<ProfiledTable[]> {
  const base = `${qIdent(catalog)}.information_schema`;
  const where = `WHERE table_schema <> 'information_schema'${filter}`;
  const cols = await run(
    `SELECT table_schema, table_name, column_name, full_data_type, is_nullable
             FROM ${base}.columns ${where}
             ORDER BY table_schema, table_name, ordinal_position`,
  );
  const tabs = await run(
    `SELECT table_schema, table_name, last_altered
             FROM ${base}.tables ${where}
             ORDER BY table_schema, table_name`,
  );
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
  return [...byTable.values()];
}

/**
 * A reach as catalog reads, in name order: each catalog with its schemas
 * and the reach's own tables in it. A namespace that is not
 * `catalog.schema` is ignored.
 */
export function catalogReads(reach: ProfilingReach): CatalogRead[] {
  const byCatalog = new Map<
    string,
    { schemas: Set<string>; tables: Map<string, CatalogTable> }
  >();
  const entry = (namespace: string) => {
    const i = namespace.indexOf('.');
    if (i <= 0 || i === namespace.length - 1) return undefined;
    const catalog = namespace.slice(0, i);
    const schema = namespace.slice(i + 1);
    let e = byCatalog.get(catalog);
    if (!e) {
      e = { schemas: new Set(), tables: new Map() };
      byCatalog.set(catalog, e);
    }
    e.schemas.add(schema);
    return { e, schema };
  };
  for (const namespace of reach.namespaces) entry(namespace);
  for (const t of reach.entities ?? []) {
    const found = entry(t.namespace);
    if (!found || !t.name) continue;
    found.e.tables.set(`${found.schema}\u0000${t.name}`, {
      schema: found.schema,
      name: t.name,
    });
  }
  return [...byCatalog.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([catalog, e]) => ({
      catalog,
      schemas: [...e.schemas].sort(),
      ...(e.tables.size > 0 ? { tables: [...e.tables.values()] } : {}),
    }));
}

type CatalogTable = { schema: string; name: string };

/** ` AND <column> IN ('a', 'b')`, or nothing when `values` is absent or empty. */
function inClause(column: string, values?: string[]): string {
  if (!values?.length) return '';
  return ` AND ${column} IN (${values.map(qStr).join(', ')})`;
}

/** ` AND (<schema and name match one of the tables>)`. */
function tablesClause(tables: CatalogTable[]): string {
  const any = tables
    .map(
      (t) =>
        `(table_schema = ${qStr(t.schema)} AND table_name = ${qStr(t.name)})`,
    )
    .join(' OR ');
  return ` AND (${any})`;
}

/**
 * The one warning for the catalogs a catalogue read skipped: how many of
 * how many, then the first few by name with their reason on one line.
 */
export function skippedCatalogsMessage(
  what: string,
  skipped: { catalog: string; error: unknown }[],
  total: number,
): string {
  const named = skipped
    .slice(0, MAX_SKIPPED_NAMED)
    .map((s) => `"${s.catalog}" (${oneLineReason(s.error)})`);
  const more = skipped.length - named.length;
  return `[${what}] skipped ${skipped.length} of ${total} catalog(s): ${named.join('; ')}${
    more > 0 ? `; and ${more} more` : ''
  }`;
}

function oneLineReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_SKIP_REASON
    ? `${flat.slice(0, MAX_SKIP_REASON - 1)}…`
    : flat;
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

/** One sampled value as text: Date to ISO, bigint to decimal text, objects to JSON, null stays null. */
function sampleValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return scalar(v);
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
