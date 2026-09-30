import type {
  DatasourceConfig,
  DatasourceKind,
  RestApiConfig,
} from '../entities/datasource.entity';

export class TestDatasourceDto {
  kind: DatasourceKind;
  config: DatasourceConfig;
  /** When re-testing a saved datasource without re-entering secrets. */
  id?: string;
}

export class SaveDatasourceDto extends TestDatasourceDto {
  name: string;
}

export class DiscoverRestEndpointsDto {
  config: RestApiConfig;
  /** Absolute, or relative to `config.baseUrl`; empty = try the usual spec locations. */
  specUrl?: string;
  /** Restores masked secrets from the saved datasource. */
  id?: string;
}
