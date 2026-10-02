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
  /** The `query_entities` logical query behind `sql` (JSON), present only
   * when the answering turn used the logical query layer (ADR-0007) — a
   * `run_readonly_sql`/`run_raw_sql` pair has none. Gates whether this pair
   * is shown to the assistant at all: a SQL-only pair would otherwise
   * re-introduce the physical vocabulary the model is never shown
   * (`VerifiedQueriesService.referenceBlock`). */
  logicalQuery?: string;
  datasourceId?: string;
  /** Fully-qualified entities the answer drew on (message provenance). */
  entities: string[];
  /** Session + assistant-message `at` the pair came from; dedupe key. */
  sourceSessionId: string;
  sourceMessageAt: string;
  createdAt?: string;
  updatedAt?: string;
}
