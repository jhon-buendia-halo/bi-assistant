import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabricksConnector } from './connectors/databricks.connector';
import { PostgresConnector } from './connectors/postgres.connector';
import type { DatasourceConnector } from './connectors/connector';
import { MASKED } from './connectors/connector';
import { DatasourcesRepository } from './repositories/datasources.repository';
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
} from './entities/datasource.entity';

/** Kind-agnostic entry point: resolves a datasource and dispatches to its connector. */
@Injectable()
export class DatasourcesService {
  constructor(
    private readonly repository: DatasourcesRepository,
    private readonly databricks: DatabricksConnector,
    private readonly postgres: PostgresConnector,
  ) {}

  connector(kind: DatasourceKind): DatasourceConnector {
    if (!DATASOURCE_KINDS.includes(kind)) {
      throw new BadRequestException(
        `kind must be one of: ${DATASOURCE_KINDS.join(', ')}`,
      );
    }
    return kind === 'postgres' ? this.postgres : this.databricks;
  }

  async list(): Promise<DatasourceView[]> {
    return (await this.repository.list()).map((d) => this.view(d));
  }

  async get(id: string): Promise<Datasource> {
    const found = await this.repository.get(id);
    if (!found) throw new NotFoundException(`Datasource ${id} not found`);
    return found;
  }

  /** Preferred datasource — used to bind sandboxes created before datasources existed. */
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
    return existing;
  }

  async inventory(id: string): Promise<CatalogInfo[]> {
    const ds = await this.get(id);
    return this.connector(ds.kind).inventory(ds.config);
  }

  async sampleRows(
    id: string,
    entity: string,
    limit: number,
  ): Promise<QueryResult> {
    const ds = await this.get(id);
    return this.connector(ds.kind).sampleRows(ds.config, entity, limit);
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
