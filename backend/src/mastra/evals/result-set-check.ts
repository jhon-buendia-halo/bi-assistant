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
 * Prefix for the one failure that is *not* the agent's fault: the harness
 * never got a comparable result set to judge. It used to read as an ordinary
 * "did not match", which is how a measurement gap hid inside the failure
 * count for a whole improvement loop — a correct answer and an unmeasured one
 * looked identical in the report.
 */
export const HARNESS_UNMEASURED_PREFIX =
  'MEASUREMENT GAP (eval harness, not the agent)';

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
    if (record.tool === 'run_readonly_sql' && !record.error && record.input) {
      return record;
    }
  }
  return undefined;
}

/**
 * A captured result is comparable only when it is known to be the *whole*
 * result of that query: comparing a clipped page against a complete reference
 * would pass a query that really returns more rows than the reference does.
 */
function captureIsComplete(candidate: ToolDataRecord): boolean {
  return (
    Array.isArray(candidate.rows) &&
    !candidate.truncated &&
    (candidate.rowCount === undefined ||
      candidate.rowCount === candidate.rows.length)
  );
}

interface Evidence {
  /** The complete result set of the candidate's SQL, when one was obtained. */
  rows?: Row[];
  /** Why no complete result set could be obtained — a harness-side limit. */
  problem?: string;
  /** True when the rows came from re-running the SQL rather than the capture. */
  replayed?: boolean;
}

/**
 * A record with no rows at all did not come back clipped — it came back
 * uncaptured, which means the capture path (`toolResultRecords`) stopped
 * understanding the SDK's tool-result shape. The run is still measurable by
 * re-running the SQL, but the defect itself must not pass quietly.
 */
function captureGap(candidate: ToolDataRecord): string | undefined {
  if (Array.isArray(candidate.rows)) return undefined;
  return `no rows were captured for ${candidate.tool} ("${candidate.input ?? 'unknown SQL'}") — the tool-result capture may no longer match the SDK's payload shape`;
}

/**
 * The complete result set behind one captured SQL call.
 *
 * The capture is often flagged incomplete for a reason that has nothing to do
 * with the answer: `run_readonly_sql` reports `truncated` whenever the result
 * fills the row limit the *model itself* asked for, so a `SELECT COUNT(*)`
 * run with `limit: 1` comes back "truncated" while being exactly complete.
 * The transcript's own `STORED_ROWS_CAP` clips long results the same way.
 * Refusing to compare in those cases marked correct answers as failures.
 *
 * So when the capture is not known-complete, re-run the statement at the
 * comparison limit — the same replay `scripts/run-eval.ts` has always done
 * ("the stored rows are capped at 200 and the reference run is capped at 500,
 * so replay it under the same limit"). That establishes completeness instead
 * of assuming it: a query that genuinely returns more rows than the cap comes
 * back truncated again and is still refused, so a clipped result can never
 * be compared into a false pass.
 */
