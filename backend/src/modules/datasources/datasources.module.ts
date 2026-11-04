import { Module } from '@nestjs/common';
import { DatasourcesController } from './datasources.controller';
import { DatasourcesService } from './datasources.service';
import { DatasourcesRepository } from './repositories/datasources.repository';
import { InventoryCacheRepository } from './repositories/inventory-cache.repository';
import { DatabricksConnector } from './connectors/databricks.connector';
import { PostgresConnector } from './connectors/postgres.connector';
import { RestConnector } from './connectors/rest.connector';
import { PostgresProfiler } from './connectors/postgres-profiling';
import { DatabricksProfiler } from './connectors/databricks-profiling';

@Module({
  controllers: [DatasourcesController],
  providers: [
    DatasourcesService,
    DatasourcesRepository,
    InventoryCacheRepository,
    DatabricksConnector,
    PostgresConnector,
    RestConnector,
    PostgresProfiler,
    DatabricksProfiler,
  ],
  exports: [DatasourcesService, PostgresProfiler, DatabricksProfiler],
})
export class DatasourcesModule {}
