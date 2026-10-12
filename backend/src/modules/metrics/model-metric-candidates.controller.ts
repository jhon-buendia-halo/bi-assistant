import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/auth-requirement.decorators';
import { MetricsService } from './metrics.service';
import type { MetricCandidate } from './entities/metric.entity';

/**
 * roadmap 1.2.3 — the Metrics tab's promotion path,
 * `GET /datasets/:name/model/metrics/candidates` (api.md 2.16, endpoint
 * 112), scoped to one dataset's model and addressed by logical entity
 * names. An unprefixed controller of its own, not a method on
 * `MetricsController` (whose `metrics` prefix every route there
 * shares) nor on `DataModelsController` (which would need
 * `MetricsService` injected back into `DataModelsModule`: a circular import,
 * since `MetricsModule` already depends on `DataModelsModule`). It lives in
 * its own file so `scripts/check-specs.py`, which reads one controller
 * prefix per file, sees the route's real path.
 *
 * Reading candidates changes nothing, so it needs Use agents (data-model
 * R38, api.md 1.9).
 */
@Controller()
@RequirePermission('use-agents')
export class ModelMetricCandidatesController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('datasets/:name/model/metrics/candidates')
  async candidatesForModel(
    @Param('name') name: string,
  ): Promise<{ candidates: MetricCandidate[] }> {
    return { candidates: await this.metrics.candidatesForDataset(name) };
  }
}
