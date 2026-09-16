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
  MASKED,
  splitEntity,
} from './connector';

// Timeouts mirrored from data-readiness-agent's Databricks connector: fast
// metadata queries vs slower information_schema walks, plus a cap on
// concurrent catalog sessions. Agent queries get a generous budget because
// a cold warehouse can take minutes to start.
const TEST_TIMEOUT_MS = 30_000;
const CATALOG_QUERY_TIMEOUT_MS = 15_000;
const CATALOG_INVENTORY_TIMEOUT_MS = 60_000;
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

  /** SHOW CATALOGS, then walk each non-system catalog's information_schema. */
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

    const result: CatalogInfo[] = [];
    for (let i = 0; i < catalogs.length; i += INVENTORY_CONCURRENCY) {
      const batch = catalogs.slice(i, i + INVENTORY_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((catalog) => this.walkCatalog(config, catalog)),
      );
      settled.forEach((r, j) => {
        if (r.status === 'fulfilled') result.push(r.value);
        else
          this.logger.warn(
            `Skipping catalog ${batch[j]} during inventory: ${(r.reason as Error).message}`,
          );
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));

    // Flag browse-only objects so the UI can grey out what the credentials
    // cannot query. Best-effort: a probe failure leaves `selectable` unset,
    // and everything renders as accessible.
    try {
      await this.annotateAccess(config, result);
    } catch (err) {
      this.logger.warn(
        `Skipping access annotation during inventory: ${(err as Error).message}`,
      );
    }
    return result;
  }

  /**
   * Set `selectable` on every catalog/schema/table from Unity Catalog's
   * `include_browse` listings: an object is accessible when it is returned
   * without `browse_only: true`. Catalog access is probed once; schema access
   * is probed per catalog and cascades to that schema's tables.
   */
  private async annotateAccess(
    config: DatabricksConfig,
    catalogs: CatalogInfo[],
  ): Promise<void> {
    const accessibleCatalogs = await this.listAccessible(config, 'catalogs');
    for (const catalog of catalogs) {
      catalog.selectable = accessibleCatalogs.has(catalog.name);
    }
    for (const catalog of catalogs) {
      try {
        const accessibleSchemas = await this.listAccessible(
          config,
          'schemas',
          catalog.name,
        );
        for (const schema of catalog.schemas) {
          const accessible = accessibleSchemas.has(schema.name);
          schema.selectable = accessible;
          for (const table of schema.tables) table.selectable = accessible;
        }
      } catch (err) {
        // Leave this catalog's schemas unflagged (accessible) on a soft
        // failure rather than dropping the whole annotation pass.
        this.logger.warn(
          `Skipping schema access probe for ${catalog.name}: ${(err as Error).message}`,
        );
      }
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
    config: DatabricksConfig,
    catalog: string,
  ): Promise<CatalogInfo> {
    const { client, session } = await this.openSession(
      config,
      CATALOG_INVENTORY_TIMEOUT_MS,
    );
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
        arr.push({
          name: String(row['column_name']),
          type: String(row['full_data_type']),
          nullable: String(row['is_nullable']).toUpperCase() === 'YES',
        });
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
      await client.close();
    }
  }

  private async openSession(
    config: DatabricksConfig,
    timeoutMs: number,
  ): Promise<{ client: DBSQLClient; session: IDBSQLSession }> {
    const client = new DBSQLClient();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Databricks connection timed out after ${timeoutMs / 1000}s`,
            ),
          ),
        timeoutMs,
      ),
    );
    const connect = (async () => {
      await client.connect({
        host: config.host,
        path: `/sql/1.0/warehouses/${config.warehouseId}`,
        authType: 'access-token',
        token: config.token,
        socketTimeout: timeoutMs,
      });
      const session = await client.openSession();
      return { client, session };
    })();
    return Promise.race([connect, timeout]);
  }

  private async fetchWithTimeout(
    op: IOperation,
    timeoutMs: number,
  ): Promise<Record<string, unknown>[]> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Databricks query timed out after ${timeoutMs / 1000}s`),
          ),
        timeoutMs,
      ),
    );
    const result: unknown = await Promise.race([op.fetchAll(), timeout]);
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
