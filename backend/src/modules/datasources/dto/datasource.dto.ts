import type {
  DatasourceConfig,
  DatasourceKind,
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
