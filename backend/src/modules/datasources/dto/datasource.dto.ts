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

/**
 * Preview one sheet (api.md 157). One of `uploadId` (an unsaved upload) or
 * `datasourceId` with `fileId` (a saved file) names the file; omitted
 * options come from the detection.
 */
export class PreviewFileDto {
  uploadId?: string;
  datasourceId?: string;
  fileId?: string;
  sheet: string;
  headerRow?: number;
  range?: string;
  excludeLastRow?: boolean;
  allText?: boolean;
}
