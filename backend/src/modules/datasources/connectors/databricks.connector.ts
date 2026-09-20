import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';
import type IOperation from '@databricks/sql/dist/contracts/IOperation';
import type {
  CatalogInfo,
  ColumnInfo,
  DatabricksConfig,
  QueryResult,
  TableInfo,
} from '../entities/datasource.entity';
import {
  assertReadOnlySql,
  clampRows,
  DatasourceConnector,
  ForeignKeyEdge,
  MASKED,
  splitEntity,
} from './connector';

// Timeouts mirrored from data-readiness-agent's Databricks connector: fast
// metadata queries vs slower information_schema walks, plus a cap on
// concurrent catalog sessions. Agent queries get a generous budget because
// a cold warehouse can take minutes to start.
const TEST_TIMEOUT_MS = 30_000;
const CATALOG_QUERY_TIMEOUT_MS = 15_000;
// The bulk system.information_schema sweep covers every catalog in one query,
// so it gets a wider budget than the old per-catalog walks had.
const CATALOG_INVENTORY_TIMEOUT_MS = 120_000;
const QUERY_TIMEOUT_MS = 120_000;
const INVENTORY_CONCURRENCY = 5;
// Unity Catalog REST API — used to flag objects the credentials can only
// browse (metadata visible, not queryable). Mirrors data-readiness-agent's
// ADR-0029: the `include_browse=true` listings return `browse_only: true`
// for objects without SELECT, which the warehouse's information_schema walk
// cannot distinguish on its own.
const UC_API_TIMEOUT_MS = 20_000;

const SYSTEM_CATALOGS = new Set(['system', '__databricks_internal']);
const SYSTEM_SCHEMAS = new Set(['information_schema']);

/** One object in a Unity Catalog REST list response. */
interface UcObject {
  name?: string;
  browse_only?: boolean;
}

interface UcListResponse {
  catalogs?: UcObject[];
  schemas?: UcObject[];
  next_page_token?: string;
}

@Injectable()
export class DatabricksConnector implements DatasourceConnector<DatabricksConfig> {
  private readonly logger = new Logger(DatabricksConnector.name);

  summary(config: DatabricksConfig): string {
    return `${config.host} · warehouse ${config.warehouseId}`;
  }

  mask(config: DatabricksConfig): DatabricksConfig {
    return { ...config, token: config.token ? MASKED : '' };
  }

  async testConnection(raw: DatabricksConfig): Promise<void> {
    const config = this.validate(raw);
    const { client, session } = await this.openSession(config, TEST_TIMEOUT_MS);
    try {
      const op = await session.executeStatement('SELECT 1');
      await op.fetchAll();
    } finally {
      await session.close();
      await client.close();
    }
  }

  /**
   * SHOW CATALOGS → drop system and browse-only catalogs → one bulk sweep of
   * `system.information_schema` for every remaining catalog, falling back to
   * per-catalog walks when the credentials cannot read the system catalog.
   */
  async inventory(raw: DatabricksConfig): Promise<CatalogInfo[]> {
    const config = this.validate(raw);
    const { client, session } = await this.openSession(config, TEST_TIMEOUT_MS);
    let catalogs: string[];
    try {
      const op = await session.executeStatement('SHOW CATALOGS');
      const res = await this.fetchWithTimeout(op, CATALOG_QUERY_TIMEOUT_MS);
      catalogs = (res ?? [])
        .map((row) => toText(row['catalog'] ?? Object.values(row)[0]))
        .filter((c) => c && !SYSTEM_CATALOGS.has(c.toLowerCase()));
    } finally {
      await session.close();
      await client.close();
    }

    // Browse-only catalogs cost a session each and yield nothing queryable —
    // skip them before touching the warehouse. `null` = the probe failed, so
    // we keep the old behaviour of walking everything.
    let accessibleCatalogs: Set<string> | null = null;
    try {
      accessibleCatalogs = await this.listAccessible(config, 'catalogs');
      const accessible = accessibleCatalogs;
      const skipped = catalogs.filter((c) => !accessible.has(c));
      if (skipped.length) {
        this.logger.debug(
          `Skipping ${skipped.length} catalogs without query access: ${skipped.join(', ')}`,
        );
      }
      catalogs = catalogs.filter((c) => accessible.has(c));
    } catch (err) {
      this.logger.warn(
        `Catalog access pre-filter failed, walking every catalog: ${(err as Error).message}`,
      );
    }

    let result: CatalogInfo[];
    try {
      result = await this.bulkInventory(config, catalogs);
    } catch (err) {
      this.logger.warn(
        `Bulk inventory from system.information_schema failed, falling back to per-catalog walk: ${(err as Error).message}`,
      );
      result = await this.walkCatalogs(config, catalogs);
    }
    result.sort((a, b) => a.name.localeCompare(b.name));

    // Flag browse-only objects so the UI can grey out what the credentials
    // cannot query. Best-effort: a probe failure leaves `selectable` unset,
    // and everything renders as accessible.
    try {
      await this.annotateAccess(config, result, accessibleCatalogs);
    } catch (err) {
      this.logger.warn(
        `Skipping access annotation during inventory: ${(err as Error).message}`,
      );
    }
    return result;
  }

