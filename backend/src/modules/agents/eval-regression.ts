/**
 * Per-case verdict delta between two eval runs of the same agent, matched
 * by case id — the regression-tracking half of the eval harness. Pure and
 * LLM-free so it can be unit tested directly; `EvalRunsService` supplies the
 * two runs' results and persists the outcome on the newer run.
 *
 * Verdicts are pass^k (engineering plan §4): a case counts as passing only
 * when every attempt passed (`verdict === 'PASS'`). Runs recorded before
 * pass^k carry only `passed`/`error`, which read as one attempt each. A GAP
 * or SKIP on either side is neither a regression nor an improvement — the
 * harness could not measure that side, so it is reported as `unmeasured`.
 */
import type { EvalVerdict } from './eval-telemetry';

/** Enough to point at the case from a report or the API — never the full
 * result (scores, tool calls, answer text), which lives on the run itself. */
export interface EvalCaseDelta {
  id: string;
  question: string;
}

export interface EvalRegressionSummary {
  /** The run this one was compared against. */
  previousRunId: string;
  /** Passed (pass^k) on the previous run, fails or errors on this one. */
  regressions: EvalCaseDelta[];
  /** Failed or errored on the previous run, passes (pass^k) on this one. */
  improvements: EvalCaseDelta[];
  /** Same measured outcome on both runs. */
  unchanged: EvalCaseDelta[];
  /**
   * GAP or SKIP on either side: not measured, so neither better nor worse.
   * Absent on comparisons stored before pass^k.
   */
  unmeasured?: EvalCaseDelta[];
  /**
   * Cases whose flaky flag (0 < passes < runs) changed either way. Absent on
   * comparisons stored before pass^k.
   */
  flakyChanges?: EvalCaseDelta[];
  /**
   * Both runs used the same engine config hash (levers + model + effort).
   * False means the delta mixes a lever change with whatever else changed —
   * the report says so. Absent on comparisons stored before config hashes.
   */
  sameConfig?: boolean;
  /** Both runs used the same `repeat` (pass^1 vs pass^3 is not like-for-like). */
  sameRepeat?: boolean;
}

/**
 * The minimum a case result needs to carry for the diff — decoupled from
 * `AssistantEvalCaseResult`'s full shape (scores, tool calls, answer text,
 * checkResults) on purpose, so this stays a pure, dependency-free function
 * that is trivial to unit test.
 */
export interface ComparableCaseResult {
  id: string;
  question: string;
  /** Legacy verdict, used only when `verdict` is absent (runs before pass^k). */
  passed: boolean;
  /** Legacy error marker: an old result with an error was an ERROR. */
  error?: string;
  /** The pass^k verdict. */
  verdict?: EvalVerdict;
  flaky?: boolean;
}

/** The case's pass^k verdict, falling back to `passed`/`error` for old runs. */
export function comparableVerdict(result: ComparableCaseResult): EvalVerdict {
  if (result.verdict) return result.verdict;
  if (result.error) return 'ERROR';
  return result.passed ? 'PASS' : 'FAIL';
}

function measured(verdict: EvalVerdict): boolean {
  return verdict !== 'GAP' && verdict !== 'SKIP';
}

/**
 * Diff two runs' results by case id. Cases that exist in only one of the two
 * runs (the suite's case list changed between runs) are skipped — there is
 * nothing to compare them against.
 */
export function computeRegressionDiff(
  previous: ComparableCaseResult[],
  current: ComparableCaseResult[],
): Omit<
  EvalRegressionSummary,
  'previousRunId' | 'sameConfig' | 'sameRepeat'
> & {
  unmeasured: EvalCaseDelta[];
  flakyChanges: EvalCaseDelta[];
} {
  const previousById = new Map(previous.map((result) => [result.id, result]));
  const regressions: EvalCaseDelta[] = [];
  const improvements: EvalCaseDelta[] = [];
  const unchanged: EvalCaseDelta[] = [];
  const unmeasured: EvalCaseDelta[] = [];
  const flakyChanges: EvalCaseDelta[] = [];

  for (const result of current) {
    const before = previousById.get(result.id);
    if (!before) continue;
    const delta: EvalCaseDelta = { id: result.id, question: result.question };
    const was = comparableVerdict(before);
    const now = comparableVerdict(result);
    if (!measured(was) || !measured(now)) unmeasured.push(delta);
    else if (was === 'PASS' && now !== 'PASS') regressions.push(delta);
    else if (was !== 'PASS' && now === 'PASS') improvements.push(delta);
    else unchanged.push(delta);
    if (Boolean(before.flaky) !== Boolean(result.flaky)) {
      flakyChanges.push(delta);
    }
  }

  return { regressions, improvements, unchanged, unmeasured, flakyChanges };
}
