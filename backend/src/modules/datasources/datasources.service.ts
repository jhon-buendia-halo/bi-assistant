import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { basename } from 'path';
import type { Readable } from 'stream';
import { DatabricksConnector } from './connectors/databricks.connector';
import { normalizeDatabricksHost } from './connectors/databricks-host';
import { PostgresConnector } from './connectors/postgres.connector';
import { RestConnector } from './connectors/rest.connector';
import {
  FileConnector,
  type FileConnectorConfig,
} from './connectors/file.connector';
import { fileDatabasePath } from './connectors/duckdb';
import { excelExtension } from './connectors/excel-extension';
import { previewSheet } from './connectors/file-preview';
import {
  checkImport,
  originalPath,
  removeDatasourceFiles,
  removeUpload,
  saveImport,
  sweepStaleUploads,
  uploadedFilePath,
  uploadFile,
} from './connectors/file-storage';
import type {
  DatasourceConnector,
  ForeignKeyEdge,
  RunSqlOptions,
} from './connectors/connector';
import { mapWithConcurrency, MASKED } from './connectors/connector';
import type { PagedRows, PagedStatement } from './connectors/paged-sql.types';
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
  RestDiscovery,
  type FileDatasourceConfig,
  type SheetPreview,
  type SourceFile,
} from './entities/datasource.entity';
import type { PreviewFileDto } from './dto/datasource.dto';

/** A `file` config as stored, never with the connector's runtime path. */
function withoutDatabasePath(config: DatasourceConfig): FileDatasourceConfig {
  const stored = { ...(config as Partial<FileConnectorConfig>) };
  delete stored.databasePath;
  return { ...stored, files: stored.files ?? [] };
}

