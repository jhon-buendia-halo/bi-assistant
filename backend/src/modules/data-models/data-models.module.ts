import { Module } from '@nestjs/common';
import { DataModelsController } from './data-models.controller';
import { DataModelsService } from './data-models.service';
import { DataModelsRepository } from './repositories/data-models.repository';

/**
 * The data model DSL's service layer (roadmap 1.2.1 / BA-85, ADR-0006).
 * Imported by `AppModule` directly, and by `DatasetsModule` (bootstrap on
 * save, drift on re-save, delete on delete) and `MetricsModule` (metrics
 * storage moves through models) — never the other way around, which is what
 * keeps this module free of a circular dependency on either.
 */
@Module({
  controllers: [DataModelsController],
  providers: [DataModelsService, DataModelsRepository],
  exports: [DataModelsService],
})
export class DataModelsModule {}
