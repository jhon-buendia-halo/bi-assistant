import type { LearningSignalKind } from '../learning-store.port';

/**
 * One row of the `memory_signals` outbox (data-model 3.15): a signal on its
 * way into the cross-session memory, kept once stored as the audit of what
 * the memory was given, until the signal is forgotten.
 */
export interface MemorySignalDoc {
  /** uuid. */
  id: string;
  /**
   * `rating:<sessionId>:<messageAt>` or `correction:<sessionId>:<messageAt>`;
   * one row per document id, replaced by a later signal of the same answer.
   */
  documentId: string;
  kind: LearningSignalKind;
  /** The session's one datasource; it names the learning memory. */
  datasourceId: string;
  /** The session's dataset names. */
  datasetIds: string[];
  /** The text of knowledge R33, redacted and clipped (R32). */
  content: string;
  /** The rated answer's `at`. */
  occurredAt: string;
  /** The answer's `entities`, for provenance. */
  entities: string[];
  /** `pending` (waiting or retrying), `stored`, or `failed` (given up). */
  status: 'pending' | 'stored' | 'failed';
  /** Failed store attempts so far. */
  attempts: number;
  /** The last error, clipped to 500 characters. */
  lastError?: string;
  /** Earliest next attempt (ISO), set after a failure. */
  nextAttemptAt?: string;
  /** Set when the memory accepted the signal. */
  storedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** The signal fields a rating writes; the outbox owns the bookkeeping. */
export type MemorySignalInput = Pick<
  MemorySignalDoc,
  | 'documentId'
  | 'kind'
  | 'datasourceId'
  | 'datasetIds'
  | 'content'
  | 'occurredAt'
  | 'entities'
>;
