/**
 * Curated metric definitions — the app's lightweight semantic layer. Mirrors
 * `backend/src/modules/metrics/entities/metric.entity.ts`.
 */
export interface Metric {
  id: string;
  /** Slug-like handle used in prompts: `denial_rate`. */
  name: string;
  label: string;
  description?: string;
  /** Fully-qualified `catalog.schema.table` the expression computes over. */
  entity: string;
  datasourceId?: string;
  /** SQL aggregation expression the assistant must reuse verbatim. */
  expression: string;
  dimensions?: string[];
  sourceVerifiedQueryId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Create/update payload. */
export interface MetricInput {
  name: string;
  label: string;
  description?: string;
  entity: string;
  datasourceId?: string;
  expression: string;
  dimensions?: string[];
  sourceVerifiedQueryId?: string;
}

/** A verified query offered as a prefilled draft (promotion path). */
export interface MetricCandidate {
  verifiedQueryId: string;
  name: string;
  label: string;
  entity: string;
  datasourceId?: string;
  /** The approved SQL — the user lifts the aggregation out of it. */
  sql: string;
}

export interface MetricActionResult {
  ok: boolean;
  message: string;
  metric?: Metric;
}
