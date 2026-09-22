/**
 * Shapes returned by the agent eval endpoints, plus the pure formatting and
 * ordering helpers the Evals tab renders them with.
 *
 * The helpers live here (rather than on the component) because two components
 * need them — the Evals tab and the right-hand trace panel — and because they
 * are the part worth unit testing: the honesty rules around cost and tokens,
 * and the worst-first category ordering an operator reads as a diagnosis.
 */

/** Tokens a run or a single case spent, summed over every model call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** `inputTokens + outputTokens` unless the provider reports its own total. */
  totalTokens: number;
  /** Reasoning/thinking tokens, when the provider separates them out. */
  reasoningTokens: number;
  /** Prompt tokens served from the provider's cache, when reported. */
  cachedInputTokens: number;
  /** How many model calls this was summed over. 0 means "nothing observed". */
  calls: number;
}

/** Pass rate for one failure class. */
export interface CategoryTally {
  total: number;
  passed: number;
}

/** Enough to point at a case from the run-to-run diff. */
export interface EvalCaseDelta {
  id: string;
  question: string;
}

/** How this run's verdicts moved against the previous run's. */
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

export interface AgentEvalCheck {
  id: string;
  name: string;
  description: string;
}

export interface AgentEvalCase {
  id: string;
  /** Failure class the question probes, e.g. `ties` or `value-vocabulary`. */
  category: string;
  question: string;
  /** What the question probes for. */
  intent: string;
  checks: AgentEvalCheck[];
}

export interface EvalToolCall {
  name: string;
  input?: string;
  output?: string;
  error?: string;
}

export interface EvalCheckResult {
  id: string;
  description: string;
  score: number;
  passed: boolean;
  /** Why the check failed, when the scorer reports it. */
  reason?: string;
}

export interface AgentEvalCaseResult {
  id: string;
  question: string;
  /** Failure class, absent on results recorded before categories existed. */
  category?: string;
  /** Score per scorer id, 0..1. */
  scores: Record<string, number>;
  checkResults: EvalCheckResult[];
  /** The agent's final answer. */
  answer: string;
  /** The tool calls the agent made, in order. */
  toolCalls: EvalToolCall[];
  passed: boolean;
  error?: string;
  durationMs: number;
  /** Tokens this question spent. Absent when nothing was recorded. */
  usage?: TokenUsage;
}

/**
 * A named group of eval questions sharing one fixture — one suite on the
 * backend. The questions tab lists the sets and opens one at a time.
 */
export interface AgentEvalSet {
  id: string;
  name: string;
  /** What the set covers and what it needs to run. */
  description: string;
  /** The registry sample the set questions, when it is a bundled one. */
  fixtureId?: string;
  /** The dataset names the set's questions are written against. */
  datasets: string[];
  cases: AgentEvalCase[];
}

export interface EvalRunView {
  jobId: string;
  agentKey: string;
  /** The suite the questions came from. */
  suiteId: string;
  suiteName: string;
  datasourceId: string;
  /** Datasets the questions were scoped to. */
  datasets: string[];
  caseIds: string[];
  status: 'running' | 'completed' | 'failed';
  results: AgentEvalCaseResult[];
  totalCases: number;
  currentQuestion?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  /** Absent when there was no previous run to compare against. */
  comparison?: EvalRegressionSummary;
  /** Absent on runs recorded before token accounting existed. */
  usage?: TokenUsage;
  /** Absent when the model that ran has no configured rate. */
  estimatedCostUsd?: number;
  /** The model id the run resolved to, e.g. `openai/gpt-4o-mini`. */
  model?: string;
  /** Pass rate per failure class. */
  categories?: Record<string, CategoryTally>;
}

/** What `GET /agents/:key/evals` answers: every set with its questions. */
export interface AgentEvalCatalog {
  sets: AgentEvalSet[];
}

export interface EvalRunStartResult {
  ok: boolean;
  message: string;
  jobId?: string;
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

/**
 * A run only reports tokens when the provider actually said something. Zero
 * calls means nothing was observed, which is not the same as a free run — the
 * UI must say "not measured" rather than print a confident 0.
 */
export function isUsageMeasured(usage: TokenUsage | undefined): boolean {
  return !!usage && usage.calls > 0;
}

/** `41231` → `41,231`. Exact counts, for the detail block. */
export function formatTokenCount(count: number): string {
  return Math.round(count).toLocaleString('en-US');
}

/** `41231` → `41.2k`, `1_240_000` → `1.24M`. Compact, for the card header. */
export function formatTokensCompact(count: number): string {
  const n = Math.round(count);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** The exact copy shown when no rate is configured for the model that ran. */
export const NOT_PRICED_LABEL =
  'not priced — add the model to logs/pricing.json';
export const NOT_MEASURED_LABEL = 'not measured';

export type EvalCostKind = 'not-measured' | 'not-priced' | 'priced';

export interface EvalCostState {
  kind: EvalCostKind;
  label: string;
}

/** Sub-cent runs would round to `$0.00`, which reads as free — so widen. */
function usd(amount: number): string {
  const decimals = amount > 0 && amount < 0.01 ? 4 : 2;
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * The three honest answers about what a run cost, in order of how little we
 * know: nothing was measured, tokens were measured but the model has no rate,
 * or an actual estimate. A cost is never invented, and `undefined` never
 * renders as `$0.00`.
 */
export function evalCostState(
  usage: TokenUsage | undefined,
  estimatedCostUsd: number | undefined,
): EvalCostState {
  if (!isUsageMeasured(usage))
    return { kind: 'not-measured', label: NOT_MEASURED_LABEL };
  if (estimatedCostUsd === undefined || estimatedCostUsd === null)
    return { kind: 'not-priced', label: NOT_PRICED_LABEL };
  return { kind: 'priced', label: usd(estimatedCostUsd) };
}

/** A category's tally with its derived rate, ready to render. */
export interface CategoryRate {
  category: string;
  total: number;
  passed: number;
  /** 0..1; 0 when the category somehow has no cases. */
  rate: number;
}

/**
 * Worst rate first — that ordering is the diagnostic: the top row is the
 * lever the operator should pull next. Ties go to the larger category (a
 * 0/8 matters more than a 0/1), then alphabetically so the list is stable.
 */
export function sortedCategoryRates(
  categories: Record<string, CategoryTally> | undefined,
): CategoryRate[] {
  if (!categories) return [];
  return Object.entries(categories)
    .map(([category, tally]) => ({
      category,
      total: tally.total,
      passed: tally.passed,
      rate: tally.total > 0 ? tally.passed / tally.total : 0,
    }))
    .sort(
      (a, b) =>
        a.rate - b.rate ||
        b.total - a.total ||
        a.category.localeCompare(b.category),
    );
}

/** `0.5` → `50%`. */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Green only at a clean sweep, red below half, amber in between. */
export function categoryRateClass(rate: number): string {
  if (rate >= 1) return 'text-emerald-400';
  if (rate < 0.5) return 'text-red-400';
  return 'text-amber-400';
}
