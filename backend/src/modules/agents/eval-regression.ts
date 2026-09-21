/**
 * Per-case pass/fail delta between two eval runs of the same agent, matched
 * by case id — the regression-tracking half of the eval harness. Pure and
 * LLM-free so it can be unit tested directly; `EvalRunsService` supplies the
 * two runs' results and persists the outcome on the newer run.
 */

/** Enough to point at the case from a report or the API — never the full
 * result (scores, tool calls, answer text), which lives on the run itself. */
export interface EvalCaseDelta {
  id: string;
  question: string;
}

export interface EvalRegressionSummary {
  /** The run this one was compared against. */
  previousRunId: string;
  /** Passed on the previous run, fails on this one. */
  regressions: EvalCaseDelta[];
  /** Failed on the previous run, passes on this one. */
  improvements: EvalCaseDelta[];
  /** Same verdict on both runs. */
  unchanged: EvalCaseDelta[];
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
  passed: boolean;
}

/**
 * Diff two runs' results by case id. Cases that exist in only one of the two
 * runs (the suite's case list changed between runs) are skipped — there is
 * nothing to compare them against.
 */
export function computeRegressionDiff(
  previous: ComparableCaseResult[],
  current: ComparableCaseResult[],
): Omit<EvalRegressionSummary, 'previousRunId'> {
  const previousById = new Map(previous.map((result) => [result.id, result]));
  const regressions: EvalCaseDelta[] = [];
  const improvements: EvalCaseDelta[] = [];
  const unchanged: EvalCaseDelta[] = [];

  for (const result of current) {
    const before = previousById.get(result.id);
    if (!before) continue;
    const delta: EvalCaseDelta = { id: result.id, question: result.question };
    if (before.passed && !result.passed) regressions.push(delta);
    else if (!before.passed && result.passed) improvements.push(delta);
    else unchanged.push(delta);
  }

  return { regressions, improvements, unchanged };
}
