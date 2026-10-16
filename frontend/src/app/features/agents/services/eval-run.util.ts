import {
  AgentEvalCaseResult,
  EvalCheckResult,
  EvalRunSummary,
  EvalRunView,
  EvalStatus,
} from './agents-api.service';

/** What the Evals tab and the eval trace print for each status. */
export const EVAL_STATUS_LABELS: Record<EvalStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  'not-scored': 'Not scored',
};

/** A check's status; runs stored before statuses existed only say `passed`. */
export function checkStatus(check: EvalCheckResult): EvalStatus {
  return check.status ?? (check.passed ? 'passed' : 'failed');
}

/** A question's status, read the same way as a check's. */
export function resultStatus(result: AgentEvalCaseResult): EvalStatus {
  return result.status ?? (result.passed ? 'passed' : 'failed');
}

/** The result of one of a question's checks, by check id. */
export function checkResultFor(
  result: AgentEvalCaseResult,
  checkId: string,
): EvalCheckResult | undefined {
  return result.checkResults.find((check) => check.id === checkId);
}

/** How many of a run's finished questions came out each way. */
export function runCounts(
  results: readonly AgentEvalCaseResult[],
): Record<'passed' | 'failed' | 'notScored', number> {
  const counts = { passed: 0, failed: 0, notScored: 0 };
  for (const result of results) {
    const status = resultStatus(result);
    if (status === 'not-scored') counts.notScored++;
    else counts[status]++;
  }
  return counts;
}

/** "<passed>/<total> passed", plus " · <n> not scored" when there are any. */
export function runHeadline(
  results: readonly AgentEvalCaseResult[],
  total: number,
): string {
  const { passed, notScored } = runCounts(results);
  const head = `${passed}/${total} passed`;
  return notScored > 0 ? `${head} · ${notScored} not scored` : head;
}

/**
 * The icon a run gets in Executions: a spinner while it runs; a tick when
 * every question passed; a cross when one failed or the run stopped short;
 * otherwise (nothing failed, some not scored) the neutral not-scored mark.
 */
export function runVerdict(run: EvalRunView): EvalStatus | 'running' {
  if (run.status === 'running') return 'running';
  const { passed, failed } = runCounts(run.results);
  if (passed === run.totalCases) return 'passed';
  if (
    failed > 0 ||
    run.status === 'failed' ||
    run.results.length < run.totalCases
  ) {
    return 'failed';
  }
  return 'not-scored';
}

/**
 * A run's tables by category and criterion (agents-evals R148, R152): its
 * summary once a question has finished, which the backend keeps current
 * while the run goes and recomputes on every read. Null before the first
 * question finishes, or if a summary is missing.
 */
export function evalRunSummary(run: EvalRunView): EvalRunSummary | null {
  return run.results.length > 0 && run.summary ? run.summary : null;
}