/** Kind-agnostic entry point: resolves a datasource and dispatches to its connector. */
@Injectable()
export class DatasourcesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatasourcesService.name);

  constructor(
    private readonly repository: DatasourcesRepository,
    private readonly inventoryCache: InventoryCacheRepository,
    private readonly databricks: DatabricksConnector,
    private readonly postgres: PostgresConnector,
    private readonly rest: RestConnector,
    private readonly file: FileConnector,
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
      case 'file':
        return this.file;
      case 'databricks':
        return this.databricks;
      default:
        throw new BadRequestException(
          `Unknown datasource kind "${String(kind)}"`,
        );
    }
  }

  /**
   * The config a connector receives. A `file` config gets the path of the
   * datasource's `data.duckdb` (`<dataDir>/files/<id>/data.duckdb`); a path
   * the client sent is dropped, and without an id there is none. Never
   * stored: `save` strips it.
   */
  private runtimeConfig(
    kind: DatasourceKind,
    config: DatasourceConfig,
    id?: string,
  ): DatasourceConfig {
    if (kind !== 'file') return config;
    const stored = withoutDatabasePath(config);
    const runtime: FileConnectorConfig = {
      ...stored,
      databasePath: id ? fileDatabasePath(id) : '',
    };
    return runtime;
  }

  /** The saved datasource with the config its connector receives. */
  private async forConnector(id: string): Promise<Datasource> {
    const ds = await this.get(id);
    return { ...ds, config: this.runtimeConfig(ds.kind, ds.config, ds.id) };
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

  /** Uploads left unsaved for more than 24 hours go at backend start. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const removed = await sweepStaleUploads();
      if (removed) this.logger.log(`Removed ${removed} stale file upload(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Stale file uploads not swept: ${message}`);
    }
  }

  /**
   * Test (16). A `file` config is imported into a throwaway database and
   * answers its own message (`Imported <n> tables · <rows> rows`); the
   * other kinds answer nothing and the caller says `Connection successful`.
   */
  async testConnection(
    kind: DatasourceKind,
    config: DatasourceConfig,
    id?: string,
  ): Promise<string | undefined> {
    if (kind === 'file') {
      return checkImport(
        withoutDatabasePath(config).files,
        id,
        await this.savedFiles(id),
      );
    }
    await this.connector(kind).testConnection(
      this.runtimeConfig(kind, await this.withSecrets(kind, config, id), id),
    );
    return undefined;
  }

  /** The files of a saved `file` datasource, else none. */
  private async savedFiles(id?: string): Promise<SourceFile[]> {
    if (!id) return [];
    const saved = await this.repository.get(id);
    return saved?.kind === 'file'
      ? ((saved.config as FileDatasourceConfig).files ?? [])
      : [];
  }

  /** Upload one file (api.md 156). */
  uploadFile(
    body: Readable,
    fileName: string | string[] | undefined,
    declaredBytes: number | undefined,
    maxBytes: number,
  ): Promise<{ uploadId: string; file: SourceFile }> {
    return uploadFile(body, fileName, declaredBytes, maxBytes);
  }

  /** Drop an unsaved upload (api.md 158). */
  deleteUpload(uploadId: string): Promise<void> {
    return removeUpload(uploadId);
  }

  /**
   * Preview one sheet (api.md 157) of an upload, or of a saved datasource's
   * file. A bad option answers 400 with the importer's message.
   */
  async previewFile(dto: PreviewFileDto): Promise<SheetPreview> {
    if (!dto?.sheet || typeof dto.sheet !== 'string') {
      throw new BadRequestException('sheet is required');
    }
    let path: string;
    let name: string;
    if (dto.uploadId) {
      path = await uploadedFilePath(dto.uploadId);
      name = basename(path);
    } else if (dto.datasourceId) {
      const file = (await this.savedFiles(dto.datasourceId)).find(
        (f) => f.id === dto.fileId,
      );
      path = file ? originalPath(dto.datasourceId, file) : '';
      if (!file || !existsSync(path)) {
        throw new NotFoundException(`File ${dto.fileId} not found`);
      }
      name = file.name;
    } else {
      throw new BadRequestException('uploadId or datasourceId is required');
    }
    const number = (v: unknown) =>
      v === undefined || v === null || v === '' ? undefined : Number(v);
    const flag = (v: unknown) =>
      v === undefined || v === null ? undefined : v === true;
    try {
      return await previewSheet(
        path,
        name,
        {
          sheet: dto.sheet,
          headerRow: number(dto.headerRow),
          range: dto.range || undefined,
          excludeLastRow: flag(dto.excludeLastRow),
          allText: flag(dto.allText),
        },
        { excelExtension: excelExtension() },
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async discoverRestEndpoints(
    config: RestApiConfig,
    specUrl?: string,
    id?: string,
  ): Promise<RestDiscovery> {
    const withSecrets = (await this.withSecrets(
      'rest',
      config,
      id,
    )) as RestApiConfig;
    return this.rest.discover(withSecrets, specUrl);
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
    const withSecrets = await this.withSecrets(
      input.kind,
      input.config,
      input.id,
    );
    // Store the bare hostname so every reader of the saved config — not only
    // the connector, which re-normalises — gets a usable host (BA-322).
    const config =
      input.kind === 'databricks'
        ? {
            ...(withSecrets as DatabricksConfig),
            host: normalizeDatabricksHost(
              (withSecrets as DatabricksConfig).host,
            ),
          }
        : input.kind === 'file'
          ? withoutDatabasePath(withSecrets)
          : withSecrets;
    if (input.kind === 'file') {
      return this.saveFiles({ ...input, name }, config as FileDatasourceConfig);
    }
    const saved = await this.repository.save({
      id: input.id,
      name: name.slice(0, 64),
      kind: input.kind,
      config,
    });
    return this.view(saved);
  }

  /**
   * Save (18) of a `file` datasource: the import comes first, into its own
   * `data.duckdb`, so a failure stores nothing and keeps the previous
   * database; then the uploads move to `originals/`, the document is
   * written without `uploadId`, and the inventory snapshot is refreshed.
   */
  private async saveFiles(
    input: { id?: string; name: string },
    config: FileDatasourceConfig,
  ): Promise<DatasourceView> {
    const id = input.id ?? randomUUID();
    const files = await saveImport(
      id,
      config.files,
      await this.savedFiles(input.id),
    );
    const saved = await this.repository.save({
      id,
      name: input.name.slice(0, 64),
      kind: 'file',
      config: { ...config, files },
    });
    try {
      await this.inventory(id, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Inventory of ${id} not refreshed: ${message}`);
    }
    return this.view(saved);
  }

  async delete(id: string): Promise<Datasource> {
    const existing = await this.get(id);
    await this.repository.delete(id);
    await this.inventoryCache.delete(id);
    if (existing.kind === 'file') await removeDatasourceFiles(id);
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
    const ds = await this.forConnector(id);
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
    const ds = await this.forConnector(id);
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
    const ds = await this.forConnector(id);
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
    const ds = await this.forConnector(id);
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
    /** The clamp on `rowLimit` (default 500); a CSV export passes 50,001. */
    maxRows?: number,
    /** The caller's stop signal: cancels the running statement (R38). */
    options?: RunSqlOptions,
  ): Promise<QueryResult> {
    const ds = await this.forConnector(id);
    const connector = this.connector(ds.kind);
    if (options) {
      return connector.runReadOnlySql(
        ds.config,
        sql,
        rowLimit,
        maxRows,
        options,
      );
    }
    return maxRows === undefined
      ? connector.runReadOnlySql(ds.config, sql, rowLimit)
      : connector.runReadOnlySql(ds.config, sql, rowLimit, maxRows);
  }

  /** One page of a stored statement's result (datasources R52, ADR-0050). */
  async runPagedSql(id: string, stmt: PagedStatement): Promise<PagedRows> {
    const ds = await this.forConnector(id);
    return this.connector(ds.kind).runPagedSql(ds.config, stmt);
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
    // No secret to restore; never read a file config as Postgres's.
    if (kind === 'file') return config;
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
    if (kind === 'postgres') {
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
    throw new BadRequestException(`Unknown datasource kind "${String(kind)}"`);
  }
}
