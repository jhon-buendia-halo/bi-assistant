/**
 * BA-324 / ADR-0033: what an assessment reports while it runs. Emitted by
 * `buildSourceProfile` and `DataReadinessService.assess`, streamed to the chat
 * as `tool-progress` events; never shown to the model, never persisted.
 */
export interface ReadinessProgress {
  phase: 'inventory' | 'profiling' | 'relationships' | 'scoring' | 'storing';
  /** Human line, e.g. "Profiling samples.tpch.lineitem (12/124)…". */
  message: string;
  /** Entities (or relationships) finished so far in this phase. */
  done?: number;
  total?: number;
  /** The entity just finished, `namespace.name`. */
  entity?: string;
}

export type ReadinessProgressListener = (progress: ReadinessProgress) => void;

/** BA-323: tables above this row count are not column-profiled. */
export const MAX_PROFILED_ROWS = 100_000_000;

/** BA-323: tables profiled at once, per dialect. */
export const PROFILE_CONCURRENCY_BY_DIALECT = {
  databricks: 8,
  postgres: 4,
} as const;
