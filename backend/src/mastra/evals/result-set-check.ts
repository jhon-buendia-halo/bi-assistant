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

export interface ResultSetCheckOptions {
  /** For questions about distinct facts, repeated identical facts are harmless. */
  distinctRows?: boolean;
}

/** The data-query tool each eval path actually has: `run_readonly_sql` on
 * `legacy`, `query_entities` on `model` (ADR-0007) — a check that only ever
 * recognised `run_readonly_sql` silently found nothing to compare on the
 * `model` path (every result-set check "passed" by reporting "the agent ran
 * no successful run_readonly_sql", which a path-blind reading of the report
 * could mistake for 0/0 rather than a miss). Defined here (not
 * `assistant.evals.ts`, which imports `@mastra/core/agent` transitively via
 * the real agents) so this file's own Jest-safety guarantee — see the header
 * comment — still holds for whichever side imports the other. */
export const dataQueryTools = ['run_readonly_sql', 'query_entities'] as const;

function isDataQueryRecord(record: ToolDataRecord): boolean {
  return (dataQueryTools as readonly string[]).includes(record.tool);
}

type Row = Record<string, unknown>;

/** A candidate must contain every reference value, never just a subset. */
function containsReferenceRow(expected: Row, actual: Row): boolean {
  return (
    Object.keys(actual).length >= Object.keys(expected).length &&
    compareResults([expected], [actual], { widthTolerant: true }).match
  );
}

function compareEvidence(
  expected: Row[],
  actual: Row[],
  options: ResultSetCheckOptions,
): { match: boolean; reason: string } {
  if (options.distinctRows && expected.length && actual.length) {
    // Set equality at the reference's grain. Extra columns are context, but
    // every returned row must still describe one of the expected facts.
    const match =
      expected.every((row) =>
        actual.some((candidate) => containsReferenceRow(row, candidate)),
      ) &&
      actual.every((row) =>
        expected.some((reference) => containsReferenceRow(reference, row)),
      );
    return { match, reason: match ? '' : 'the distinct facts differ' };
  }
  if (
    expected.length &&
    actual.some(
      (row) => Object.keys(row).length < Object.keys(expected[0]).length,
    )
  ) {
    return {
      match: false,
      reason: 'the result omits required reference values',
    };
  }
  return compareResults(expected, actual, { widthTolerant: true });
}

/** Scorer id for the result-set check, shown in the report's checks table. */
export const RESULT_SET_CHECK_ID = 'result-set-match';

/**
 * Connectors clamp `runReadOnlySql` at 500 rows (mirrors the golden-set
 * harness, `scripts/run-eval.ts`) — comparing more than that is moot.
 */
export const RESULT_SET_ROW_LIMIT = 500;

/**
 * The last `run_readonly_sql` call that did not error. This may be a coverage
 * lookup or supporting detail rather than the answer. Mirrors `lastSuccessfulSql` in
 * `scripts/run-eval.ts`, applied to the live `turnRecords` an eval run
 * captures via `onStepFinish` instead of a persisted session transcript.
 */
export function lastSuccessfulSqlRecord(
  records: ToolDataRecord[],
): ToolDataRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (isDataQueryRecord(record) && !record.error && record.input) {
      return record;
    }
  }
  return undefined;
}

/**
 * Score one eval case's result set against its `expectedSql`, when it has
 * one. Runs `expectedSql` through the same `DatasetToolServices` bridge
 * `run_readonly_sql` itself uses, then compares against the agent's own
 * captured rows from every successful, complete SQL call. Supporting queries
 * can follow the answer query; their position must not erase valid evidence.
 * One complete result must match all reference facts (extra columns are fine).
 * Rows from different queries are never combined, nor are extra rows ignored.
 *
 * Returns `undefined` when the case has no `expectedSql` — callers should
 * skip adding a check in that case rather than reporting a vacuous pass.
 */
export async function runResultSetCheck(
  expectedSql: string | undefined,
  datasets: string[],
  datasetSnapshots: DatasetSnapshot[],
  turnRecords: ToolDataRecord[],
  options: ResultSetCheckOptions = {},
): Promise<EvalCheckResult | undefined> {
  if (!expectedSql) return undefined;
  const description =
    'Result set matches expectedSql (primary correctness signal)';

  const record = lastSuccessfulSqlRecord(turnRecords);
  if (!record) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: 'the agent ran no successful data query to compare',
    };
  }

  const datasourceId = datasetSnapshots.find(
    (s) => s.datasourceId,
  )?.datasourceId;
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
    if (expected.truncated) {
      throw new Error(
        'reference result is truncated; completeness cannot be verified',
      );
    }
    const candidates = turnRecords.filter(
      (candidate) =>
        isDataQueryRecord(candidate) && !candidate.error && candidate.input,
    );
    let reason = '';
    for (const candidate of candidates) {
      if (
        !Array.isArray(candidate.rows) ||
        candidate.truncated ||
        (candidate.rowCount !== undefined &&
          candidate.rowCount !== candidate.rows.length)
      ) {
        reason = 'captured rows are missing or truncated';
        continue;
      }
      const comparison = compareEvidence(
        expected.rows,
        candidate.rows,
        options,
      );
      if (comparison.match) {
        return {
          id: RESULT_SET_CHECK_ID,
          description,
          score: 1,
          passed: true,
        };
      }
      reason = comparison.reason;
    }
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `expectedSql returned ${expected.rows.length} row(s); none of ${candidates.length} successful SQL result(s) matched. The last SQL ("${record.input}") did not match — ${reason}`,
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
