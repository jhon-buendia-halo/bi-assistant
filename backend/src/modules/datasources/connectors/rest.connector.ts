import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  CatalogInfo,
  ColumnInfo,
  QueryResult,
  RestApiConfig,
  RestEndpointDef,
  SchemaInfo,
  TableInfo,
} from '../entities/datasource.entity';
import {
  assertReadOnlySql,
  clampRows,
  DatasourceConnector,
  mapWithConcurrency,
  MASKED,
  splitEntity,
} from './connector';

const CATALOG = 'api';
const REQUEST_TIMEOUT_MS = 20_000;
const FETCH_BUDGET_MS = 120_000;
const MAX_PAGES = 50;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ROWS = 10_000;
const INVENTORY_SAMPLE_ROWS = 50;
const INVENTORY_CONCURRENCY = 4;
const MAX_FLATTEN_DEPTH = 3;
const ERROR_EXCERPT_CHARS = 200;

type ColumnType = 'string' | 'number' | 'boolean' | 'json';
type RawRow = Record<string, unknown>;

interface ResolvedEndpoint {
  key: string;
  schema: string;
  table: string;
  def: RestEndpointDef;
}

interface FetchOptions {
  pageSize?: number;
}

/**
 * REST API connector. Endpoints declared on the datasource are exposed as
 * tables under a single `api` catalog; SQL runs by materialising the
 * referenced endpoints into an in-memory SQLite database per call.
 */
@Injectable()
export class RestConnector implements DatasourceConnector<RestApiConfig> {
  private readonly logger = new Logger(RestConnector.name);

  summary(config: RestApiConfig): string {
    const count = config.endpoints?.length ?? 0;
    return `REST API · ${config.baseUrl} · ${count} endpoint${count === 1 ? '' : 's'}`;
  }

  mask(config: RestApiConfig): RestApiConfig {
    const auth = { ...config.auth };
    if (auth.token) auth.token = MASKED;
    if (auth.password) auth.password = MASKED;
    return {
      ...config,
      auth,
      headers: config.headers ? { ...config.headers } : config.headers,
      endpoints: (config.endpoints ?? []).map((e) => ({
        ...e,
        pagination: e.pagination ? { ...e.pagination } : e.pagination,
      })),
    };
  }

  async testConnection(config: RestApiConfig): Promise<void> {
    if (!config.baseUrl?.trim()) {
      throw new BadRequestException('baseUrl is required');
    }
    const [first] = this.endpoints(config);
    if (!first) {
      throw new BadRequestException('At least one endpoint is required');
    }
    await this.fetchRows(config, first.def, 1, { pageSize: 1 });
  }

  async inventory(config: RestApiConfig): Promise<CatalogInfo[]> {
    const endpoints = this.endpoints(config);
    const tables = new Map<string, TableInfo>();
    await mapWithConcurrency(endpoints, INVENTORY_CONCURRENCY, async (ep) => {
      try {
        const rows = await this.fetchRows(
          config,
          ep.def,
          INVENTORY_SAMPLE_ROWS,
        );
        tables.set(ep.key, {
          name: ep.table,
          columns: inferColumns(rows).map(({ name, type, nullable }) => ({
            name,
            type,
            nullable,
          })),
        });
      } catch (err) {
        this.logger.warn(
          `REST inventory skipped endpoint "${ep.def.name}": ${describeError(err)}`,
        );
        tables.set(ep.key, { name: ep.table, columns: [], selectable: false });
      }
    });

    const schemas = new Map<string, SchemaInfo>();
    for (const ep of endpoints) {
      const table = tables.get(ep.key);
      if (!table) continue;
      const schema = schemas.get(ep.schema) ?? {
        name: ep.schema,
        tables: [],
      };
      schema.tables.push(table);
      schemas.set(ep.schema, schema);
    }
    return [{ name: CATALOG, schemas: Array.from(schemas.values()) }];
  }

