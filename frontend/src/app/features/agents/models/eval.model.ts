/**
 * Shapes returned by the agent eval endpoints, plus the pure formatting and
 * ordering helpers the Evals tab renders them with.
 *
 * The helpers live here (rather than on the component) because two components
 * need them — the Evals tab and the right-hand trace panel — and because they
 * are the part worth unit testing: the honesty rules around cost and tokens,
 * and the worst-first category ordering an operator reads as a diagnosis.
 *
 * Run log v2 (`docs/plans/improvement-loop-execution.md` §2.3/2.6): the types
 * below mirror `backend/src/modules/agents/eval-telemetry.ts` and
 * `backend/src/modules/sessions/turn-result.ts` so the run history, compare
 * and trend views can read what the backend writes without re-deriving it.
 * Every field added to a type that already shipped is optional, so a run
 * recorded before v2 existed still type-checks (`normalizeRunLog` on the
 * backend fills the rest in).
 */

import type { CrossCheck } from '../../sessions/models/session.model';
import type { EngineOptions } from '../../engine/models/engine.model';

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
  difficulty?: 'easy' | 'medium' | 'hard';
  /** The case id this one is a variant of, when it was expanded from `variants`. */
  variantOf?: string;
  /** How the case's reference SQL was produced and checked. */
  provenance?: 'hand' | 'model-drafted-verified';
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
  /** Legacy single-run verdict; superseded by `verdict` (pass^k folded). */
  passed: boolean;
  error?: string;
  durationMs: number;
  /** Tokens this question spent. Absent when nothing was recorded. */
  usage?: TokenUsage;
  /** Pass^k verdict, incl. `GAP` — absent on results recorded before it existed. */
  verdict?: EvalVerdict;
  /** How many attempts this case ran (repeat). */
  runs?: number;
  /** How many of those attempts passed. */
  passes?: number;
  /** `0 < passes < runs` — passed some attempts and failed others. */
  flaky?: boolean;
  failureLabel?: FailureLabel;
  difficulty?: 'easy' | 'medium' | 'hard';
  variantOf?: string;
  /** The last successful `run_readonly_sql` statement the representative attempt used. */
  finalSql?: string;
  repairs?: SqlRepairRecord[];
  /** Result-guard and precheck warnings, deduplicated. */
  warnings?: string[];
  review?: AnswerReview;
  crossCheck?: CrossCheck;
  /** Every attempt this case ran (`repeat > 1`), representative one first when `runs` is 1. */
  attempts?: EvalRunLogAttempt[];
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
  /** `queued` = waiting behind another run in the same loop (§2.6). */
  status: 'queued' | 'running' | 'completed' | 'failed';
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
  /** How many attempts each case ran. */
  repeat?: EvalRepeat;
  /** Operator-supplied tag, e.g. `iter0-gpt5`. */
  label?: string;
  /** The named arm (or `custom:{json}`) this run applied over production defaults. */
  arm?: string;
  /** The engine levers this run actually ran with, resolved. */
  engine?: EngineOptions;
  /** `engineConfigHash(engine, { model, reasoningEffort })` — short id for "the same engine". */
  configHash?: string;
  /** Router id the eval judge ran on, when pinned. */
  judgeModel?: string;
  reasoningEffort?: string;
  /** The loop this run belongs to, when started via `startLoop`. */
  loopId?: string;
  /** Pass^k rollup once the run has finished. */
  summary?: EvalRunSummary;
  /** Path of the run-log v2 file this run was written to. */
  logFile?: string;
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
 * Run log v2
 * ------------------------------------------------------------------ */

/**
 * `PASS`/`FAIL`/`ERROR` as before, plus `GAP` — the harness could not tell
 * whether the answer was right (a judge or result-set comparison failed to
 * complete), which is a harness problem, not a wrong answer, and must never
 * be silently counted as either. `SKIP` is an attempt the run never made.
 */
