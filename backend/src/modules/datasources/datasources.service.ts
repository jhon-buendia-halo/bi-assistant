import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabricksConnector } from './connectors/databricks.connector';
import { PostgresConnector } from './connectors/postgres.connector';
import { RestConnector } from './connectors/rest.connector';
import type {
  DatasourceConnector,
  ForeignKeyEdge,
} from './connectors/connector';
import { mapWithConcurrency, MASKED } from './connectors/connector';
import { DatasourcesRepository } from './repositories/datasources.repository';
import { InventoryCacheRepository } from './repositories/inventory-cache.repository';
import {
  CatalogInfo,
  DatabricksConfig,
  Datasource,
  DatasourceConfig,
  DatasourceKind,
  DatasourceView,
  DATASOURCE_KINDS,
  PostgresConfig,
  QueryResult,
  RestApiConfig,
} from './entities/datasource.entity';

/** Kind-agnostic entry point: resolves a datasource and dispatches to its connector. */
@Injectable()
export class DatasourcesService {
  private readonly logger = new Logger(DatasourcesService.name);

  constructor(
    private readonly repository: DatasourcesRepository,
    private readonly inventoryCache: InventoryCacheRepository,
    private readonly databricks: DatabricksConnector,
    private readonly postgres: PostgresConnector,
    private readonly rest: RestConnector,
  ) {}

  connector(kind: DatasourceKind): DatasourceConnector {
    if (!DATASOURCE_KINDS.includes(kind)) {
      throw new BadRequestException(
        `kind must be one of: ${DATASOURCE_KINDS.join(', ')}`,
      );
    }
    switch (kind) {
      case 'postgres':
        return this.postgres;
      case 'rest':
        return this.rest;
      default:
        return this.databricks;
    }
  }

  async list(): Promise<DatasourceView[]> {
    return (await this.repository.list()).map((d) => this.view(d));
  }

  async get(id: string): Promise<Datasource> {
    const found = await this.repository.get(id);
    if (!found) throw new NotFoundException(`Datasource ${id} not found`);
    return found;
  }

  /** Preferred datasource — used to bind datasets created before datasources existed. */
  async defaultDatasource(): Promise<
    Pick<Datasource, 'id' | 'kind'> | undefined
  > {
    const all = await this.repository.list();
    const datasource = all.find((d) => d.kind === 'databricks') ?? all[0];
    return datasource
      ? { id: datasource.id, kind: datasource.kind }
      : undefined;
  }

  async testConnection(
    kind: DatasourceKind,
    config: DatasourceConfig,
    id?: string,
  ): Promise<void> {
    await this.connector(kind).testConnection(
      await this.withSecrets(kind, config, id),
    );
  }

  async save(input: {
    id?: string;
    name: string;
    kind: DatasourceKind;
    config: DatasourceConfig;
  }): Promise<DatasourceView> {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    this.connector(input.kind);
    const config = await this.withSecrets(input.kind, input.config, input.id);
    const saved = await this.repository.save({
      id: input.id,
      name: name.slice(0, 64),
      kind: input.kind,
      config,
    });
    return this.view(saved);
  }

  async delete(id: string): Promise<Datasource> {
    const existing = await this.get(id);
    await this.repository.delete(id);
    await this.inventoryCache.delete(id);
    return existing;
  }

  /**
   * Cached by default — a live walk takes minutes on a cold warehouse. Pass
   * `refresh` to re-read the datasource and replace the snapshot.
   */
  async inventory(
    id: string,
    refresh = false,
  ): Promise<{ catalogs: CatalogInfo[]; fetchedAt: string; cached: boolean }> {
    const ds = await this.get(id);
    if (!refresh) {
      const cached = await this.inventoryCache.get(id);
      if (cached) {
        return {
          catalogs: cached.catalogs,
          fetchedAt: cached.fetchedAt,
          cached: true,
        };
      }
    }
    const catalogs = await this.connector(ds.kind).inventory(ds.config);
    const fetchedAt = new Date().toISOString();
    await this.inventoryCache.save(id, catalogs, fetchedAt);
    return { catalogs, fetchedAt, cached: false };
  }