  async sampleRows(
    config: RestApiConfig,
    entity: string,
    limit: number,
  ): Promise<QueryResult> {
    const ep = this.resolve(config, entity);
    const lim = clampRows(limit, 10, 100);
    const rows = await this.fetchRows(config, ep.def, lim);
    return toQueryResult(rows);
  }

  /**
   * Materialise-then-query: the endpoints the SQL references are fetched into
   * an in-memory SQLite database (one table per endpoint, named by its dotted
   * key) and the statement runs there. Nothing outlives the call.
   */
  async runReadOnlySql(
    config: RestApiConfig,
    sql: string,
    rowLimit: number,
  ): Promise<QueryResult> {
    const safeSql = assertReadOnlySql(sql);
    const lim = clampRows(rowLimit, 100, 500);
    const endpoints = this.endpoints(config);
    const { sql: rewritten, refs } = rewriteReferences(safeSql);
    const referenced = endpoints.filter((e) => refs.has(e.key));
    const toLoad = referenced.length ? referenced : endpoints;

    const loaded = new Map<string, RawRow[]>();
    await mapWithConcurrency(toLoad, INVENTORY_CONCURRENCY, async (ep) => {
      loaded.set(
        ep.key,
        await this.fetchRows(
          config,
          ep.def,
          ep.def.maxRows && ep.def.maxRows > 0
            ? ep.def.maxRows
            : DEFAULT_MAX_ROWS,
        ),
      );
    });

    const BetterSqlite3 =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new BetterSqlite3(':memory:');
    try {
      for (const ep of toLoad) {
        materialise(db, ep.key, loaded.get(ep.key) ?? []);
      }
      const statement = db.prepare(rewritten);
      const rows = statement.all() as Record<string, unknown>[];
      return {
        columns: statement.columns().map((c) => c.name),
        rows: rows.slice(0, lim),
      };
    } finally {
      db.close();
    }
  }