  /**
   * Whole inventory in one session: two queries against
   * `system.information_schema`, scoped to the accessible catalogs. Catalogs
   * with no visible tables still come back (with no schemas) so the browser
   * lists everything the credentials can reach.
   */
  private async bulkInventory(
    config: DatabricksConfig,
    catalogs: string[],
  ): Promise<CatalogInfo[]> {
    if (!catalogs.length) return [];
    const inList = catalogs.map((c) => `'${qStr(c)}'`).join(', ');
    const { client, session } = await this.openSession(
      config,
      CATALOG_INVENTORY_TIMEOUT_MS,
    );
    try {
      const [tablesOp, columnsOp] = await Promise.all([
        session.executeStatement(
          `SELECT table_catalog, table_schema, table_name
           FROM system.information_schema.tables
           WHERE table_catalog IN (${inList})
             AND table_schema <> 'information_schema'
           ORDER BY table_catalog, table_schema, table_name`,
        ),
        session.executeStatement(
          `SELECT table_catalog, table_schema, table_name, column_name,
                  full_data_type, is_nullable, ordinal_position
           FROM system.information_schema.columns
           WHERE table_catalog IN (${inList})
             AND table_schema <> 'information_schema'
           ORDER BY table_catalog, table_schema, table_name, ordinal_position`,
        ),
      ]);
      const [tablesRes, columnsRes] = await Promise.all([
        this.fetchWithTimeout(tablesOp, CATALOG_INVENTORY_TIMEOUT_MS),
        this.fetchWithTimeout(columnsOp, CATALOG_INVENTORY_TIMEOUT_MS),
      ]);

      const columnsByTable = new Map<string, ColumnInfo[]>();
      for (const row of columnsRes) {
        const schemaName = String(row['table_schema']);
        if (SYSTEM_SCHEMAS.has(schemaName.toLowerCase())) continue;
        const key = `${String(row['table_catalog'])}.${schemaName}.${String(row['table_name'])}`;
        const arr = columnsByTable.get(key) ?? [];
        arr.push(toColumn(row));
        columnsByTable.set(key, arr);
      }
      const byCatalog = new Map<string, Map<string, TableInfo[]>>();
      for (const catalog of catalogs) byCatalog.set(catalog, new Map());
      for (const row of tablesRes) {
        const catalogName = String(row['table_catalog']);
        const schemaName = String(row['table_schema']);
        if (SYSTEM_SCHEMAS.has(schemaName.toLowerCase())) continue;
        const tableName = String(row['table_name']);
        const schemas = byCatalog.get(catalogName);
        if (!schemas) continue;
        const arr = schemas.get(schemaName) ?? [];
        arr.push({
          name: tableName,
          columns:
            columnsByTable.get(`${catalogName}.${schemaName}.${tableName}`) ??
            [],
        });
        schemas.set(schemaName, arr);
      }
      return Array.from(byCatalog.entries()).map(([name, schemas]) => ({
        name,
        schemas: Array.from(schemas.entries()).map(([schema, tables]) => ({
          name: schema,
          tables,
        })),
      }));
    } finally {
      await session.close();
      await client.close();
    }
  }

  /** Per-catalog information_schema walks over one shared client. */
  private async walkCatalogs(
    config: DatabricksConfig,
    catalogs: string[],
  ): Promise<CatalogInfo[]> {
    if (!catalogs.length) return [];
    const client = await this.connect(config, CATALOG_INVENTORY_TIMEOUT_MS);
    const result: CatalogInfo[] = [];
    try {
      for (let i = 0; i < catalogs.length; i += INVENTORY_CONCURRENCY) {
        const batch = catalogs.slice(i, i + INVENTORY_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((catalog) => this.walkCatalog(client, catalog)),
        );
        settled.forEach((r, j) => {
          if (r.status === 'fulfilled') result.push(r.value);
          else
            this.logger.warn(
              `Skipping catalog ${batch[j]} during inventory: ${(r.reason as Error).message}`,
            );
        });
      }
    } finally {
      await client.close();
    }
    return result;
  }

