/**
 * The marker that tells an eval run's traffic apart in the trace store
 * (ADR-0054). Every eval case sets `EVAL_RUN_CONTEXT_KEY` to the run's job id
 * in its request context; the Observability config lists the key in
 * `requestContextKeys`, so Mastra copies it into the `metadata` of every span
 * created with that request context. Monitoring classifies a model call as an
 * eval call when any span of its trace carries it.
 *
 * Framework-free on purpose: Monitoring imports it without pulling in Mastra.
 */
export const EVAL_RUN_CONTEXT_KEY = 'eval-run-id';

/** The JSON path of the marker in `span_events.metadata` (DuckDB `json_extract_string`). */
export const EVAL_RUN_METADATA_PATH = '$."eval-run-id"';