export type EvalVerdict = 'PASS' | 'FAIL' | 'ERROR' | 'GAP' | 'SKIP';

/** The failure class a non-PASS attempt was labelled with, for the trace and the worst-first tables. */
export type FailureLabel =
  | 'no-sql'
  | 'clarified'
  | 'missing-default-filter'
  | 'wrong-table'
  | 'missing-join'
  | 'id-not-name'
  | 'wrong-aggregate'
  | 'unit'
  | 'format-only'
  | 'wrong-filter'
  | 'judge'
  | 'tool-error'
  | 'timeout'
  | 'unknown';

export interface EvalCheckLog {
  id: string;
  passed: boolean;
  /** Why the check failed, when the scorer reports it. */
  reason?: string;
}

export interface EvalSqlLog {
  sql: string;
  ok: boolean;
  error?: string;
  rowCount?: number;
  /** True when this statement was produced by the SQL repair loop. */
  repaired?: boolean;
}

/** How an auto-repaired statement differs from the one the assistant wrote. */
export type SqlRepairKind = 'identifier' | 'syntax' | 'semantic' | 'unknown';

/** One `sql-fixer` repair, kept so a report can show what changed and why. */
export interface SqlRepairRecord {
  original: string;
  repaired: string;
  /** The engine error that triggered the repair. */
  error: string;
  kind: SqlRepairKind;
  /** Set when the repair changed filters, aggregates, joins or literals. */
  warning?: string;
}

/** The eight error classes the answer review checks (Omni's list, §9.7). */
export type AnswerReviewCode =
  | 'unsupported-claim'
  | 'date-filter'
  | 'truncated-as-complete'
  | 'prose-arithmetic'
  | 'comparison-window'
  | 'ignored-breakdown'
  | 'degenerate-query'
  | 'metric-or-filter-mismatch';

export interface AnswerReviewFinding {
  code: AnswerReviewCode;
  detail: string;
}

/**
 * The answer review's verdict, persisted on the message like `crossCheck`:
 * `ok` — nothing found; `revised` — findings, and the corrective pass
 * rewrote the answer; `flagged` — findings the corrective pass could not
 * address; `error` — the review could not complete (never loses the answer).
 */
export interface AnswerReview {
  status: 'ok' | 'revised' | 'flagged' | 'error';
  findings: AnswerReviewFinding[];
  /** Short line for the chip's tooltip. */
  note?: string;
}

/** The side passes a turn can make beyond the main agent run. */
export type SidePass =
  'grounding' | 'synthesis' | 'crossCheck' | 'review' | 'fixer';

/** One run of one case — a case with `repeat: 3` has three of these. */
export interface EvalRunLogAttempt {
  attempt: number;
  verdict: EvalVerdict;
  checks: EvalCheckLog[];
  /** The last successful `run_readonly_sql` statement this attempt used. */
  finalSql?: string;
  sql: EvalSqlLog[];
  /** The agent's final answer, truncated to 2000 characters. */
  answer?: string;
  steps: number;
  calledTools: string[];
  repairs: SqlRepairRecord[];
  warnings: string[];
  clarification?: string;
  crossCheck?: CrossCheck['status'];
  review?: AnswerReview['status'];
  failureLabel?: FailureLabel;
  /** True when the checked SQL was an earlier query, not the final one. */
  viaSupportingQuery?: boolean;
  /** Set on `ERROR`: what threw (turn exception, timeout). */
  error?: string;
  durationMs: number;
  usage?: TokenUsage;
}

/** One eval case, its attempts folded into a single pass^k verdict. */
export interface EvalRunLogCaseV2 {
  id: string;
  category?: string;
  /** The question as it was asked — suites change, the log must stay legible. */
  question?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  variantOf?: string;
  /** Pass^k folded: `PASS` only when every attempt passed. */
  verdict: EvalVerdict;
  runs: number;
  passes: number;
  /** `0 < passes < runs`. */
  flaky: boolean;
  failureLabel?: FailureLabel;
  reason?: string;
  durationMs: number;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
  attempts: EvalRunLogAttempt[];
}