  /**
   * Set `selectable` on every catalog/schema/table from Unity Catalog's
   * `include_browse` listings: an object is accessible when it is returned
   * without `browse_only: true`. Catalog access is reused from the inventory
   * pre-filter when available; schema access is probed per catalog (in
   * batches) and cascades to that schema's tables.
   */
  private async annotateAccess(
    config: DatabricksConfig,
    catalogs: CatalogInfo[],
    accessibleCatalogs: Set<string> | null,
  ): Promise<void> {
    const accessible =
      accessibleCatalogs ?? (await this.listAccessible(config, 'catalogs'));
    for (const catalog of catalogs) {
      catalog.selectable = accessible.has(catalog.name);
    }
    for (let i = 0; i < catalogs.length; i += INVENTORY_CONCURRENCY) {
      const batch = catalogs.slice(i, i + INVENTORY_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((catalog) =>
          this.listAccessible(config, 'schemas', catalog.name),
        ),
      );
      settled.forEach((r, j) => {
        const catalog = batch[j];
        if (r.status !== 'fulfilled') {
          // Leave this catalog's schemas unflagged (accessible) on a soft
          // failure rather than dropping the whole annotation pass.
          this.logger.warn(
            `Skipping schema access probe for ${catalog.name}: ${(r.reason as Error).message}`,
          );
          return;
        }
        for (const schema of catalog.schemas) {
          const schemaAccessible = r.value.has(schema.name);
          schema.selectable = schemaAccessible;
          for (const table of schema.tables)
            table.selectable = schemaAccessible;
        }
      });
    }
  }

  /**
   * Names of catalogs (or schemas within `catalogName`) the credentials can
   * query — i.e. listed without `browse_only: true`. Follows pagination.
   */
  private async listAccessible(
    config: DatabricksConfig,
    kind: 'catalogs' | 'schemas',
    catalogName?: string,
  ): Promise<Set<string>> {
    const accessible = new Set<string>();
    const base = `https://${config.host}/api/2.1/unity-catalog/${kind}`;
    let pageToken: string | undefined;
    do {
      const url = new URL(base);
      url.searchParams.set('include_browse', 'true');
      if (catalogName) url.searchParams.set('catalog_name', catalogName);
      if (pageToken) url.searchParams.set('page_token', pageToken);
      const body = await this.ucFetch(url.toString(), config.token);
      const items = (kind === 'catalogs' ? body.catalogs : body.schemas) ?? [];
      for (const item of items) {
        if (item?.browse_only !== true && typeof item?.name === 'string') {
          accessible.add(item.name);
        }
      }
      pageToken = body.next_page_token;
    } while (pageToken);
    return accessible;
  }

