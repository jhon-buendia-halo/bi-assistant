import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';
import type IOperation from '@databricks/sql/dist/contracts/IOperation';
import { TestConnectionDto } from './dto/test-connection.dto';
import { ConnectionsRepository } from './repositories/connections.repository';

// Hard wall-clock timeout so a request can never hang on a cold warehouse.
const TEST_TIMEOUT_MS = 30_000;
// Inventory constants mirrored from data-readiness-agent's Databricks
// connector: fast metadata queries vs slower information_schema walks, and a
// cap on concurrent catalog sessions.
const CATALOG_QUERY_TIMEOUT_MS = 15_000;
// Agent tool queries — a cold warehouse can take minutes to start.
const QUERY_TIMEOUT_MS = 120_000;
const CATALOG_INVENTORY_TIMEOUT_MS = 60_000;
const INVENTORY_CONCURRENCY = 5;

const SYSTEM_CATALOGS = new Set(['system', '__databricks_internal']);
const SYSTEM_SCHEMAS = new Set(['information_schema']);

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

export interface CatalogInfo {
  name: string;
  schemas: SchemaInfo[];
}

interface ConnectionConfig {
  host: string;
  token: string;
  warehouseId: string;
}

@Injectable()
export class DatabricksService {
  private readonly logger = new Logger(DatabricksService.name);

  constructor(private readonly connectionsRepository: ConnectionsRepository) {}

  async testConnection(dto: TestConnectionDto): Promise<void> {
    const config = this.validate(dto);
    this.logger.log(
      `[testConnection] Connecting to host=${config.host} warehouse=${config.warehouseId}...`,
    );
    const { client, session } = await this.openSession(config, TEST_TIMEOUT_MS);
    try {
      const op = await session.executeStatement('SELECT 1');
      await op.fetchAll();
      this.logger.log('[testConnection] SUCCESS — connection verified');
    } finally {
      await session.close();
      await client.close();
    }
  }