/** Per-category or per-difficulty pass^k tally. */
export interface EvalRunTally {
  total: number;
  passK: number;
  /** Absent on the per-difficulty breakdown (category-only stat). */
  meanPassRate?: number;
}

/** The pass^k rollup a run log and the run card both render from. */
export interface EvalRunSummary {
  /** Cases that passed every attempt. */
  passK: number;
  /** `passK ÷ scored`. */
  passKRate: number;
  /** Cases the rates are over: all − GAP − SKIP. Absent on records written before it existed. */
  scored?: number;
  /** Mean of each case's own pass rate (`passes / runs`), unlike `passKRate`. */
  meanPassRate: number;
  /** Cases with `0 < passes < runs`. */
  flaky: number;
  /** Cases the harness could not verify (judge/result-set gap). */
  gaps: number;
  /** Cases that produced an answer on every attempt (not necessarily correct). */
  answeredEveryTime: number;
  /** Cases `answeredEveryTime` was judged over (those with recorded attempts). */
  answeredObserved?: number;
  /** Pass^k restricted to behavioural checks only, when tracked separately. */
  behaviourPassK?: number;
  /** Scored behaviour cases — the denominator of `behaviourPassK`. */
  behaviourTotal?: number;
  byCategory: Record<string, EvalRunTally>;
  byDifficulty: Record<string, EvalRunTally>;
  /** Absent unless every correct case's usage was measured and priced. */
  costPerCorrectUsd?: number;
  tokensPerCase?: number;
}

export type EvalHarness = 'in-app' | 'golden-set' | 'validate';

/**
 * One run-log file, schema v2 — written by every harness (in-app, CLI,
 * `--validate`) on every terminal state, success or failure, so the spend and
 * quality history is never silently incomplete.
 */
export interface EvalRunLogRecordV2 {
  schemaVersion: 2;
  runId: string;
  /** Operator-supplied tag, e.g. `baseline` or `iter-2-prompt-ratio`. */
  label?: string;
  harness: EvalHarness;
  suite: string;
  agentKey?: string;
  datasets: string[];
  datasourceKind?: 'postgres' | 'databricks';
  dialect?: string;
  /** The model that actually ran, as resolved at run time. */
  model?: string;
  reasoningEffort?: string;
  /** Router id the eval judge ran on, when pinned. */
  judgeModel?: string;
  repeat: number;
  /** The named arm (or `custom:{json}`) this run applied over production defaults. */
  arm?: string;
  engine: EngineOptions;
  configHash: string;
  /** The loop this run belongs to, when started via a loop run. */
  loopId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  appVersion?: string;
  gitCommit?: string;
  totals: {
    cases: number;
    passed: number;
    failed: number;
    errored: number;
    gaps: number;
    skipped: number;
  };
  summary: EvalRunSummary;
  /** `tallyCategories` output — GAP and SKIP verdicts are excluded from these tallies. */
  categories: Record<string, CategoryTally>;
  usage: TokenUsage;
  /** The side passes' share of `usage`, per pass. */
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  estimatedCostUsd?: number;
  /** True when a rate was missing, so the cost figure is a floor, not a total. */
  costIncomplete?: boolean;
  cases: EvalRunLogCaseV2[];
  /** Set when this run was compared against an earlier one. */
  comparedToRunId?: string;
  regressions?: string[];
  improvements?: string[];
  /** Cases whose flakiness changed relative to `comparedToRunId`. */
  flakyChanges?: string[];
  status: 'completed' | 'failed' | 'aborted';
  error?: string;
}

/**
 * One row of `GET /agents/:key/evals/logs` — the index line, not the full
 * record, so the history list can render without fetching every file.
 */