  private async ucFetch(url: string, token: string): Promise<UcListResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UC_API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          `Unity Catalog API ${res.status} ${res.statusText}`.trim(),
        );
      }
      return (await res.json()) as UcListResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Declared foreign keys among `entities`, from each catalog's
   * `information_schema`. Unity Catalog constraints are *informational*
   * (declared, never enforced), so most lakehouse tables have none and the
   * credentials often cannot read `information_schema` at all — both cases are
   * an empty result, not an error. Same tolerance as `inventory()`: one shared
   * client, a session per catalog, and a catalog that refuses is skipped.
   */
  async foreignKeys(
    raw: DatabricksConfig,
    entities: string[],
  ): Promise<ForeignKeyEdge[]> {
    // Constraints live in the catalog of the referencing table, so only the
    // catalogs actually present in the dataset are worth querying.
    const wanted = new Set<string>();
    const catalogs = new Set<string>();
    for (const entity of entities ?? []) {
      const parts = (entity ?? '').split('.').map((p) => p.trim());
      if (parts.length !== 3 || parts.some((p) => !p)) continue;
      if (SYSTEM_CATALOGS.has(parts[0].toLowerCase())) continue;
      wanted.add(parts.join('.').toLowerCase());
      catalogs.add(parts[0]);
    }
    if (!catalogs.size) return [];

    let client: DBSQLClient;
    try {
      const config = this.validate(raw);
      client = await this.connect(config, CATALOG_QUERY_TIMEOUT_MS);
    } catch (err) {
      this.logger.debug(
        `Databricks foreign keys unavailable, continuing without relationship hints: ${(err as Error).message}`,
      );
      return [];
    }

    const list = Array.from(catalogs);
    const rows: Record<string, unknown>[] = [];
    try {
      for (let i = 0; i < list.length; i += INVENTORY_CONCURRENCY) {
        const batch = list.slice(i, i + INVENTORY_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((catalog) => this.catalogForeignKeys(client, catalog)),
        );
        settled.forEach((r, j) => {
          if (r.status === 'fulfilled') rows.push(...r.value);
          else
            this.logger.debug(
              `Skipping catalog ${batch[j]} while reading foreign keys: ${(r.reason as Error).message}`,
            );
        });
      }
    } finally {
      await client.close().catch(() => undefined);
    }

    const edges: ForeignKeyEdge[] = [];
    for (const row of rows) {
      const from = `${toText(row['from_catalog'])}.${toText(row['from_schema'])}.${toText(row['from_table'])}`;
      const to = `${toText(row['to_catalog'])}.${toText(row['to_schema'])}.${toText(row['to_table'])}`;
      // Both ends must be in the dataset, otherwise the hint points at a table
      // the model cannot query.
      if (!wanted.has(from.toLowerCase())) continue;
      if (!wanted.has(to.toLowerCase())) continue;
      edges.push({
        from: { entity: from, column: toText(row['from_column']) },
        to: { entity: to, column: toText(row['to_column']) },
      });
    }
    return edges;
  }

  /**
   * One catalog's referential constraints. `referential_constraints` names the
   * FK and the unique constraint it points at; `key_column_usage` is joined
   * twice (by ordinal position, so composite keys pair up column by column) to
   * resolve both column ends.
   */
  private async catalogForeignKeys(
    client: DBSQLClient,
    catalog: string,
  ): Promise<Record<string, unknown>[]> {
    const schema = `\`${qIdent(catalog)}\`.information_schema`;
    const session = await client.openSession();
    try {
      const op = await session.executeStatement(
        `SELECT tc.table_catalog AS from_catalog,
                tc.table_schema  AS from_schema,
                tc.table_name    AS from_table,
                fk.column_name   AS from_column,
                pk.table_catalog AS to_catalog,
                pk.table_schema  AS to_schema,
                pk.table_name    AS to_table,
                pk.column_name   AS to_column
         FROM ${schema}.referential_constraints rc
         JOIN ${schema}.table_constraints tc
           ON tc.constraint_catalog = rc.constraint_catalog
          AND tc.constraint_schema = rc.constraint_schema
          AND tc.constraint_name = rc.constraint_name
          AND tc.constraint_type = 'FOREIGN KEY'
         JOIN ${schema}.key_column_usage fk
           ON fk.constraint_catalog = rc.constraint_catalog
          AND fk.constraint_schema = rc.constraint_schema
          AND fk.constraint_name = rc.constraint_name
         JOIN ${schema}.key_column_usage pk
           ON pk.constraint_catalog = rc.unique_constraint_catalog
          AND pk.constraint_schema = rc.unique_constraint_schema
          AND pk.constraint_name = rc.unique_constraint_name
          AND pk.ordinal_position = fk.ordinal_position
         WHERE tc.table_schema <> 'information_schema'
         ORDER BY from_schema, from_table, from_column`,
      );
      return await this.fetchWithTimeout(op, CATALOG_QUERY_TIMEOUT_MS);
    } finally {
      await session.close();
    }
  }

  async sampleRows(
    config: DatabricksConfig,
    entity: string,
    limit: number,
  ): Promise<QueryResult> {
    const [catalog, schema, table] = splitEntity(entity);
    const fq = [catalog, schema, table]
      .map((p) => `\`${qIdent(p)}\``)
      .join('.');
    const lim = clampRows(limit, 10, 100);
    return this.runReadOnlySql(config, `SELECT * FROM ${fq} LIMIT ${lim}`, lim);
  }

  async runReadOnlySql(
    raw: DatabricksConfig,
    sql: string,
    rowLimit: number,
  ): Promise<QueryResult> {
    const safeSql = assertReadOnlySql(sql);
    const config = this.validate(raw);
    const { client, session } = await this.openSession(
      config,
      QUERY_TIMEOUT_MS,
    );
    try {
      const op = await session.executeStatement(safeSql);
      const res = await this.fetchWithTimeout(op, QUERY_TIMEOUT_MS);
      const lim = clampRows(rowLimit, 100, 500);
      const rows: Record<string, unknown>[] = (res ?? [])
        .slice(0, lim)
        .map((r: unknown) => ({
          ...(typeof r === 'object' && r !== null ? r : {}),
        }));
      return { columns: Object.keys(rows[0] ?? {}), rows };
    } finally {
      await session.close();
      await client.close();
    }
  }

  private async walkCatalog(
    client: DBSQLClient,
    catalog: string,
  ): Promise<CatalogInfo> {
    const session = await client.openSession();
    try {
      const [tablesOp, columnsOp] = await Promise.all([
        session.executeStatement(
          `SELECT table_schema, table_name
           FROM \`${qIdent(catalog)}\`.information_schema.tables
           WHERE table_schema <> 'information_schema'
           ORDER BY table_schema, table_name`,
        ),
        session.executeStatement(
          `SELECT table_schema, table_name, column_name, full_data_type,
                  is_nullable, ordinal_position
           FROM \`${qIdent(catalog)}\`.information_schema.columns
           WHERE table_schema <> 'information_schema'
           ORDER BY table_schema, table_name, ordinal_position`,
        ),
      ]);
      const [tablesRes, columnsRes] = await Promise.all([
        this.fetchWithTimeout(tablesOp, CATALOG_INVENTORY_TIMEOUT_MS),
        this.fetchWithTimeout(columnsOp, CATALOG_INVENTORY_TIMEOUT_MS),
      ]);

      const columnsByTable = new Map<string, ColumnInfo[]>();
      for (const row of columnsRes) {
        const schemaName = String(row['table_schema']);
        if (SYSTEM_SCHEMAS.has(schemaName.toLowerCase())) continue;
        const key = `${schemaName}.${String(row['table_name'])}`;
        const arr = columnsByTable.get(key) ?? [];
        arr.push(toColumn(row));
        columnsByTable.set(key, arr);
      }
      const schemas = new Map<string, TableInfo[]>();
      for (const row of tablesRes) {
        const schemaName = String(row['table_schema']);
        if (SYSTEM_SCHEMAS.has(schemaName.toLowerCase())) continue;
        const tableName = String(row['table_name']);
        const arr = schemas.get(schemaName) ?? [];
        arr.push({
          name: tableName,
          columns: columnsByTable.get(`${schemaName}.${tableName}`) ?? [],
        });
        schemas.set(schemaName, arr);
      }
      return {
        name: catalog,
        schemas: Array.from(schemas.entries()).map(([name, tables]) => ({
          name,
          tables,
        })),
      };
    } finally {
      await session.close();
    }
  }

  private async connect(
    config: DatabricksConfig,
    timeoutMs: number,
  ): Promise<DBSQLClient> {
    const client = new DBSQLClient();
    const connect = (async () => {
      await client.connect({
        host: config.host,
        path: `/sql/1.0/warehouses/${config.warehouseId}`,
        authType: 'access-token',
        token: config.token,
        socketTimeout: timeoutMs,
      });
      return client;
    })();
    return raceTimeout(connect, timeoutMs, 'connection');
  }

  private async openSession(
    config: DatabricksConfig,
    timeoutMs: number,
  ): Promise<{ client: DBSQLClient; session: IDBSQLSession }> {
    const client = await this.connect(config, timeoutMs);
    const session = await client.openSession();
    return { client, session };
  }

  private async fetchWithTimeout(
    op: IOperation,
    timeoutMs: number,
  ): Promise<Record<string, unknown>[]> {
    const result: unknown = await raceTimeout(
      op.fetchAll(),
      timeoutMs,
      'query',
    );
    if (!Array.isArray(result)) return [];
    return result.filter(isRecord);
  }

  private validate(dto: Partial<DatabricksConfig>): DatabricksConfig {
    const host = (dto.host ?? '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    const token = (dto.token ?? '').trim();
    const warehouseId = (dto.warehouseId ?? '').trim();
    if (!host || !token || !warehouseId) {
      throw new BadRequestException('host, token and warehouseId are required');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(host)) {
      throw new BadRequestException(`Invalid Databricks hostname: ${host}`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(warehouseId)) {
      throw new BadRequestException(
        `Invalid Databricks warehouse id: ${warehouseId}`,
      );
    }
    return { host, token, warehouseId };
  }
}

/** Backtick-escape a Unity Catalog identifier for interpolation. */
function qIdent(ident: string): string {
  return ident.replace(/`/g, '``');
}

/** Reject when `work` outlives `timeoutMs`; the timer never outlives the race. */
function raceTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  what: 'connection' | 'query',
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Databricks ${what} timed out after ${timeoutMs / 1000}s`),
        ),
      timeoutMs,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Escape a value for interpolation inside a SQL string literal. */
function qStr(value: string): string {
  return value.replace(/'/g, "''");
}

/** One information_schema.columns row → `ColumnInfo`. */
function toColumn(row: Record<string, unknown>): ColumnInfo {
  return {
    name: String(row['column_name']),
    type: String(row['full_data_type']),
    nullable: String(row['is_nullable']).toUpperCase() === 'YES',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return '';
}
