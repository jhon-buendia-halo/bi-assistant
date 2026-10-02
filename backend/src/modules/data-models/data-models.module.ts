import { Module } from '@nestjs/common';
import { DatasourcesModule } from '../datasources/datasources.module';
import { DataModelsController } from './data-models.controller';
import { DataModelsService } from './data-models.service';
import { DataModelsRepository } from './repositories/data-models.repository';

/**
 * The data model DSL's service layer (roadmap 1.2.1 / BA-85, ADR-0006) and
 * the logical query layer built on it (roadmap 1.2.2 / BA-86, ADR-0007).
 * Imported by `AppModule` directly, and by `DatasetsModule` (bootstrap on
 * save, drift on re-save, delete on delete) and `MetricsModule` (metrics
 * storage moves through models) — never the other way around, which is what
 * keeps this module free of a circular dependency on either. `DatasourcesModule`
 * is a one-way dependency too (it never imports this module): the
 * `/model/query` endpoint runs a compiled statement through
 * `DatasourcesService.runReadOnlySql`, and resolving a `sql` binding's
 * dialect for `/model/compile` reads the datasource's own kind.
 *
 * Deliberately does NOT import `MastraModule`, even though `/model/query`
 * does run its failed statements through `sql-fixer`: `MastraModule`
 * provides `MastraService`, which eagerly loads `mastra/index.ts` — the
 * full real agent registry, unsafe to construct under this project's Jest
 * CommonJS config (`@mastra/core/agent`'s ESM-only transitive deps) and
 * exactly what `data-models.e2e-spec.ts`'s focused, Mastra-free module set
 * exists to avoid. The repair pass instead goes through
 * `query/sql-repair.ts`'s `SqlFixerBridge` — a runtime bridge
 * `SessionsService.onModuleInit` installs, mirroring `tool-services.ts`'s
 * `setDatasetToolServices` — so this module stays free of a Mastra import.
 */
@Module({
  imports: [DatasourcesModule],
  controllers: [DataModelsController],
  providers: [DataModelsService, DataModelsRepository],
  exports: [DataModelsService],
})
export class DataModelsModule {}