export interface RunLogSummary {
  runId: string;
  startedAt: string;
  suite: string;
  label?: string;
  harness: EvalHarness;
  model?: string;
  gitCommit?: string;
  cases: number;
  passed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  /** File name relative to `dir`, for `getRunLog`/`compareRunLogs`. */
  file: string;
  /** Which log directory this came from (repo `logs/`, `APP_DATA_DIR`, …). */
  dir: string;
  schemaVersion: 1 | 2;
  /** False when the index names a file that is no longer on disk. */
  exists: boolean;
  repeat?: number;
  arm?: string;
  configHash?: string;
  /** The loop this run belongs to, when started via a loop run. */
  loopId?: string;
  passK?: number;
  passKRate?: number;
  meanPassRate?: number;
  gaps?: number;
  flaky?: number;
  costPerCorrectUsd?: number;
  status?: 'completed' | 'failed' | 'aborted';
}

/**
 * Whether one check flipped between the two compared runs. `undefined` on
 * either side means the check was absent there (the case didn't run, or the
 * suite changed), not that it failed — never read a missing side as `false`.
 */
export interface RunLogCheckDelta {
  id: string;
  before?: boolean;
  after?: boolean;
}

/** One case's movement between two runs, for the compare table. */
export interface RunLogCaseDelta {
  id: string;
  category?: string;
  /** `SKIP` on a side the case did not run in (the suite changed). */
  before: EvalVerdict;
  after: EvalVerdict;
  passesBefore: number;
  passesAfter: number;
  runsBefore: number;
  runsAfter: number;
  flakyBefore: boolean;
  flakyAfter: boolean;
  /** Final SQL of each side's representative attempt (first non-PASS, else first). */
  sqlBefore?: string;
  sqlAfter?: string;
  /** Checks whose outcome changed. */
  checkDeltas: RunLogCheckDelta[];
  /** after − before total tokens, when both sides observed usage. */
  tokensDelta?: number;
}

/** Enough about one side of a comparison to title it. */
export interface RunLogDiffSide {
  runId: string;
  label?: string;
  suite: string;
  arm?: string;
  model?: string;
  reasoningEffort?: string;
  configHash: string;
  repeat: number;
  startedAt: string;
}

/** `GET /agents/:key/evals/logs/compare?a=&b=` — the diff between two runs. */
export interface RunLogDiff {
  runBefore: RunLogDiffSide;
  runAfter: RunLogDiffSide;
  perCase: RunLogCaseDelta[];
  /** Case ids that passed on `a` and fail on `b`. */
  regressions: string[];
  /** Case ids that failed on `a` and pass on `b`. */
  improvements: string[];
  /** Case ids whose flaky status changed. */
  flakyChanges: string[];
  /** Case ids present on the before run only (the suite changed). */
  onlyBefore: string[];
  /** Case ids present on the after run only. */
  onlyAfter: string[];
  summaryBefore: EvalRunSummary;
  summaryAfter: EvalRunSummary;
  /** pass^k rate per category (0..1), with the counts behind it. */
  categoryDeltas: Record<
    string,
    {
      before: number;
      after: number;
      passKBefore: number;
      passKAfter: number;
      totalBefore: number;
      totalAfter: number;
    }
  >;
  /** after − before total tokens. */
  tokensDelta: number;
  /** False when either side reported no usage: the delta is then not a saving. */
  tokensComparable: boolean;
  costDelta?: number;
  /** False when the two runs used different models — the compare is apples-to-oranges. */
  sameModel: boolean;
  /** False when the two runs used a different engine config hash. */
  sameConfig: boolean;
  /** False when the two runs scored different suites. */
  sameSuite: boolean;
}

/** One point on the pass^k-over-time chart. */
export interface TrendPoint {
  runId: string;
  file: string;
  startedAt: string;
  label?: string;
  arm?: string;
  model?: string;
  passKRate: number;
  meanPassRate: number;
  gaps: number;
  flaky: number;
  costUsd?: number;
}

export type LoopStatus = 'running' | 'completed' | 'failed';

