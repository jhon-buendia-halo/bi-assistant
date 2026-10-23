import {
  AgentEvalCaseResult,
  EvalCheckResult,
  EvalRepeats,
  EvalRunSummary,
  EvalRunView,
  EvalSplitSummary,
  EvalStatus,
  ModelUsageEntry,
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

/** Attempts per question; runs saved before repeats existed made one. */
export function runRepeats(run: Pick<EvalRunView, 'repeats'>): EvalRepeats {
  return run.repeats ?? 1;
}

/** Attempts made at a question; one on a record from before repeats. */
export function resultRuns(result: AgentEvalCaseResult): number {
  return result.runs ?? 1;
}

/** Attempts of a question that passed; read from the status without it. */
export function resultPasses(result: AgentEvalCaseResult): number {
  return result.passes ?? (resultStatus(result) === 'passed' ? 1 : 0);
}

/** Whether some attempts passed and some failed (agents-evals R211). */
export function resultFlaky(result: AgentEvalCaseResult): boolean {
  return result.flaky ?? false;
}

/** Questions of a run that were flaky; its summary, else its results. */
export function runFlakyCount(run: EvalRunView): number {
  return run.summary?.flaky ?? run.results.filter(resultFlaky).length;
}

/** A question's split; runs saved before the split was stored read dev. */
export function resultSplit(result: AgentEvalCaseResult): 'dev' | 'held-out' {
  return result.split ?? 'dev';
}

/** `$<dollars to 4 decimals>`. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** What Executions shows for a run's cost; null when it was not recorded. */
export interface RunCost {
  /** `$0.0123` or `Not priced`. */
  label: string;
  priced: boolean;
  /** `No price for <models>` on an unpriced run. */
  title: string | null;
}

export function runCost(run: EvalRunView): RunCost | null {
  if (run.costUsd === undefined) return null;
  if (run.costUsd !== null) {
    return { label: formatCost(run.costUsd), priced: true, title: null };
  }
  const models = [...new Set((run.usage ?? []).map((u) => u.model))];
  const unpriced = models.filter((model) => !run.rates?.[model]);
  const named = unpriced.length > 0 ? unpriced : models;
  return {
    label: 'Not priced',
    priced: false,
    title: named.length > 0 ? `No price for ${named.join(', ')}` : null,
  };
}

/** A result's cost: dollars, `Not priced`, or null when not recorded. */
export function resultCostLabel(result: AgentEvalCaseResult): string | null {
  if (result.costUsd === undefined) return null;
  return result.costUsd === null ? 'Not priced' : formatCost(result.costUsd);
}

/** `61–91%` from a Wilson interval given as fractions. */
export function formatInterval(interval: {
  low: number;
  high: number;
}): string {
  return `${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%`;
}

/**
 * `<passed>/<scored> (<a–b%>)` for one split, or `—` when it has no scored
 * question (agents-evals R216).
 */
export function splitCell(split: EvalSplitSummary | undefined): string {
  if (!split) return '—';
  const scored = split.passed + split.failed;
  if (scored === 0) return '—';
  const head = `${split.passed}/${scored}`;
  return split.interval ? `${head} (${formatInterval(split.interval)})` : head;
}

/**
 * `Dev 20/25 (61–91%) · Held-out 9/15 (36–80%)`; null when the summary has
 * no split counts (a record an older server wrote).
 */
export function splitLine(summary: EvalRunSummary): string | null {
  if (!summary.bySplit) return null;
  return `Dev ${splitCell(summary.bySplit.dev)} · Held-out ${splitCell(summary.bySplit.heldOut)}`;
}

/** The names the Details panel gives each agent in a usage entry. */
export const USAGE_AGENT_LABELS: Record<ModelUsageEntry['agent'], string> = {
  assistant: 'Assistant',
  'sql-fixer': 'SQL fixer',
  designer: 'Designer',
  judge: 'Judge',
};

/**
 * `<input> in · <cached> cached · <output> out · <reasoning> reasoning`, the
 * cached and reasoning parts only when above 0, then the calls that reported
 * no usage.
 */
export function usageLabel(entry: ModelUsageEntry): string {
  const n = (value: number) => value.toLocaleString('en-US');
  const parts = [`${n(entry.inputTokens)} in`];
  if (entry.cachedInputTokens > 0) {
    parts.push(`${n(entry.cachedInputTokens)} cached`);
  }
  parts.push(`${n(entry.outputTokens)} out`);
  if (entry.reasoningTokens > 0) {
    parts.push(`${n(entry.reasoningTokens)} reasoning`);
  }
  if (entry.unreportedCalls > 0) {
    parts.push(
      entry.unreportedCalls === 1
        ? '1 call reported no usage'
        : `${entry.unreportedCalls} calls reported no usage`,
    );
  }
  return parts.join(' · ');
}
