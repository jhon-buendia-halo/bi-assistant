// Result-set comparison scoring for eval cases that carry `expectedSql`.
//
// Deliberately isolated from `assistant.agent.ts`/`@mastra/core/agent`:
// nothing here pulls in the agent stack, so a spec file can exercise this
// logic directly without the ESM-only transitive deps that break under
// CommonJS Jest (same reason `agent-constants.ts` and `context-blocks.ts`
// stay dependency-free). The check-result shape comes from `eval-checks.ts`,
// which is pure as well.
import { compareResults } from '../../modules/sessions/result-compare';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot } from '../tool-services';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { EvalCheckResult } from './eval-checks';

export interface ResultSetCheckOptions {
  /** For questions about distinct facts, repeated identical facts are harmless. */
  distinctRows?: boolean;
  /**
   * The reference is a ratio the answer may report as a fraction or as a
   * percentage: when the answer's rows do not match as they are, its numeric
   * cells are also tried scaled by 100 and by 1/100. Use on rate questions
   * only, with a reference that does not round.
   */
  percentEquivalent?: boolean;
  /**
   * Compare the answer's **final** SQL (the last successful
   * `run_readonly_sql`) first — that is the query the answer used, and the
   * one the metric is defined on (engineering plan §4). Only when it does not
   * match are the earlier successful queries tried; a match there still
   * passes, but is flagged `viaSupportingQuery` so a report can tell "the
   * answer's query was right" from "some query in the turn was right".
   *
   * When the final result cannot be measured at all (a replay failed, it is
   * past the comparison cap) and no earlier query matched, the check is a
   * measurement gap rather than a failure: the SQL the answer used was never
   * judged. Default `true`; `false` keeps the capture-order scan with no flag.
   */
  preferFinal?: boolean;
}

/** The result-set verdict, with the two facts only this check can know. */
export interface ResultSetCheckResult extends EvalCheckResult {
  /**
   * The harness could not measure the case (no comparable rows, a failed
   * replay, a broken or truncated reference): not the same as failed, and
   * excluded from pass rates (`GAP`). `passed` is `false` alongside it, and
   * `reason` starts with `HARNESS_UNMEASURED_PREFIX`.
   */
  gap?: boolean;
  /** Passed on an earlier query, not the answer's final one (`preferFinal` only). */
  viaSupportingQuery?: boolean;
  /**
   * Which reference the passing result matched, when the case has
   * alternatives: 0 = `expectedSql` (or its dialect override), n =
   * `expectedSqlAlternatives[n - 1]`. Absent on a case with one reference.
   */
  matchedReference?: number;
}

type Row = Record<string, unknown>;

/**
 * How the eval harness compares: width-tolerant (extra columns are context)
 * and precision-tolerant, because a hand-written reference that rounds
 * (`ROUND(x, 4)`) must not fail an answer whose SQL did not — or the other
 * way round. `compareResults` documents the rounding rule; careful mode's
 * cross-check does not use it.
 */
const EVAL_COMPARISON = { widthTolerant: true, precisionTolerant: true };

/** A candidate must contain every reference value, never just a subset. */
function containsReferenceRow(expected: Row, actual: Row): boolean {
  return (
    Object.keys(actual).length >= Object.keys(expected).length &&
    compareResults([expected], [actual], EVAL_COMPARISON).match
  );
}

/** Every numeric cell (a number, or a string that is one) times `factor`. */
function scaleNumericCells(rows: Row[], factor: number): Row[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const numeric =
          typeof value === 'number'
            ? value
            : typeof value === 'string' &&
                /^-?\d+(?:\.\d+)?$/.test(value.trim())
              ? Number(value)
              : undefined;
        return [key, numeric === undefined ? value : numeric * factor];
      }),
    ),
  );
}

function compareEvidence(
  expected: Row[],
  actual: Row[],
  options: ResultSetCheckOptions,
): { match: boolean; reason: string } {
  const direct = compareEvidenceAsIs(expected, actual, options);
  if (direct.match || !options.percentEquivalent) return direct;
  // A fraction reported as a percentage (or the reverse) is the same fact.
  for (const factor of [100, 0.01]) {
    const scaled = compareEvidenceAsIs(
      expected,
      scaleNumericCells(actual, factor),
      options,
    );
    if (scaled.match) return scaled;
  }
  return direct;
}

