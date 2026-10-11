import type { Aggregation, Predicate } from '../entities/data-model.entity';

/**
 * Create/update payload for a model-scoped metric (roadmap 1.2.3's metrics
 * panel, `POST`/`PUT /datasets/:name/model/metrics[/:metricName]`). Shaped
 * like `Metric` itself rather than the legacy `SaveMetricDto`'s flat
 * `expression` string — this metric is validated and stored straight on the
 * `DataModel`, so it carries the model's own portable aggregation core
 * (`agg`/`of`/`numerator`/`denominator`/`where`) alongside the
 * dialect-tagged `expressions.sql` escape hatch, exactly as `Metric` does.
 */
export class SaveModelMetricDto {
  name: string;
  label: string;
  description?: string;
  entity: string;
  agg?: Aggregation;
  of?: string;
  numerator?: string;
  denominator?: string;
  where?: Predicate;
  dimensions?: string[];
  expressions?: { sql?: string };
  sourceVerifiedQueryId?: string;
}
