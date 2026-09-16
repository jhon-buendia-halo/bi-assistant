/**
 * A curated, app-managed metric definition — the lightweight semantic layer.
 * Genie-style: the business meaning of a number lives here once, and every
 * answer that needs it reuses the exact same SQL expression instead of the
 * model re-deriving it (and drifting) per turn.
 *
 * Deliberately independent of Unity Catalog Metric Views: the app owns these
 * so a demo workspace needs no governed-metrics feature enabled. Reading real
 * Metric Views is a future integration, not a prerequisite.
 */
export interface MetricDoc {
  id: string;
  /** Slug-like handle used in prompts and follow-up questions: `denial_rate`. */
  name: string;
  /** Human label shown in the UI: `Denial rate`. */
  label: string;
  /** Business meaning — what the number means, caveats, units. */
  description?: string;
  /** Fully-qualified `catalog.schema.table` the expression computes over. */
  entity: string;
  datasourceId?: string;
  /** SQL aggregation expression, e.g. `SUM(...) / NULLIF(COUNT(*), 0)`. */
  expression: string;
  /** Columns the metric is meaningfully grouped by. */
  dimensions?: string[];
  /** Verified query this metric was promoted from (provenance). */
  sourceVerifiedQueryId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Write payload — `id` and timestamps are owned by the service. */
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

/**
 * A prefilled draft derived from a verified query — the promotion path. The
 * expression is left to the user: a whole verified statement is not an
 * aggregation expression, so it ships as a reference instead of a guess.
 */
export interface MetricCandidate {
  verifiedQueryId: string;
  /** Suggested slug derived from the approved question. */
  name: string;
  /** Suggested label — the approved question itself. */
  label: string;
  entity: string;
  datasourceId?: string;
  /** The approved SQL, shown so the user can lift the aggregation out of it. */
  sql: string;
}