async function candidateEvidence(
  candidate: ToolDataRecord,
  datasourceId: string,
  datasets: string[],
): Promise<Evidence> {
  if (captureIsComplete(candidate)) return { rows: candidate.rows as Row[] };
  const gap = captureGap(candidate);
  if (gap) warnOnce('capture', gap);
  if (!candidate.input) {
    return {
      problem: 'the harness captured neither the rows nor the SQL of a call',
    };
  }
  try {
    const replay = await getDatasetToolServices().runReadOnlySql(
      datasourceId,
      candidate.input,
      RESULT_SET_ROW_LIMIT,
      datasets,
    );
    const rows = Array.isArray(replay.rows) ? replay.rows : [];
    if (replay.truncated || rows.length >= RESULT_SET_ROW_LIMIT) {
      return {
        problem: `a result of over ${RESULT_SET_ROW_LIMIT} rows cannot be compared completely`,
      };
    }
    return { rows, replayed: true };
  } catch (err) {
    return {
      problem: `re-running the captured SQL failed — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * A measurement gap is a harness defect, so it is reported once per run in
 * the console as well as in the case's reason — a reason buried in one case
 * of a 20-case table is exactly how the last one went unnoticed.
 */
const warned = new Set<string>();

/** Call at the start of a run so its first measurement gap warns again. */
export function resetResultSetCheckWarnings(): void {
  warned.clear();
}

function warnOnce(kind: 'capture' | 'unmeasured', detail: string): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  console.warn(
    `[eval] ${HARNESS_UNMEASURED_PREFIX}: ${detail}. This is the harness ` +
      'failing to measure, not the agent answering wrongly — check the ' +
      'harness before reading these cases as regressions.',
  );
}

/**
 * Score one eval case's result set against its `expectedSql`, when it has
 * one. Runs `expectedSql` through the same `DatasetToolServices` bridge
 * `run_readonly_sql` itself uses, then compares against the agent's own
 * captured rows from every successful SQL call (re-running the statement when
 * the capture is not known-complete — see `candidateEvidence`). Supporting
 * queries can follow the answer query; their position must not erase valid
 * evidence. One complete result must match all reference facts (extra columns
 * are fine). Rows from different queries are never combined, nor are extra
 * rows ignored.
 *
 * A case where *no* result set could be obtained fails with
 * `HARNESS_UNMEASURED_PREFIX` rather than a mismatch reason: that is the
 * harness failing to measure, and it must not be read as a wrong answer.
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
    // A capture that understood nothing about the call (no SQL, no rows) is
    // indistinguishable from an agent that never queried — unless it says so.
    const blind = turnRecords.filter(
      (candidate) =>
        candidate.tool === 'run_readonly_sql' &&
        !candidate.error &&
        !candidate.input,
    );
    if (blind.length) {
      const detail = `${blind.length} run_readonly_sql call(s) were captured with neither SQL nor rows — the tool-result capture may no longer match the SDK's payload shape`;
      warnOnce('capture', detail);
      return {
        id: RESULT_SET_CHECK_ID,
        description,
        score: 0,
        passed: false,
        reason: `${HARNESS_UNMEASURED_PREFIX}: ${detail}.`,
      };
    }
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: 'the agent ran no successful run_readonly_sql to compare',
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
        candidate.tool === 'run_readonly_sql' &&
        !candidate.error &&
        candidate.input,
    );
    let reason = '';
    let compared = 0;
    const unmeasured: string[] = [];
    for (const candidate of candidates) {
      const evidence = await candidateEvidence(
        candidate,
        datasourceId,
        datasets,
      );
      if (!evidence.rows) {
        if (evidence.problem && !unmeasured.includes(evidence.problem)) {
          unmeasured.push(evidence.problem);
        }
        continue;
      }
      compared++;
      const comparison = compareEvidence(expected.rows, evidence.rows, options);
      if (comparison.match) {
        return {
          id: RESULT_SET_CHECK_ID,
          description,
          score: 1,
          passed: true,
        };
      }
      reason =
        comparison.reason +
        (evidence.replayed ? ' (compared a re-run of the captured SQL)' : '');
    }
    // Nothing was compared: the case is unjudged, not failed by the agent.
    if (!compared) {
      const detail = unmeasured.join('; ') || 'no comparable rows were found';
      warnOnce('unmeasured', detail);
      return {
        id: RESULT_SET_CHECK_ID,
        description,
        score: 0,
        passed: false,
        reason: `${HARNESS_UNMEASURED_PREFIX}: expectedSql returned ${expected.rows.length} row(s), but none of ${candidates.length} successful SQL result(s) could be read back to compare — ${detail}. The last SQL was "${record.input}".`,
      };
    }
    const skipped = unmeasured.length
      ? ` (${unmeasured.length} further result(s) could not be measured: ${unmeasured.join('; ')})`
      : '';
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `expectedSql returned ${expected.rows.length} row(s); none of ${compared} compared SQL result(s) matched. The last SQL ("${record.input}") did not match — ${reason}${skipped}`,
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
