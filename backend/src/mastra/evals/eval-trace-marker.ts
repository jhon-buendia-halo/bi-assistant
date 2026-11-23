/**
 * The marker that tells an eval run's traffic apart in the trace store
 * (ADR-0054). Every eval case runs in its run's scope (`eval-run-scope.ts`),
 * whose span processor writes `EVAL_RUN_CONTEXT_KEY` = the run's job id into
 * the `metadata` of every span started in it; the case's request context
 * carries the key too, listed in `requestContextKeys`. Monitoring classifies
 * a model call as an eval call when any span of its trace carries it.
 *
 * Framework-free on purpose: Monitoring imports it without pulling in Mastra.
 */
export const EVAL_RUN_CONTEXT_KEY = 'eval-run-id';

/** The JSON path of the marker in `span_events.metadata` (DuckDB `json_extract_string`). */
export const EVAL_RUN_METADATA_PATH = '$."eval-run-id"';
