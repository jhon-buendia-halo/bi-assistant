/**
 * A question → SQL pair the user approved with a thumbs-up. Retrieved by
 * lexical similarity and injected into the analysis prompt so a repeated (or
 * nearby) question reuses tables, joins and filters that already worked.
 */
export interface VerifiedQueryDoc {
  id: string;
  /** The user question that produced the approved answer. */
  question: string;
  /** Last successful `run_readonly_sql` statement of that answer. */
  sql: string;
  datasourceId?: string;
  /** Fully-qualified entities the answer drew on (message provenance). */
  entities: string[];
  /**
   * Session + assistant-message `at` the pair came from; dedupe key. Absent
   * on a pair that came from a workflow run's answer (`sourceRunId`).
   */
  sourceSessionId?: string;
  /** The workflow run whose answer the pair came from; dedupe key. */
  sourceRunId?: string;
  /** `at` of the source assistant message. */
  sourceMessageAt: string;
  /** The owning user's id in org server mode (data-model 3.15). */
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}
