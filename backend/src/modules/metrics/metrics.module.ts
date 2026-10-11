import { Module } from '@nestjs/common';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { DataModelsModule } from '../data-models/data-models.module';
import {
  MetricsController,
  ModelMetricCandidatesController,
} from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsRepository } from './repositories/metrics.repository';

/**
 * `MetricsRepository` (the `metrics` collection) was this feature's editor
 * of record under ADR-0006; roadmap 1.2.3 moves the panel onto the data
 * model directly (`DataModelsController`'s `/datasets/:name/model/metrics*`
 * routes are the panel's API now). This module and `MetricsRepository` stay
 * for backward compatibility — the legacy `/metrics*` endpoints keep
 * working, and every write still mirrors into the data model via
 * `DataModelsModule`'s `syncMetric`/`removeMetric` (now the model wins for
 * any name it manages itself — see that service's header). The promotion
 * path for the new panel (`candidatesForDataset`,
 * `ModelMetricCandidatesController`) still reuses this module's
 * verified-queries-backed `candidates()`.
 */
@Module({
  imports: [VerifiedQueriesModule, DataModelsModule],
  controllers: [MetricsController, ModelMetricCandidatesController],
  providers: [MetricsService, MetricsRepository],
  exports: [MetricsService],
})
export class MetricsModule {}