  /**
   * Unity Catalog inventory over the SAVED connection, mirrored from
   * data-readiness-agent: SHOW CATALOGS, then walk each non-system catalog's
   * information_schema (tables + columns) with bounded concurrency. Catalogs
   * that fail or time out are skipped with a WARN rather than failing the
   * whole inventory.
   */
  async inventory(): Promise<CatalogInfo[]> {
    const saved = await this.connectionsRepository.get();
    if (!saved) {
      throw new BadRequestException(
        'No Databricks connection saved — configure and save it in Databricks Configuration first',
      );
    }
    const config = this.validate(saved);

    // Step 1: list catalogs with a dedicated short-lived session.
    const { client, session } = await this.openSession(config, TEST_TIMEOUT_MS);
    let catalogs: string[];
    try {
      const op = await session.executeStatement('SHOW CATALOGS');
      const res = await this.fetchWithTimeout(op, CATALOG_QUERY_TIMEOUT_MS);
      catalogs = (res ?? [])
        .map((row: any) =>
          String(row.catalog ?? Object.values(row ?? {})[0] ?? ''),
        )
        .filter((c) => c && !SYSTEM_CATALOGS.has(c.toLowerCase()));
    } finally {
      await session.close();
      await client.close();
    }
    this.logger.log(
      `[inventory] Found ${catalogs.length} non-system catalogs — walking ${INVENTORY_CONCURRENCY} at a time`,
    );

    // Step 2: walk catalogs in parallel batches (one session per catalog).
    const result: CatalogInfo[] = [];
    for (let i = 0; i < catalogs.length; i += INVENTORY_CONCURRENCY) {
      const batch = catalogs.slice(i, i + INVENTORY_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((catalog) => this.walkCatalog(config, catalog)),
      );
      for (let j = 0; j < batch.length; j++) {
        const r = settled[j];
        if (r.status === 'fulfilled') {
          result.push(r.value);
        } else {
          this.logger.warn(
            `Skipping catalog ${batch[j]} during inventory: ${(r.reason as Error).message}`,
          );
        }
      }
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /** `SELECT * LIMIT n` over one fully-qualified table on the saved connection. */
  async sampleRows(
    entity: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const fq = qualifyEntity(entity);
    const lim = Math.max(1, Math.min(100, Math.floor(limit) || 10));
    return this.runReadOnlySql(`SELECT * FROM ${fq} LIMIT ${lim}`, lim);
  }

  /** Guarded read-only SQL over the saved connection (single SELECT/WITH). */
  async runReadOnlySql(
    sql: string,
    rowLimit = 100,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const safeSql = assertReadOnlySql(sql);
    const saved = await this.connectionsRepository.get();
    if (!saved) {
      throw new BadRequestException('No Databricks connection saved');
    }
    const config = this.validate(saved);
    // Generous timeout — agent queries often hit a cold warehouse.
    const { client, session } = await this.openSession(
      config,
      QUERY_TIMEOUT_MS,
    );
    try {
      const op = await session.executeStatement(safeSql);
      const res = await this.fetchWithTimeout(op, QUERY_TIMEOUT_MS);
      const lim = Math.max(1, Math.min(500, Math.floor(rowLimit) || 100));
      const rows: Record<string, unknown>[] = (res ?? [])
        .slice(0, lim)
        .map((r: unknown) => ({
          ...(typeof r === 'object' && r !== null ? r : {}),
        }));
      const columns = Object.keys(rows[0] ?? {});
      return { columns, rows };
    } finally {
      await session.close();
      await client.close();
    }
  }

  private async walkCatalog(
    config: ConnectionConfig,
    catalog: string,
  ): Promise<CatalogInfo> {
    this.logger.log(`[inventory] Walking catalog: ${catalog}`);
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
      this.logger.log(
        `[inventory] catalog ${catalog}: ${tablesRes.length} tables, ${columnsRes.length} columns`,
      );

      const columnsByTable = new Map<string, ColumnInfo[]>();
      for (const row of columnsRes as any[]) {
        const schemaName = String(row.table_schema);
        if (SYSTEM_SCHEMAS.has(schemaName.toLowerCase())) continue;
        const key = `${schemaName}.${String(row.table_name)}`;
        let arr = columnsByTable.get(key);
        if (!arr) {
          arr = [];
          columnsByTable.set(key, arr);
        }
        arr.push({
          name: String(row.column_name),
          type: String(row.full_data_type),
          nullable: String(row.is_nullable).toUpperCase() === 'YES',
        });
      }

      const schemas = new Map<string, TableInfo[]>();
      for (const row of tablesRes as any[]) {
        const schemaName = String(row.table_schema);
        if (SYSTEM_SCHEMAS.has(schemaName.toLowerCase())) continue;
        const tableName = String(row.table_name);
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
    config: ConnectionConfig,
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
  ): Promise<any[]> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Databricks query timed out after ${timeoutMs / 1000}s`),
          ),
        timeoutMs,
      ),
    );
    return Promise.race([op.fetchAll(), timeout]) as Promise<any[]>;
  }

  private validate(dto: {
    host?: string;
    token?: string;
    warehouseId?: string;
  }): ConnectionConfig {
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

/** `catalog.schema.table` → fully-quoted three-part identifier. */
function qualifyEntity(entity: string): string {
  const parts = (entity ?? '').split('.');
  if (parts.length !== 3 || parts.some((p) => !p.trim())) {
    throw new BadRequestException(
      `Entity must be catalog.schema.table — got "${entity}"`,
    );
  }
  return parts.map((p) => `\`${qIdent(p.trim())}\``).join('.');
}

// Read-only SQL guard, mirrored from data-readiness-agent's connector.
const FORBIDDEN_SQL =
  /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|upsert|replace)\b/i;

export function assertReadOnlySql(sql: string): string {
  const trimmed = (sql ?? '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
  if (!trimmed) throw new BadRequestException('Query is empty.');
  if (trimmed.includes(';')) {
    throw new BadRequestException('Only a single statement may be executed.');
  }
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new BadRequestException(
      'Only read-only SELECT / WITH queries can be run.',
    );
  }
  if (FORBIDDEN_SQL.test(trimmed)) {
    throw new BadRequestException(
      'Query contains a forbidden (write/DDL) keyword.',
    );
  }
  return trimmed;
}
