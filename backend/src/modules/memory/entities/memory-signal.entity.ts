/**
 * A verified user signal on its way into the learning memory (ADR-0013).
 *
 * Only what a person did produces one — an approval, a rejection, a
 * reviewer's note, a cross-check that disagreed on a chat turn, a curated
 * Knowledge edit — never an eval run. `content` carries the question,
 * redacted SQL, the note and schema names: never row values.
 */
export type MemorySignalKind =
  'verified_query' | 'correction' | 'cross_check_differs' | 'knowledge';

export interface MemorySignal {
  /** uuid; also the retain operation id when the signal is sent alone. */
  id: string;
  kind: MemorySignalKind;
  datasourceId: string;
  /** Dataset names the signal applies to; empty for datasource-wide. */
  datasetIds: string[];
  /**
   * Upsert key in the memory bank: retaining the same document again
   * replaces it, and `forget` deletes it (`vq:…`, `corr:…`, `xc:…`,
   * `knowledge:…`).
   */
  documentId: string;
  content: string;
  /** Who is speaking — the memory uses it to tell world facts from experience. */
  context: string;
  /** ISO; the rated answer's `messageAt` (or the edit time for Knowledge). */
  occurredAt: string;
  /** Fully-qualified `catalog.schema.table` names. */
  entities: string[];
}

/**
 * One row of the `memory_signals` outbox. Written `pending` by `enqueue`,
 * `sent` once the memory accepted it, `failed` after the last retry. Rows
 * are kept after sending: they are the audit of what was retained.
 */
export interface MemorySignalDoc extends MemorySignal {
  status: 'pending' | 'sent' | 'failed';
  /** Failed send attempts so far. */
  attempts: number;
  lastError?: string;
  /** Earliest retry (ISO), set after a failed attempt. */
  nextAttemptAt?: string;
  createdAt: string;
  sentAt?: string;
  updatedAt?: string;
}
