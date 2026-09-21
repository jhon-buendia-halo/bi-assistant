// Result-set comparison scoring for eval cases that carry `expectedSql`.
//
// Deliberately isolated from `assistant.agent.ts`/`@mastra/core/agent`: this
// module is imported by `assistant.evals.ts` (which does pull those in), but
// nothing here does, so a spec file can exercise this logic directly without
// the ESM-only transitive deps that break under CommonJS Jest (same reason
// `agent-constants.ts` and `context-blocks.ts` stay dependency-free). The one
// type it borrows from `assistant.evals.ts` (`EvalCheckResult`) is imported
// with `import type`, which TypeScript erases entirely, so it adds no runtime
// edge back to that heavier module.
import { compareResults } from '../../modules/sessions/result-compare';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot } from '../tool-services';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { EvalCheckResult } from './assistant.evals';

/** Scorer id for the result-set check, shown in the report's checks table. */
export const RESULT_SET_CHECK_ID = 'result-set-match';

/**
 * Connectors clamp `runReadOnlySql` at 500 rows (mirrors the golden-set
 * harness, `scripts/run-eval.ts`) — comparing more than that is moot.
 */
export const RESULT_SET_ROW_LIMIT = 500;

/**
 * The last `run_readonly_sql` call that did not error — the SQL the agent
 * actually leaned on for its answer. Mirrors `lastSuccessfulSql` in
 * `scripts/run-eval.ts`, applied to the live `turnRecords` an eval run
 * captures via `onStepFinish` instead of a persisted session transcript.
 */
export function lastSuccessfulSqlRecord(
  records: ToolDataRecord[],
): ToolDataRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.tool === 'run_readonly_sql' && !record.error && record.input) {
      return record;
    }
  }
  return undefined;
}

/**
 * Score one eval case's result set against its `expectedSql`, when it has
 * one. Runs `expectedSql` through the same `DatasetToolServices` bridge
 * `run_readonly_sql` itself uses, then compares against the agent's own
 * captured rows with `compareResults`'s width-tolerant semantics — the same
 * forgiveness golden-set/careful-mode give a narrower-but-consistent
 * projection, since the agent's answer routinely selects fewer columns than
 * a reference query written to project exactly what the question asked.
 *
 * Returns `undefined` when the case has no `expectedSql` — callers should
 * skip adding a check in that case rather than reporting a vacuous pass.
 */
export async function runResultSetCheck(
  expectedSql: string | undefined,
  datasets: string[],
  datasetSnapshots: DatasetSnapshot[],
  turnRecords: ToolDataRecord[],
): Promise<EvalCheckResult | undefined> {
  if (!expectedSql) return undefined;
  const description = 'Result set matches expectedSql (primary correctness signal)';

  const record = lastSuccessfulSqlRecord(turnRecords);
  if (!record) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: 'the agent ran no successful run_readonly_sql to compare',
    };
  }

  const datasourceId = datasetSnapshots.find((s) => s.datasourceId)?.datasourceId;
  if (!datasourceId) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: 'could not resolve a datasource for the expectedSql comparison',
    };
  }

  try {
    const expected = await getDatasetToolServices().runReadOnlySql(
      datasourceId,
      expectedSql,
      RESULT_SET_ROW_LIMIT,
      datasets,
    );
    const { match, reason } = compareResults(expected.rows, record.rows ?? [], {
      widthTolerant: true,
    });
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: match ? 1 : 0,
      passed: match,
      reason: match
        ? undefined
        : `expectedSql returned ${expected.rows.length} row(s); the agent's SQL ("${record.input}") did not match — ${reason}`,
    };
  } catch (err) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `expectedSql failed to run — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