  /**
   * Declared foreign keys among the given entities, or `[]` when the platform
   * cannot report them (most lakehouse tables declare none). Never throws: a
   * missing join hint must degrade to no hint, never fail the caller.
   */
  async foreignKeys(id: string, entities: string[]): Promise<ForeignKeyEdge[]> {
    const ds = await this.get(id);
    const connector = this.connector(ds.kind);
    if (!connector.foreignKeys) return [];
    try {
      return await connector.foreignKeys(ds.config, entities);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Foreign keys unavailable for ${id}: ${message}`);
      return [];
    }
  }

  /**
   * The stored snapshot only — never touches the datasource. Null when nothing
   * is cached, so callers can offer a load instead of blocking on a cold
   * warehouse.
   */
  async cachedInventory(id: string): Promise<{
    catalogs: CatalogInfo[];
    fetchedAt: string;
    cached: true;
  } | null> {
    await this.get(id);
    const cached = await this.inventoryCache.get(id);
    if (!cached) return null;
    return {
      catalogs: cached.catalogs,
      fetchedAt: cached.fetchedAt,
      cached: true,
    };
  }

  async sampleRows(
    id: string,
    entity: string,
    limit: number,
  ): Promise<QueryResult> {
    const ds = await this.get(id);
    return this.connector(ds.kind).sampleRows(ds.config, entity, limit);
  }

  /**
   * Sample many entities in one call. Kinds with a batch implementation reuse
   * a single connection; the rest fall back to per-entity sampling at the
   * same concurrency. Per-entity failures come back as `Error` values so a
   * refused table never fails the batch.
   */
  async sampleRowsMany(
    id: string,
    entities: string[],
    limit: number,
    concurrency: number,
  ): Promise<Map<string, QueryResult | Error>> {
    const ds = await this.get(id);
    const connector = this.connector(ds.kind);
    if (connector.sampleRowsMany) {
      return connector.sampleRowsMany(ds.config, entities, limit, concurrency);
    }
    const results = new Map<string, QueryResult | Error>();
    await mapWithConcurrency(entities, concurrency, async (entity) => {
      try {
        results.set(
          entity,
          await connector.sampleRows(ds.config, entity, limit),
        );
      } catch (err) {
        results.set(
          entity,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });
    return results;
  }

  async runReadOnlySql(
    id: string,
    sql: string,
    rowLimit: number,
  ): Promise<QueryResult> {
    const ds = await this.get(id);
    return this.connector(ds.kind).runReadOnlySql(ds.config, sql, rowLimit);
  }

  view(ds: Datasource): DatasourceView {
    const connector = this.connector(ds.kind);
    return {
      id: ds.id,
      name: ds.name,
      kind: ds.kind,
      summary: connector.summary(ds.config),
      config: connector.mask(ds.config),
      createdAt: ds.createdAt,
      updatedAt: ds.updatedAt,
    };
  }

  /**
   * The UI sends masked secrets back when the user did not retype them —
   * restore them from the saved datasource so test/save keep working.
   */
  private async withSecrets(
    kind: DatasourceKind,
    config: DatasourceConfig,
    id?: string,
  ): Promise<DatasourceConfig> {
    if (!id) return config;
    const saved = await this.repository.get(id);
    if (!saved || saved.kind !== kind) return config;
    if (kind === 'databricks') {
      const incoming = config as DatabricksConfig;
      const stored = saved.config as DatabricksConfig;
      return {
        ...incoming,
        token:
          !incoming.token || incoming.token === MASKED
            ? stored.token
            : incoming.token,
      };
    }
    if (kind === 'rest') {
      const incoming = config as RestApiConfig;
      const stored = saved.config as RestApiConfig;
      const auth = { ...incoming.auth };
      if (!auth.token || auth.token === MASKED) {
        if (stored.auth?.token) auth.token = stored.auth.token;
      }
      if (!auth.password || auth.password === MASKED) {
        if (stored.auth?.password) auth.password = stored.auth.password;
      }
      return { ...incoming, auth };
    }
    const incoming = config as PostgresConfig;
    const stored = saved.config as PostgresConfig;
    return {
      ...incoming,
      password:
        !incoming.password || incoming.password === MASKED
          ? stored.password
          : incoming.password,
    };
  }
}
