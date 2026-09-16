import { Module } from '@nestjs/common';
import { DatasourcesController } from './datasources.controller';
import { DatasourcesService } from './datasources.service';
import { DatasourcesRepository } from './repositories/datasources.repository';
import { InventoryCacheRepository } from './repositories/inventory-cache.repository';
import { DatabricksConnector } from './connectors/databricks.connector';
import { PostgresConnector } from './connectors/postgres.connector';

@Module({
  controllers: [DatasourcesController],
  providers: [
    DatasourcesService,
    DatasourcesRepository,
    InventoryCacheRepository,
    DatabricksConnector,
    PostgresConnector,
  ],
  exports: [DatasourcesService],
})
export class DatasourcesModule {}