  private endpoints(config: RestApiConfig): ResolvedEndpoint[] {
    const seen = new Set<string>();
    const resolved: ResolvedEndpoint[] = [];
    for (const def of config.endpoints ?? []) {
      const schema = sanitizeIdent(def.group) || 'default';
      const table = sanitizeIdent(def.name);
      if (!table) continue;
      const key = `${CATALOG}.${schema}.${table}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push({ key, schema, table, def });
    }
    return resolved;
  }

  private resolve(config: RestApiConfig, entity: string): ResolvedEndpoint {
    const [catalog, schema, table] = splitEntity(entity);
    const key = `${catalog}.${schema}.${table}`.toLowerCase();
    const found =
      catalog.toLowerCase() === CATALOG
        ? this.endpoints(config).find((e) => e.key === key)
        : undefined;
    if (!found) {
      throw new BadRequestException(
        `Entity "${entity}" is not an endpoint of this datasource`,
      );
    }
    return found;
  }

  /** Pages through one endpoint until `limit` rows, an empty page, or a cap. */
  private async fetchRows(
    config: RestApiConfig,
    endpoint: RestEndpointDef,
    limit: number,
    options: FetchOptions = {},
  ): Promise<RawRow[]> {
    const pagination = endpoint.pagination;
    const style = pagination?.style ?? 'none';
    const pageSize = Math.max(
      1,
      Math.floor(options.pageSize ?? pagination?.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const deadline = Date.now() + FETCH_BUDGET_MS;
    const collected: RawRow[] = [];
    let page = 1;
    let offset = 0;
    let cursor: string | undefined;

    for (let i = 0; i < MAX_PAGES; i++) {
      const params: Record<string, string> = {};
      if (style === 'page') {
        params[pagination?.pageParam || 'page'] = String(page);
        params[pagination?.sizeParam || 'per_page'] = String(pageSize);
      } else if (style === 'offset') {
        params[pagination?.offsetParam || 'offset'] = String(offset);
        params[pagination?.sizeParam || 'limit'] = String(pageSize);
      } else if (style === 'cursor' && cursor) {
        params[pagination?.cursorParam || 'cursor'] = cursor;
      }

      const body = await this.requestJson(
        config,
        endpoint,
        params,
        Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()),
      );
      const rows = extractRows(body, endpoint.rowsPointer);
      if (style === 'none') {
        collected.push(...rows);
        break;
      }
      if (!rows.length) break;
      collected.push(...rows);
      if (collected.length >= limit) break;
      if (Date.now() >= deadline) break;

      if (style === 'page') page += 1;
      else if (style === 'offset') offset += rows.length;
      else {
        const next = pagination?.cursorPointer
          ? resolvePointer(body, pagination.cursorPointer)
          : undefined;
        if (typeof next !== 'string' && typeof next !== 'number') break;
        if (next === '') break;
        cursor = String(next);
      }
    }
    return collected.slice(0, limit).map(flattenRow);
  }

  private async requestJson(
    config: RestApiConfig,
    endpoint: RestEndpointDef,
    params: Record<string, string>,
    timeoutMs: number,
  ): Promise<unknown> {
    const label = `endpoint "${endpoint.name}"`;
    if (timeoutMs <= 0) {
      throw new Error(`REST API — ${label}: time budget exhausted`);
    }
    const url = buildUrl(config.baseUrl, endpoint.path, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(config),
        signal: controller.signal,
      });
      if (!response.ok) {
        const excerpt = (await response.text().catch(() => ''))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, ERROR_EXCERPT_CHARS);
        throw new Error(
          `REST API — ${label}: HTTP ${response.status}${excerpt ? ` — ${excerpt}` : ''}`,
        );
      }
      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`REST API — ${label}: response is not valid JSON`);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `REST API — ${label}: request timed out after ${Math.round(timeoutMs / 1000)}s`,
        );
      }
      if (err instanceof Error && err.message.startsWith('REST API')) {
        throw err;
      }
      throw new Error(`REST API — ${label}: ${describeError(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? cause.message : '';
    return [err.message, causeMessage].filter(Boolean).join(' — ');
  }
  return String(err) || 'unknown error';
}

function sanitizeIdent(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}

function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): string {
  const trimmed = (path ?? '').trim();
  const full = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${baseUrl.trim().replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
  const url = new URL(full);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

function buildHeaders(config: RestApiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(config.headers ?? {}),
  };
  const auth = config.auth;
  if (auth?.type === 'bearer' && auth.token) {
    headers['Authorization'] = `Bearer ${auth.token}`;
  } else if (auth?.type === 'api-key-header' && auth.token) {
    headers[auth.headerName?.trim() || 'X-API-Key'] = auth.token;
  } else if (auth?.type === 'basic') {
    const credentials = `${auth.username ?? ''}:${auth.password ?? ''}`;
    headers['Authorization'] =
      `Basic ${Buffer.from(credentials).toString('base64')}`;
  }
  return headers;
}

/** RFC 6901 lookup; empty pointer is the root, a missing path is `undefined`. */
function resolvePointer(body: unknown, pointer: string | undefined): unknown {
  const trimmed = (pointer ?? '').trim();
  if (!trimmed) return body;
  const segments = trimmed
    .replace(/^\//, '')
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = body;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function extractRows(body: unknown, pointer: string | undefined): RawRow[] {
  const value = resolvePointer(body, pointer);
  const where = pointer?.trim() ? `at "${pointer.trim()}"` : 'at the root';
  if (Array.isArray(value)) {
    return value.map((item) =>
      isPlainObject(item) ? item : { value: item as unknown },
    );
  }
  if (isPlainObject(value)) return [value];
  throw new Error(
    `REST API — expected an array or object ${where}, got ${value === undefined ? 'nothing' : typeof value}`,
  );
}

function isPlainObject(value: unknown): value is RawRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Nested objects become dot-keys down to `MAX_FLATTEN_DEPTH` levels; arrays
 * and anything deeper stay as raw values (typed `json`, serialised on read).
 */
function flattenRow(row: RawRow): RawRow {
  const out: RawRow = {};
  const walk = (obj: RawRow, prefix: string, depth: number) => {
    for (const [key, value] of Object.entries(obj)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (value === undefined || value === null) {
        out[name] = null;
      } else if (
        isPlainObject(value) &&
        depth < MAX_FLATTEN_DEPTH &&
        Object.keys(value).length
      ) {
        walk(value, name, depth + 1);
      } else {
        out[name] = value;
      }
    }
  };
  walk(row, '', 0);
  return out;
}

function typeOf(value: unknown): ColumnType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'json';
}

/** Serialise a flattened value for output: json values become strings. */
function scalar(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

/** Union of columns across rows; type from the first non-null value. */
function inferColumns(rows: RawRow[]): (ColumnInfo & { type: ColumnType })[] {
  const columns = new Map<string, { type?: ColumnType; nullable: boolean }>();
  for (const row of rows) {
    for (const [name, value] of Object.entries(row)) {
      const column = columns.get(name) ?? { nullable: false };
      if (value === null || value === undefined) column.nullable = true;
      else column.type ??= typeOf(value);
      columns.set(name, column);
    }
  }
  return Array.from(columns.entries()).map(([name, column]) => ({
    name,
    type: column.type ?? 'string',
    nullable: column.nullable || rows.some((row) => !Object.hasOwn(row, name)),
  }));
}

function toQueryResult(rows: RawRow[]): QueryResult {
  const columns = inferColumns(rows).map((c) => c.name);
  return {
    columns,
    rows: rows.map((row) =>
      Object.fromEntries(columns.map((name) => [name, scalar(row[name])])),
    ),
  };
}

const REFERENCE =
  /"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![\w.])api\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/gi;
const QUOTED_REFERENCE = /^"api\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)"$/i;

/**
 * Swap each unquoted `api.schema.table` for the double-quoted literal table
 * name it is materialised under, and report which keys were referenced.
 */
function rewriteReferences(sql: string): { sql: string; refs: Set<string> } {
  const refs = new Set<string>();
  const rewritten = sql.replace(
    REFERENCE,
    (match: string, schema?: string, table?: string) => {
      if (schema !== undefined && table !== undefined) {
        const key = `${CATALOG}.${schema}.${table}`.toLowerCase();
        refs.add(key);
        return `"${key}"`;
      }
      const quoted = QUOTED_REFERENCE.exec(match);
      if (quoted)
        refs.add(`${CATALOG}.${quoted[1]}.${quoted[2]}`.toLowerCase());
      return match;
    },
  );
  return { sql: rewritten, refs };
}

function qIdent(ident: string): string {
  return ident.replace(/"/g, '""');
}

function materialise(
  db: import('better-sqlite3').Database,
  key: string,
  rows: RawRow[],
): void {
  const columns = inferColumns(rows);
  if (!columns.length) {
    db.exec(`CREATE TABLE "${qIdent(key)}" ("_empty" TEXT)`);
    return;
  }
  const affinity: Record<ColumnType, string> = {
    string: 'TEXT',
    number: 'REAL',
    boolean: 'INTEGER',
    json: 'TEXT',
  };
  db.exec(
    `CREATE TABLE "${qIdent(key)}" (${columns
      .map((c) => `"${qIdent(c.name)}" ${affinity[c.type]}`)
      .join(', ')})`,
  );
  const insert = db.prepare(
    `INSERT INTO "${qIdent(key)}" VALUES (${columns.map(() => '?').join(', ')})`,
  );
  db.transaction(() => {
    for (const row of rows) {
      insert.run(
        columns.map((c) => {
          const value = scalar(row[c.name]);
          return typeof value === 'boolean' ? (value ? 1 : 0) : value;
        }),
      );
    }
  })();
}