function compareEvidenceAsIs(
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
  return compareResults(expected, actual, EVAL_COMPARISON);
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

/** How a reference is named in a reason: its field in the suite JSON. */
function referenceLabel(index: number): string {
  return index === 0 ? 'expectedSql' : `expectedSqlAlternatives[${index - 1}]`;
}

/** One reference that ran completely, by its position in the list. */
interface ReferenceResult {
  index: number;
  rows: Row[];
}

/**
 * Score one eval case's result set against its `expectedSql`, when it has
 * one. `expectedSql` may be a list — the primary reference followed by
 * `expectedSqlAlternatives` (`referenceSqlsFor`) — and the case passes when
 * a candidate matches ANY of them: a question that names no unit is answered
 * correctly in cents or in dollars, and one reference cannot say both. Runs
 * every reference through the same `DatasetToolServices` bridge
 * `run_readonly_sql` itself uses, then compares against the agent's own
 * captured rows (re-running a statement when its capture is not
 * known-complete — see `candidateEvidence`). One complete result must match
 * all facts of one reference (extra columns are fine, and numbers agree
 * within rounding — `EVAL_COMPARISON`). Rows from different queries are
 * never combined, nor are extra rows ignored.
 *
 * With `preferFinal` (the default) the answer's final SQL is compared first,
 * then the earlier successful queries — a supporting query can follow or
 * precede the answer query, and a match on one passes with
 * `viaSupportingQuery`. See `ResultSetCheckOptions.preferFinal`.
 *
 * Harness-side faults come back as `gap: true` with a reason starting with
 * `HARNESS_UNMEASURED_PREFIX` — nothing comparable was captured, no
 * datasource resolved, every reference failed to run or was truncated, or
 * the final result could not be read back. Those are the harness failing to
 * measure and must never be read as a wrong answer. "The agent ran no
 * successful SQL" is the agent's doing, and an ordinary failure.
 *
 * Returns `undefined` when the case has no `expectedSql` — callers should
 * skip adding a check in that case rather than reporting a vacuous pass.
 */
export async function runResultSetCheck(
  expectedSql: string | readonly string[] | undefined,
  datasets: string[],
  datasetSnapshots: DatasetSnapshot[],
  turnRecords: ToolDataRecord[],
  options: ResultSetCheckOptions = {},
): Promise<ResultSetCheckResult | undefined> {
  const references = (
    typeof expectedSql === 'string' ? [expectedSql] : (expectedSql ?? [])
  ).filter(Boolean);
  if (!references.length) return undefined;
  const preferFinal = options.preferFinal ?? true;
  const description =
    'Result set matches expectedSql (primary correctness signal)';
  const failed = (reason: string): ResultSetCheckResult => ({
    id: RESULT_SET_CHECK_ID,
    description,
    score: 0,
    passed: false,
    reason,
  });
  const gap = (detail: string): ResultSetCheckResult => ({
    ...failed(`${HARNESS_UNMEASURED_PREFIX}: ${detail}`),
    gap: true,
  });

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
      return gap(`${detail}.`);
    }
    return failed('the agent ran no successful run_readonly_sql to compare');
  }

  const datasourceId = datasetSnapshots.find(
    (s) => s.datasourceId,
  )?.datasourceId;
  if (!datasourceId) {
    return gap(
      'could not resolve a datasource for the expectedSql comparison.',
    );
  }

  // Every reference runs up front: the final SQL is compared against all of
  // them before any earlier query is tried, so the first comparison needs
  // them all anyway.
  const usable: ReferenceResult[] = [];
  const broken: string[] = [];
  for (const [index, sql] of references.entries()) {
    try {
      const reference = await getDatasetToolServices().runReadOnlySql(
        datasourceId,
        sql,
        RESULT_SET_ROW_LIMIT,
        datasets,
      );
      if (reference.truncated) {
        broken.push(
          references.length === 1
            ? 'the reference result is truncated; completeness cannot be verified.'
            : `${referenceLabel(index)} is truncated; completeness cannot be verified`,
        );
        continue;
      }
      usable.push({ index, rows: reference.rows });
    } catch (err) {
      broken.push(
        `${referenceLabel(index)} failed to run — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  // A gap only when no reference can judge: one that runs is a verdict, and
  // an alternative written in Postgres SQL may legitimately fail elsewhere.
  if (!usable.length) {
    return gap(
      references.length === 1
        ? broken[0]
        : `none of the ${references.length} references could be used — ${broken.join('; ')}.`,
    );
  }
  // Reasons quote the first reference that ran — the primary, unless it is
  // the one that broke.
  const expected = usable[0].rows;
  const expectedLabel = referenceLabel(usable[0].index);
  const unusedNote = broken.length
    ? ` (${broken.length} reference(s) could not be used: ${broken.join('; ')})`
    : '';

  const candidates = turnRecords.filter(
    (candidate) =>
      candidate.tool === 'run_readonly_sql' &&
      !candidate.error &&
      candidate.input,
  );
  // The final query first (the SQL the answer used), then the rest in
  // capture order. Without `preferFinal`: capture order, no flag.
  const ordered = preferFinal
    ? [record, ...candidates.filter((candidate) => candidate !== record)]
    : candidates;

  let finalOutcome: { compared: boolean; reason: string } | undefined;
  let lastComparedReason = '';
  let compared = 0;
  const unmeasured: string[] = [];
  for (const candidate of ordered) {
    const evidence = await candidateEvidence(candidate, datasourceId, datasets);
    if (!evidence.rows) {
      const problem = evidence.problem ?? 'no comparable rows were found';
      if (candidate === record)
        finalOutcome = { compared: false, reason: problem };
      if (!unmeasured.includes(problem)) unmeasured.push(problem);
      continue;
    }
    compared++;
    // Against every reference before the next candidate: the final SQL
    // matching an alternative is the answer's query being right, which an
    // earlier query matching the primary is not.
    let firstReason: string | undefined;
    for (const reference of usable) {
      const comparison = compareEvidence(
        reference.rows,
        evidence.rows,
        options,
      );
      if (comparison.match) {
        return {
          id: RESULT_SET_CHECK_ID,
          description,
          score: 1,
          passed: true,
          ...(preferFinal && candidate !== record
            ? { viaSupportingQuery: true }
            : {}),
          ...(references.length > 1
            ? { matchedReference: reference.index }
            : {}),
        };
      }
      firstReason ??= comparison.reason;
    }
    const reason =
      (firstReason ?? '') +
      (usable.length > 1
        ? ` (nor did it match the ${usable.length - 1} alternative reference(s))`
        : '') +
      (evidence.replayed ? ' (compared a re-run of the captured SQL)' : '');
    if (candidate === record) finalOutcome = { compared: true, reason };
    lastComparedReason = reason;
  }

  // Nothing was compared: the case is unjudged, not failed by the agent.
  if (!compared) {
    const detail = unmeasured.join('; ') || 'no comparable rows were found';
    warnOnce('unmeasured', detail);
    return gap(
      `${expectedLabel} returned ${expected.length} row(s), but none of ${candidates.length} successful SQL result(s) could be read back to compare — ${detail}. The last SQL was "${record.input}".`,
    );
  }

  const skipped = unmeasured.length
    ? ` (${unmeasured.length} further result(s) could not be measured: ${unmeasured.join('; ')})`
    : '';
  if (preferFinal && finalOutcome && !finalOutcome.compared) {
    // The answer's own query was never judged; earlier ones not matching is
    // expected (they are supporting queries), so this is not a failure.
    warnOnce('unmeasured', finalOutcome.reason);
    return gap(
      `the final SQL ("${record.input}") could not be read back to compare — ${finalOutcome.reason}; ${compared} earlier SQL result(s) were compared and none matched the ${expected.length} reference row(s).`,
    );
  }
  // The final query's mismatch is the one worth reading; without
  // `preferFinal`, the last comparison made (the old behaviour).
  const lastReason =
    preferFinal && finalOutcome?.compared
      ? finalOutcome.reason
      : lastComparedReason;
  return failed(
    `${expectedLabel} returned ${expected.length} row(s); none of ${compared} compared SQL result(s) matched. The last SQL ("${record.input}") did not match — ${lastReason}${skipped}${unusedNote}`,
  );
}