/** One row of a loop's summary matrix (suite × arm). */
export interface EvalLoopSummaryRow {
  suite: string;
  arm?: string;
  model?: string;
  passKRate: number;
  meanPassRate: number;
  flaky: number;
  gaps: number;
  tokens: number;
  costUsd?: number;
  costPerCorrectUsd?: number;
  /** Absent until that job has written its run log. */
  file?: string;
}

/** `GET /agents/:key/evals/loops/:loopId` — every job the loop queued, plus its matrix. */
export interface EvalLoopView {
  loopId: string;
  status: LoopStatus;
  jobs: EvalRunView[];
  summary: { rows: EvalLoopSummaryRow[] };
}

/** `1 | 3 | 5` — the repeat counts the UI offers; pass^k only means something at these. */
export type EvalRepeat = 1 | 3 | 5;

/** `POST /agents/:key/evals/run` body. */
export interface EvalRunRequest {
  datasourceId: string;
  caseIds?: string[];
  suiteId?: string;
  datasets?: string[];
  repeat?: EvalRepeat;
  label?: string;
  /** A named arm preset, or `custom:{json}`. */
  arm?: string;
  engine?: Partial<EngineOptions>;
  includeVariants?: boolean;
}

/** `POST /agents/:key/evals/loop` body — queues one run per suite × arm. */
export interface EvalLoopRequest {
  datasourceId: string;
  suiteIds: string[];
  repeat: EvalRepeat;
  /** Preset names or `custom:{json}` entries — one run is queued per arm per suite. */
  arms: string[];
  label: string;
  includeVariants?: boolean;
  categories?: string[];
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

/* ------------------------------------------------------------------ *
 * Run log v2 — pure helpers
 * ------------------------------------------------------------------ */

/**
 * Tailwind text colour for a verdict badge, consistent with
 * {@link categoryRateClass}'s green/amber/red reading. `GAP` and `SKIP` are
 * neither a pass nor a fail — the harness didn't get an answer either way —
 * so they render neutral grey rather than red, which would misreport a
 * harness problem as a wrong answer.
 */
export function verdictClass(verdict: EvalVerdict): string {
  switch (verdict) {
    case 'PASS':
      return 'text-emerald-400';
    case 'FAIL':
      return 'text-red-400';
    case 'ERROR':
      return 'text-rose-500';
    case 'GAP':
    case 'SKIP':
      return 'text-slate-400';
  }
}

/**
 * A result's verdict, for results recorded before `verdict` existed: prefer
 * the explicit v2 field, else derive PASS/FAIL/ERROR from the legacy
 * `passed`/`error` fields the same way the old run card always read them.
 */
export function verdictOf(
  result: Pick<AgentEvalCaseResult, 'verdict' | 'passed' | 'error'>,
): EvalVerdict {
  if (result.verdict) return result.verdict;
  if (result.error) return 'ERROR';
  return result.passed ? 'PASS' : 'FAIL';
}

/** Every case the summary tallied, however it broke them down. */
function totalCasesIn(summary: EvalRunSummary): number {
  const fromCategory = Object.values(summary.byCategory).reduce(
    (sum, tally) => sum + tally.total,
    0,
  );
  if (fromCategory > 0) return fromCategory;
  return Object.values(summary.byDifficulty).reduce(
    (sum, tally) => sum + tally.total,
    0,
  );
}

/**
 * `"12/19 pass^3 · 63%"` — cases that passed every attempt, over cases the
 * harness could actually verify (GAPs excluded from the denominator: a GAP
 * is a harness problem, not a fail, so it must not drag the rate down), the
 * repeat count as the exponent, and the rate rounded the same way
 * {@link formatRate} does. A gap count is appended only when there were any.
 */
export function formatPassK(summary: EvalRunSummary, repeat: number): string {
  // The backend reports its own denominator (`scored`); older records do not,
  // so fall back to deriving it from the per-category tallies.
  const denominator =
    summary.scored ?? Math.max(0, totalCasesIn(summary) - summary.gaps);
  const rate = Math.round(summary.passKRate * 100);
  const base = `${summary.passK}/${denominator} pass^${repeat} · ${rate}%`;
  if (summary.gaps <= 0) return base;
  return `${base} · ${summary.gaps} gap${summary.gaps === 1 ? '' : 's'}`;
}

/** `$0.0421 per correct answer` — four decimals, since these are usually sub-dime. */
function usdPerCorrect(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export const NO_CORRECT_ANSWERS_LABEL = 'no correct answers';

/**
 * The honest cost-per-correct-answer line, following the same three-state
 * rule as {@link evalCostState} plus one more: a priced run with zero
 * cases passing every attempt has nothing to divide by, so it reports "no
 * correct answers" rather than `$Infinity` or a silent `$0.00`.
 */
export function costPerCorrectLabel(
  summary: EvalRunSummary,
  usage: TokenUsage | undefined,
): string {
  if (!isUsageMeasured(usage)) return NOT_MEASURED_LABEL;
  if (summary.passK <= 0) return NO_CORRECT_ANSWERS_LABEL;
  if (
    summary.costPerCorrectUsd === undefined ||
    summary.costPerCorrectUsd === null
  )
    return NOT_PRICED_LABEL;
  return `${usdPerCorrect(summary.costPerCorrectUsd)} per correct answer`;
}

/** The arm label to render: `baseline` when the run applied no named arm. */
export function armLabel(arm?: string): string {
  const trimmed = arm?.trim();
  return trimmed ? trimmed : 'baseline';
}

/** How a run was started, for the History table's harness badge. */
export function harnessLabel(harness: EvalHarness | undefined): string {
  switch (harness) {
    case 'in-app':
      return 'In-app';
    case 'golden-set':
      return 'CLI';
    case 'validate':
      return 'Validate';
    default:
      return 'Unknown';
  }
}

/* ------------------------------------------------------------------ *
 * History row helpers — `RunLogSummary` carries only the index line's
 * fields (no full `TokenUsage`, no `EvalRunSummary`), so the History table
 * gets its own small, honest formatters rather than coercing the row into
 * the richer shapes above.
 * ------------------------------------------------------------------ */

/**
 * `"12/19 pass^3 · 63% · 1 gap"` for one History row. `RunLogSummary`'s
 * pass^k fields are typed optional (a hand-edited or pre-v2 index line could
 * omit them), but the backend always fills them in for a listed run
 * (`summaryFromLine`); this degrades the same way {@link formatPassK} does
 * rather than assuming they are there.
 */
export function logSummaryPassKLabel(
  log: Pick<RunLogSummary, 'passK' | 'passKRate' | 'cases' | 'repeat' | 'gaps'>,
): string {
  const total = log.cases ?? 0;
  const passK = log.passK ?? 0;
  const rate = Math.round((log.passKRate ?? 0) * 100);
  const repeat = log.repeat ?? 1;
  const gaps = log.gaps ?? 0;
  const base = `${passK}/${total} pass^${repeat} · ${rate}%`;
  return gaps > 0 ? `${base} · ${gaps} gap${gaps === 1 ? '' : 's'}` : base;
}

/**
 * The History row's cost line, following {@link evalCostState}'s three
 * honest states. A row only carries token sums, not a full `TokenUsage`
 * with `calls` — a positive `totalTokens` is itself proof the provider
 * reported something, so `calls` is set to 1 as the "measured" signal.
 */
export function logSummaryCostLabel(
  log: Pick<RunLogSummary, 'totalTokens' | 'estimatedCostUsd'>,
): string {
  const usage: TokenUsage | undefined =
    log.totalTokens > 0
      ? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: log.totalTokens,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          calls: 1,
        }
      : undefined;
  return evalCostState(usage, log.estimatedCostUsd).label;
}

/* ------------------------------------------------------------------ *
 * History → trace panel adapter
 * ------------------------------------------------------------------ */

/**
 * The attempt a single-row view shows for a case: the first one that did not
 * pass (that draw is the one worth reading), else the first. Mirrors the
 * backend's `representativeAttempt` (`eval-telemetry.ts`).
 */
export function representativeLogAttempt(
  item: Pick<EvalRunLogCaseV2, 'attempts'>,
): EvalRunLogAttempt | undefined {
  const attempts = item.attempts ?? [];
  return attempts.find((attempt) => attempt.verdict !== 'PASS') ?? attempts[0];
}

/**
 * A logged case as an `AgentEvalCase`, good enough to open in the existing
 * trace panel (`eval-trace`) via `EvalSelectionService` — the panel only
 * reads `id`, `category`, `question` and `checks` off it.
 */
export function logCaseToEvalCase(item: EvalRunLogCaseV2): AgentEvalCase {
  const attempt = representativeLogAttempt(item);
  return {
    id: item.id,
    category: item.category ?? 'uncategorised',
    question: item.question ?? item.id,
    intent: '',
    checks: (attempt?.checks ?? []).map((check) => ({
      id: check.id,
      name: check.id,
      description: check.id,
    })),
    ...(item.difficulty ? { difficulty: item.difficulty } : {}),
    ...(item.variantOf ? { variantOf: item.variantOf } : {}),
  };
}

/**
 * Adapts one run-log case (History) into the shape the trace panel already
 * renders (`AgentEvalCaseResult`) — built from the case's representative
 * attempt. Two fields are necessarily approximate, since the log keeps only
 * a status, not the full record: `crossCheck`/`review` carry their status
 * with no `note`/`findings` (the log clips those out to stay small).
 */
export function logCaseToResult(item: EvalRunLogCaseV2): AgentEvalCaseResult {
  const attempt = representativeLogAttempt(item);
  const checkResults: EvalCheckResult[] = (attempt?.checks ?? []).map(
    (check) => ({
      id: check.id,
      description: check.id,
      score: check.passed ? 1 : 0,
      passed: check.passed,
      ...(check.reason ? { reason: check.reason } : {}),
    }),
  );
  const toolCalls: EvalToolCall[] = (attempt?.calledTools ?? []).map(
    (name) => ({ name }),
  );
  return {
    id: item.id,
    question: item.question ?? item.id,
    category: item.category,
    scores: Object.fromEntries(
      checkResults.map((check) => [check.id, check.score]),
    ),
    checkResults,
    answer: attempt?.answer ?? '',
    toolCalls,
    passed: item.verdict === 'PASS',
    ...(attempt?.error ? { error: attempt.error } : {}),
    durationMs: item.durationMs,
    ...(item.usage ? { usage: item.usage } : {}),
    verdict: item.verdict,
    runs: item.runs,
    passes: item.passes,
    flaky: item.flaky,
    ...(item.failureLabel ? { failureLabel: item.failureLabel } : {}),
    ...(item.difficulty ? { difficulty: item.difficulty } : {}),
    ...(item.variantOf ? { variantOf: item.variantOf } : {}),
    ...(attempt?.finalSql ? { finalSql: attempt.finalSql } : {}),
    ...(attempt?.repairs?.length ? { repairs: attempt.repairs } : {}),
    ...(attempt?.warnings?.length ? { warnings: attempt.warnings } : {}),
    ...(attempt?.crossCheck
      ? { crossCheck: { status: attempt.crossCheck } }
      : {}),
    ...(attempt?.review
      ? { review: { status: attempt.review, findings: [] } }
      : {}),
    attempts: item.attempts ?? [],
  };
}

/* ------------------------------------------------------------------ *
 * Trend chart
 * ------------------------------------------------------------------ */

/** One point of a trend series, as `EvalTrendChart` plots it. */
export type TrendSeriesPoint = TrendPoint;

/** One coloured line of the trend chart: a key (arm or model name) and its points, oldest first. */
export interface TrendSeries {
  key: string;
  points: TrendSeriesPoint[];
}

/**
 * Groups trend points into one series per arm (or per model), each sorted
 * chronologically — what `EvalTrendChart` draws one line per. An absent or
 * blank arm groups under {@link armLabel}'s `baseline`; an absent model
 * groups under `unknown` so a point is never silently dropped.
 */
export function trendSeries(
  points: readonly TrendPoint[],
  groupBy: 'arm' | 'model' = 'arm',
): TrendSeries[] {
  const groups = new Map<string, TrendSeriesPoint[]>();
  for (const point of points) {
    const key =
      groupBy === 'arm'
        ? armLabel(point.arm)
        : (point.model?.trim() ?? '') || 'unknown';
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      points: [...list].sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------------ *
 * Compare
 * ------------------------------------------------------------------ */

/** Every case count a summary was scored over: `scored`, falling back to the per-category tallies. */
function scoredCount(summary: EvalRunSummary): number {
  return summary.scored ?? Math.max(0, totalCasesIn(summary) - summary.gaps);
}

/**
 * `"12/19 pass^3 (63%) → 15/19 pass^3 (79%) · 4 improvements, 1 regression"` —
 * the one-line summary of a run-to-run comparison, for the Compare view's
 * header and the change-log draft's title.
 */
export function diffHeadline(diff: RunLogDiff): string {
  const { summaryBefore: before, summaryAfter: after } = diff;
  const beforeText = `${before.passK}/${scoredCount(before)} pass^${diff.runBefore.repeat} (${formatRate(before.passKRate)})`;
  const afterText = `${after.passK}/${scoredCount(after)} pass^${diff.runAfter.repeat} (${formatRate(after.passKRate)})`;
  const parts = [`${beforeText} → ${afterText}`];
  const improvements = diff.improvements.length;
  const regressions = diff.regressions.length;
  if (improvements > 0 || regressions > 0) {
    parts.push(
      `${improvements} improvement${improvements === 1 ? '' : 's'}, ${regressions} regression${regressions === 1 ? '' : 's'}`,
    );
  }
  return parts.join(' · ');
}

/**
 * Why two runs are not like-for-like — mirrors the backend's
 * `comparabilityNotes` (`eval-diff.ts`) so the Compare view's warning banner
 * reads the same reasons the change-log draft states.
 */
export function diffNotComparableReasons(diff: RunLogDiff): string[] {
  const reasons: string[] = [];
  if (!diff.sameSuite) {
    reasons.push(
      `different suites (${diff.runBefore.suite} vs ${diff.runAfter.suite})`,
    );
  }
  if (!diff.sameModel) {
    reasons.push(
      `different models (${diff.runBefore.model ?? 'unknown'} vs ${diff.runAfter.model ?? 'unknown'})`,
    );
  }
  if (!diff.sameConfig) {
    reasons.push(
      `different engine configs (${diff.runBefore.configHash} vs ${diff.runAfter.configHash})`,
    );
  }
  if (diff.runBefore.repeat !== diff.runAfter.repeat) {
    reasons.push(
      `different repeat (pass^${diff.runBefore.repeat} vs pass^${diff.runAfter.repeat})`,
    );
  }
  return reasons;
}

/** Categories ordered worst after-rate first, then biggest move — mirrors the backend's `orderedCategories`. */
export function orderedCategoryDeltas(
  diff: Pick<RunLogDiff, 'categoryDeltas'>,
): string[] {
  return Object.keys(diff.categoryDeltas).sort((x, y) => {
    const a = diff.categoryDeltas[x];
    const b = diff.categoryDeltas[y];
    return (
      a.after - b.after ||
      Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
      x.localeCompare(y)
    );
  });
}

/** Cases whose verdict or pass count moved between the two runs — the "Verdict changes" list. */
export function diffFlips(diff: Pick<RunLogDiff, 'perCase'>): RunLogCaseDelta[] {
  return diff.perCase.filter(
    (row) => row.before !== row.after || row.passesBefore !== row.passesAfter,
  );
}
