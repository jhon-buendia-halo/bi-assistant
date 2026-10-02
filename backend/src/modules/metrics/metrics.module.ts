import { Module } from '@nestjs/common';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { DataModelsModule } from '../data-models/data-models.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsRepository } from './repositories/metrics.repository';

/**
 * `MetricsRepository` (the `metrics` collection) is still this feature's
 * editor of record (ADR-0006, until roadmap 1.2.3 moves the panel onto the
 * data model) — `MetricsService` reads/writes it directly, then mirrors
 * every write into the data model via `DataModelsModule`'s `syncMetric`/
 * `removeMetric` so the model (what the assistant and bootstrap both read)
 * stays current.
 */
@Module({
  imports: [VerifiedQueriesModule, DataModelsModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsRepository],
  exports: [MetricsService],
})
export class MetricsModule {}
