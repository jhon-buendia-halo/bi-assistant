/**
 * Token accounting for eval runs — the shared contract between the in-app
 * runner (`eval-runs.service.ts`), the CLI harness (`scripts/run-eval.ts`) and
 * the run log written into the repo's `logs/` folder.
 *
 * Two deliberate rules:
 *
 * 1. **Token counts are measured, costs are estimated.** Counts come straight
 *    off the provider's `usage` object and are exact. Money is counts × a rate
 *    this repo cannot know authoritatively, so rates live in an editable file
 *    (`logs/pricing.json`) the operator owns, and an unknown model yields
 *    `undefined` rather than a confident wrong number.
 * 2. **Missing usage is not zero usage.** A provider that reports nothing back
 *    leaves `calls` at 0, so a run log can distinguish "this cost nothing" from
 *    "we could not see what this cost".
 *
 * Pure module: no Nest, no I/O, no model calls — so both the CLI (ts-node) and
 * the Nest app can import it, and it unit-tests without a database.
 */
import {
  resolveEngineOptions,
  type EngineOptions,
} from '../engine/engine-options';
import type {
  AnswerReview,
  SidePass,
  SqlRepairRecord,
} from '../sessions/turn-result';
import type { CrossCheck } from '../sessions/entities/session.entity';

/** Token counts for one or more model calls. */
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

export const EMPTY_USAGE: Readonly<TokenUsage> = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  calls: 0,
});

export function emptyUsage(): TokenUsage {
  return { ...EMPTY_USAGE };
}

/** True when nothing was observed — distinct from a genuinely free call. */
export function isUsageUnobserved(usage: TokenUsage | undefined): boolean {
  return !usage || usage.calls === 0;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    calls: a.calls + b.calls,
  };
}

export function sumUsage(
  items: readonly (TokenUsage | undefined)[],
): TokenUsage {
  return items.reduce<TokenUsage>(
    (total, usage) => (usage ? addUsage(total, usage) : total),
    emptyUsage(),
  );
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Pull token counts off one model result.
 *
 * The AI SDK has moved these fields twice (`promptTokens`/`completionTokens` →
 * `inputTokens`/`outputTokens`, and `usage` → `totalUsage` on multi-step
 * results), and Mastra wraps the result again. Every shape is read
 * defensively and the first one that carries numbers wins; an unrecognised
 * shape returns `undefined` so the caller records "not observed" rather than
 * a silent zero.
 */
export function extractUsage(result: unknown): TokenUsage | undefined {
  const source = result as Record<string, any> | null | undefined;
  if (!source || typeof source !== 'object') return undefined;

  // `totalUsage` already spans every step of a multi-step agent run; prefer it
  // over `usage`, which on some versions reports only the final step.
  const raw =
    pickUsageObject(source.totalUsage) ??
    pickUsageObject(source.usage) ??
    pickUsageObject(source.response?.usage) ??
    pickUsageObject(source.result?.usage);
  if (!raw) return undefined;

  const inputTokens = count(
    raw.inputTokens ?? raw.promptTokens ?? raw.input_tokens,
  );
  const outputTokens = count(
    raw.outputTokens ?? raw.completionTokens ?? raw.output_tokens,
  );
  const reported = count(raw.totalTokens ?? raw.total_tokens);
  const reasoningTokens = count(raw.reasoningTokens ?? raw.reasoning_tokens);
  const cachedInputTokens = count(
    raw.cachedInputTokens ??
      raw.cachedPromptTokens ??
      raw.cached_input_tokens ??
      raw.promptTokensDetails?.cachedTokens,
  );

  if (!inputTokens && !outputTokens && !reported) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: reported || inputTokens + outputTokens,
    reasoningTokens,
    cachedInputTokens,
    calls: 1,
  };
}

function pickUsageObject(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : undefined;
}

/**
 * Sum usage across every step of an agent result, for providers that report
 * per-step usage but no roll-up. Falls back to the top-level reading.
 */
export function extractUsageDeep(result: unknown): TokenUsage | undefined {
  const top = extractUsage(result);
  if (top) return top;
  const steps = (result as { steps?: unknown[] } | undefined)?.steps;
  if (!Array.isArray(steps)) return undefined;
  const perStep = steps.map((step) => extractUsage(step)).filter(Boolean);
  return perStep.length ? sumUsage(perStep) : undefined;
}

/* ------------------------------------------------------------- pricing */

/** Rates in US dollars per million tokens, as the operator maintains them. */
export interface ModelRate {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  /** Rate for cached input tokens, when the provider discounts them. */
  cachedInputPerMillionUsd?: number;
}

export type PricingTable = Record<string, ModelRate>;

/**
 * Rates ship empty on purpose. This repo cannot know what the operator's
 * provider (OpenAI directly, or a LenAI gateway with negotiated rates) charges
 * today, and a stale hard-coded number would be reported as fact in a cost
 * log. `logs/pricing.json` is where real rates go; until it has an entry for
 * the model that ran, cost is reported as unknown and token counts — which are
 * exact — carry the report.
 */
export const DEFAULT_PRICING: PricingTable = {};

/** Normalise `openai/gpt-4o-mini`, `azure/gpt-4o-mini` and `gpt-4o-mini` alike. */
export function normalizeModelId(model: string): string {
  const trimmed = (model ?? '').trim().toLowerCase();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Cost in US dollars, or `undefined` when no rate is configured for the model.
 * Cached input tokens are billed at the cached rate when one is given and are
 * assumed to be a subset of `inputTokens`, matching how providers report them.
 */
export function estimateCostUsd(
  model: string | undefined,
  usage: TokenUsage | undefined,
  pricing: PricingTable,
): number | undefined {
  if (!model || !usage || usage.calls === 0) return undefined;
  const key = normalizeModelId(model);
  const rate = pricing[key] ?? pricing[model] ?? pricing[model?.toLowerCase()];
  if (!rate) return undefined;

  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const fullPriceInput = usage.inputTokens - cached;
  const cachedRate = rate.cachedInputPerMillionUsd ?? rate.inputPerMillionUsd;
  const dollars =
    (fullPriceInput * rate.inputPerMillionUsd +
      cached * cachedRate +
      usage.outputTokens * rate.outputPerMillionUsd) /
    1_000_000;
  // Six decimals: a single cheap case can cost well under a cent, and rounding
  // those to zero would make a 40-case run look free.
  return Number(dollars.toFixed(6));
}

/* ----------------------------------------------------------- run log */

export type EvalHarness = 'in-app' | 'golden-set' | 'validate';

/**
 * A case's outcome. `GAP` is the harness admitting it could not measure the
 * case (the reference query failed, the judge errored twice) — neither a pass
 * nor a fail, so it is left out of every rate rather than counted as either.
 * `SKIP` is a case that never ran.
 */
export type EvalVerdict = 'PASS' | 'FAIL' | 'ERROR' | 'GAP' | 'SKIP';

/**
 * Why a case failed, in the vocabulary the improvement loop pulls levers by
 * (`failure-labels.ts` assigns them). A failure class says which lever to
 * reach for; a bare FAIL does not.
 */
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

/** Per-category tally, the unit the improvement loop is steered by. */
export interface CategoryTally {
  total: number;
  passed: number;
}

/** One v1 case. Kept as the name the v1 writers already use. */
export interface EvalRunLogCase {
  id: string;
  category?: string;
  verdict: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';
  /** Short qualifier: `result-mismatch`, `no-sql`, `timeout`, … */
  reason?: string;
  durationMs: number;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
  /** CLI `--repeat` only: how many repetitions ran, and how many passed. */
  runs?: number;
  passes?: number;
}

/**
 * The v1 record, as every run up to 2026-09-22 was written — one verdict per
 * case, no attempts, no engine. Still accepted by `writeRunLog` so the
 * existing writers keep compiling; readers see it through `normalizeRunLog`.
 */
export interface EvalRunLogRecordV1 {
  schemaVersion: 1;
  runId: string;
  /** Operator-supplied tag, e.g. `baseline` or `iter-2-prompt-ratio`. */
  label?: string;
  harness: EvalHarness;
  suite: string;
  agentKey?: string;
  datasets: string[];
  /** The model that actually ran, as resolved at run time. */
  model?: string;
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
    skipped: number;
  };
  categories: Record<string, CategoryTally>;
  usage: TokenUsage;
  estimatedCostUsd?: number;
  /** True when a rate was missing, so the cost figure is a floor, not a total. */
  costIncomplete?: boolean;
  cases: EvalRunLogCase[];
  /** Set when this run was compared against an earlier one. */
  comparedToRunId?: string;
  regressions?: string[];
  improvements?: string[];
}

/** One check's verdict on one attempt. */
export interface EvalCheckLog {
  id: string;
  passed: boolean;
  reason?: string;
  /** The check could not be measured (not the same as failed) — see `GAP`. */
  gap?: boolean;
  /**
   * Result-set check only, on a case with `expectedSqlAlternatives`: the
   * reference that matched (0 = `expectedSql`, n = alternative n - 1). See
   * `ResultSetCheckResult.matchedReference`.
   */
  matchedReference?: number;
}

/** One SQL statement the turn ran, without its rows (logs never carry data). */
export interface EvalSqlLog {
  sql: string;
  ok: boolean;
  error?: string;
  rowCount?: number;
  /** The `sql-fixer` rewrote this statement before it succeeded. */
  repaired?: boolean;
}

/** Longest answer text an attempt keeps — enough to read, not a transcript. */
export const LOG_ANSWER_MAX_CHARS = 2000;

/** Clip free text for a log field, marking that it was clipped. */
export function clipLogText(
  text: string | undefined,
  max = LOG_ANSWER_MAX_CHARS,
): string | undefined {
  if (text === undefined) return undefined;
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

/**
 * One run of one case. With `repeat: 3` a case has three of these, and the
 * case verdict is their pass^k fold (`foldAttempts`) — the per-attempt record
 * is what lets a report show *which* draw failed and what SQL it ran.
 */
export interface EvalRunLogAttempt {
  /** 1-based. */
  attempt: number;
  verdict: EvalVerdict;
  checks: EvalCheckLog[];
  /** The last successful `run_readonly_sql` — the SQL the answer used. */
  finalSql?: string;
  sql: EvalSqlLog[];
  /** The final answer text, at most `LOG_ANSWER_MAX_CHARS` (`clipLogText`). */
  answer?: string;
  steps: number;
  calledTools: string[];
  repairs: SqlRepairRecord[];
  warnings: string[];
  /** The clarifying question, when the turn asked one instead of answering. */
  clarification?: string;
  crossCheck?: CrossCheck['status'];
  review?: AnswerReview['status'];
  failureLabel?: FailureLabel;
  /** The result set matched on an earlier query, not the final one. */
  viaSupportingQuery?: boolean;
  /** Set on `ERROR`: what threw (turn exception, timeout). */
  error?: string;
  durationMs: number;
  usage?: TokenUsage;
}

export type EvalDifficulty = 'easy' | 'medium' | 'hard';

/** One case of a v2 run: the pass^k fold plus every attempt behind it. */
export interface EvalRunLogCaseV2 {
  id: string;
  category?: string;
  /** The question as it was asked — suites change, the log must stay legible. */
  question?: string;
  difficulty?: EvalDifficulty;
  /** Set on a paraphrase variant (`<id>~v1`): the case it rephrases. */
  variantOf?: string;
  /** pass^k: PASS only when every attempt passed (`foldAttempts`). */
  verdict: EvalVerdict;
  runs: number;
  passes: number;
  /** Passed some attempts and failed others. */
  flaky: boolean;
  failureLabel?: FailureLabel;
  reason?: string;
  durationMs: number;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
  attempts: EvalRunLogAttempt[];
}

/**
 * The headline numbers of a run. Every rate is over *scored* cases — all of
 * them minus GAP and SKIP — because a case the harness could not measure is
 * not evidence either way.
 */
export interface EvalRunSummary {
  /** Cases that passed every attempt. */
  passK: number;
  /** `passK ÷ scored`; 0 when nothing was scored. */
  passKRate: number;
  /** Cases the rates are over: all − GAP − SKIP. */
  scored: number;
  /** Σ passes ÷ Σ runs over scored cases — the forgiving, per-draw rate. */
  meanPassRate: number;
  /** Cases with 0 < passes < runs. */
  flaky: number;
  gaps: number;
  /**
   * Cases where every attempt produced something for the user: non-empty
   * answer text or a clarifying question. A case with no recorded attempts
   * (a v1 log, a SKIP) is not counted — unobserved, not unanswered.
   */
  answeredEveryTime: number;
  /** Cases `answeredEveryTime` was judged over (those with attempts). */
  answeredObserved: number;
  /**
   * pass^k over the behaviour categories (`BEHAVIOUR_CATEGORIES`): the cases
   * where the right answer is a clarification, a refusal or a schema tour
   * rather than a number. Absent when the run scored none.
   */
  behaviourPassK?: number;
  /** Scored cases in the behaviour categories; the denominator of `behaviourPassK`. */
  behaviourTotal?: number;
  byCategory: Record<
    string,
    { total: number; passK: number; meanPassRate: number }
  >;
  /** Cases without a difficulty land under `unrated`. */
  byDifficulty: Record<string, { total: number; passK: number }>;
  /** Estimated run cost ÷ passK, when both are known and non-zero. */
  costPerCorrectUsd?: number;
  /** Mean total tokens over the cases whose usage was observed. */
  tokensPerCase?: number;
}

export type EvalRunStatus = 'completed' | 'failed' | 'aborted';

/**
 * One run, schema v2: what ran (engine, arm, model, judge, repeat), what it
 * scored (pass^k summary, per-case folds) and why each case landed where it
 * did (attempts with SQL, checks, repairs, warnings). Written on every
 * terminal state — a failed or aborted run still spent money.
 */
export interface EvalRunLogRecordV2 {
  schemaVersion: 2;
  runId: string;
  label?: string;
  harness: EvalHarness;
  suite: string;
  agentKey?: string;
  datasets: string[];
  datasourceKind?: 'postgres' | 'databricks' | 'rest';
  /** SQL dialect the reference queries were chosen for (`referenceSqlFor`). */
  dialect?: string;
  model?: string;
  reasoningEffort?: string;
  /** The judge's router id when pinned; absent = the assistant's model. */
  judgeModel?: string;
  /** Attempts per case. */
  repeat: number;
  /** Arm preset name (`ARM_PRESETS`) or `custom:{…}`. */
  arm?: string;
  /** The levers the run actually used, resolved. */
  engine: EngineOptions;
  /** `engineConfigHash(engine, { model, reasoningEffort, … })`; `legacy` on v1 logs. */
  configHash: string;
  /** Set when the run was one cell of a Loop run. */
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
  categories: Record<string, CategoryTally>;
  usage: TokenUsage;
  /** The side passes' share of `usage`, when the harness measured them. */
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  estimatedCostUsd?: number;
  costIncomplete?: boolean;
  cases: EvalRunLogCaseV2[];
  comparedToRunId?: string;
  regressions?: string[];
  improvements?: string[];
  /** Cases whose flakiness changed relative to `comparedToRunId`. */
  flakyChanges?: string[];
  status: EvalRunStatus;
  /** Why the run failed or was aborted. */
  error?: string;
}

/**
 * One line of the spending and quality history, written to
 * `logs/evals/<date>-<suite>-<label>.json` by every harness that spends
 * tokens. Versioned so the shape can change without orphaning old runs:
 * writers produce either version, readers go through `normalizeRunLog`.
 */
export type EvalRunLogRecord = EvalRunLogRecordV1 | EvalRunLogRecordV2;

export function isRunLogV2(
  record: EvalRunLogRecord,
): record is EvalRunLogRecordV2 {
  return (record as { schemaVersion?: unknown }).schemaVersion === 2;
}

/**
 * Categories where the right answer is a behaviour (ask, decline, describe)
 * rather than a figure. Reported apart because a result-set check cannot
 * grade them and a model swap tends to move them independently.
 */
export const BEHAVIOUR_CATEGORIES: ReadonlySet<string> = new Set([
  'clarification',
  'out-of-scope',
  'discovery',
]);

/** Per-category tallies from case-level verdicts. GAP and SKIP are not counted. */
export function tallyCategories(
  cases: readonly { category?: string; verdict: EvalVerdict }[],
): Record<string, CategoryTally> {
  const tally: Record<string, CategoryTally> = {};
  for (const item of cases) {
    if (item.verdict === 'SKIP' || item.verdict === 'GAP') continue;
    const key = item.category ?? 'uncategorised';
    const entry = (tally[key] ??= { total: 0, passed: 0 });
    entry.total += 1;
    if (item.verdict === 'PASS') entry.passed += 1;
  }
  return tally;
}

/* --------------------------------------------------------------- pass^k */

/**
 * Fold k attempts of one case into one verdict — pass^k, not pass@k: a case
 * passes only when every attempt passed, because an answer that is right two
 * times in three is wrong one time in three for the user who asks it.
 *
 * Precedence: no attempts (or only SKIPs) → SKIP; every attempt GAP → GAP;
 * any ERROR and no PASS → ERROR; every attempt PASS → PASS; otherwise FAIL.
 * A GAP attempt next to real ones counts as not-PASS: the run could not
 * confirm that draw, so it cannot claim the case. SKIP attempts (a repeat cut
 * short by an abort) are left out of `runs`.
 *
 * `failureLabel` comes from the first non-PASS attempt that carries one.
 */
/** `EvalRunLogAttempt.error` of an attempt the operator stopped (the harness's `EVAL_STOPPED_ERROR`). */
export const STOPPED_ATTEMPT_ERROR = 'stopped';

function isStoppedAttempt(attempt: EvalRunLogAttempt): boolean {
  return attempt.verdict === 'ERROR' && attempt.error === STOPPED_ATTEMPT_ERROR;
}

export function foldAttempts(
  attempts: readonly EvalRunLogAttempt[],
): Pick<
  EvalRunLogCaseV2,
  'verdict' | 'runs' | 'passes' | 'flaky' | 'failureLabel'
> {
  // pass^k needs k *measured* draws. An attempt the harness could not
  // measure (GAP) is no evidence about the engine, and one cut off by Stop
  // never finished — so neither may count against the case ([PASS, GAP, PASS]
  // is not a flaky FAIL), and neither can stand in for a pass: when every
  // measured draw passed but one was a GAP the case is GAP (not established,
  // excluded from the rate), and when the run was stopped before the case
  // finished it is SKIP. A measured failure is real evidence either way.
  const stopped = attempts.some(isStoppedAttempt);
  const ran = attempts.filter(
    (attempt) => attempt.verdict !== 'SKIP' && !isStoppedAttempt(attempt),
  );
  const measured = ran.filter((attempt) => attempt.verdict !== 'GAP');
  const runs = measured.length;
  const passes = measured.filter(
    (attempt) => attempt.verdict === 'PASS',
  ).length;
  let verdict: EvalVerdict;
  if (ran.length === 0) verdict = 'SKIP';
  else if (runs === 0) verdict = 'GAP';
  else if (
    passes === 0 &&
    measured.some((attempt) => attempt.verdict === 'ERROR')
  ) {
    verdict = 'ERROR';
  } else if (passes < runs) verdict = 'FAIL';
  else if (runs < ran.length) verdict = 'GAP';
  else if (stopped) verdict = 'SKIP';
  else verdict = 'PASS';
  const failureLabel = measured.find(
    (attempt) => attempt.verdict !== 'PASS' && attempt.failureLabel,
  )?.failureLabel;
  return {
    verdict,
    runs,
    passes,
    flaky: passes > 0 && passes < runs,
    ...(failureLabel && verdict !== 'PASS' ? { failureLabel } : {}),
  };
}

/**
 * The attempt a single-row view shows for a case: the first one that did not
 * pass (that is the draw worth reading), else the first.
 */
export function representativeAttempt(
  attempts: readonly EvalRunLogAttempt[],
): EvalRunLogAttempt | undefined {
  return attempts.find((attempt) => attempt.verdict !== 'PASS') ?? attempts[0];
}

/**
 * Wilson score interval at 95%. Deliberately not the normal approximation: at
 * the rates these checks sit at (0.9 and up, sometimes 1.0) the Wald interval
 * runs past 1 and collapses to zero width at 0/n and n/n, which would read as
 * certainty manufactured by arithmetic. Sanity anchor: 9/10 → [0.596, 0.982].
 */
export function wilson95(passes: number, trials: number): [number, number] {
  if (trials <= 0) return [0, 0];
  const z = 1.959963984540054;
  const z2 = z * z;
  const p = passes / trials;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/** A case's usage: its own reading, else the sum of its attempts' readings. */
function caseUsage(item: EvalRunLogCaseV2): TokenUsage | undefined {
  if (item.usage) return item.usage;
  const observed = (item.attempts ?? [])
    .map((attempt) => attempt.usage)
    .filter((usage): usage is TokenUsage => !isUsageUnobserved(usage));
  return observed.length ? sumUsage(observed) : undefined;
}

function answered(attempt: EvalRunLogAttempt): boolean {
  return Boolean(attempt.answer?.trim() || attempt.clarification?.trim());
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * The run's headline numbers from its folded cases. `costUsd` is the run's
 * estimated cost; `costPerCorrectUsd` is only reported when both it and passK
 * are non-zero — "$0.00 per correct answer" from an unpriced model would be a
 * confident wrong number.
 */
export function summarizeCases(
  cases: readonly EvalRunLogCaseV2[],
  costUsd?: number,
): EvalRunSummary {
  const scored = cases.filter(
    (item) => item.verdict !== 'GAP' && item.verdict !== 'SKIP',
  );
  const passK = scored.filter((item) => item.verdict === 'PASS').length;
  const totalRuns = scored.reduce((sum, item) => sum + item.runs, 0);
  const totalPasses = scored.reduce((sum, item) => sum + item.passes, 0);

  const withAttempts = cases.filter((item) => (item.attempts ?? []).length > 0);
  const answeredEveryTime = withAttempts.filter((item) =>
    item.attempts.every(answered),
  ).length;

  const byCategory: EvalRunSummary['byCategory'] = {};
  const byDifficulty: EvalRunSummary['byDifficulty'] = {};
  const categoryRuns: Record<string, { runs: number; passes: number }> = {};
  for (const item of scored) {
    const category = item.category ?? 'uncategorised';
    const entry = (byCategory[category] ??= {
      total: 0,
      passK: 0,
      meanPassRate: 0,
    });
    const counts = (categoryRuns[category] ??= { runs: 0, passes: 0 });
    entry.total += 1;
    counts.runs += item.runs;
    counts.passes += item.passes;
    if (item.verdict === 'PASS') entry.passK += 1;

    const difficulty = item.difficulty ?? 'unrated';
    const level = (byDifficulty[difficulty] ??= { total: 0, passK: 0 });
    level.total += 1;
    if (item.verdict === 'PASS') level.passK += 1;
  }
  for (const [category, counts] of Object.entries(categoryRuns)) {
    byCategory[category].meanPassRate = ratio(counts.passes, counts.runs);
  }

  const behaviour = scored.filter(
    (item) => item.category && BEHAVIOUR_CATEGORIES.has(item.category),
  );
  const usages = cases
    .map(caseUsage)
    .filter((usage): usage is TokenUsage => !isUsageUnobserved(usage));

  return {
    passK,
    passKRate: ratio(passK, scored.length),
    scored: scored.length,
    meanPassRate: ratio(totalPasses, totalRuns),
    flaky: cases.filter((item) => item.flaky).length,
    gaps: cases.filter((item) => item.verdict === 'GAP').length,
    answeredEveryTime,
    answeredObserved: withAttempts.length,
    ...(behaviour.length
      ? {
          behaviourPassK: behaviour.filter((item) => item.verdict === 'PASS')
            .length,
          behaviourTotal: behaviour.length,
        }
      : {}),
    byCategory,
    byDifficulty,
    ...(costUsd !== undefined && costUsd > 0 && passK > 0
      ? { costPerCorrectUsd: Number((costUsd / passK).toFixed(6)) }
      : {}),
    ...(usages.length
      ? {
          tokensPerCase: Math.round(
            usages.reduce((sum, usage) => sum + usage.totalTokens, 0) /
              usages.length,
          ),
        }
      : {}),
  };
}

/* -------------------------------------------------------- normalisation */

/**
 * v1 `reason` values that already name a failure class. Anything else stays
 * a `reason` with no label — a guessed label would read as a diagnosis.
 */
const V1_REASON_LABELS: Readonly<Record<string, FailureLabel>> = {
  timeout: 'timeout',
  'no-sql': 'no-sql',
  'llm-judge': 'judge',
  'sql-error': 'tool-error',
  'check-no-tool-errors': 'tool-error',
  clarified: 'clarified',
};

function caseFromV1(item: EvalRunLogCase): EvalRunLogCaseV2 {
  // A v1 case is one draw unless the CLI's `--repeat` recorded runs/passes. A
  // SKIP never ran, so it has no runs to count.
  const runs =
    typeof item.runs === 'number' ? item.runs : item.verdict === 'SKIP' ? 0 : 1;
  const passes =
    typeof item.passes === 'number'
      ? item.passes
      : item.verdict === 'PASS'
        ? runs
        : 0;
  const label =
    item.verdict === 'PASS' || !item.reason
      ? undefined
      : V1_REASON_LABELS[item.reason];
  return {
    id: item.id,
    ...(item.category ? { category: item.category } : {}),
    verdict: item.verdict,
    runs,
    passes,
    flaky: passes > 0 && passes < runs,
    ...(label ? { failureLabel: label } : {}),
    ...(item.reason ? { reason: item.reason } : {}),
    durationMs: item.durationMs,
    ...(item.usage ? { usage: item.usage } : {}),
    ...(item.estimatedCostUsd !== undefined
      ? { estimatedCostUsd: item.estimatedCostUsd }
      : {}),
    attempts: [],
  };
}

/**
 * Every run log as v2, so readers (History, Compare, Trend, `eval:diff`)
 * handle one shape. A v1 record becomes a v2 *view*: no attempts, one draw per
 * case unless the CLI recorded `runs`/`passes`, the engine as it shipped
 * (`ENGINE_DEFAULTS` — every v1 run predates the levers), config hash
 * `legacy`, status `completed`, no GAPs (v1 had no way to say so).
 *
 * A v2 record is returned with its gaps filled defensively: it came off disk,
 * and a hand-edited or truncated file must not crash a listing.
 */
export function normalizeRunLog(record: EvalRunLogRecord): EvalRunLogRecordV2 {
  if (isRunLogV2(record)) {
    const cases = (record.cases ?? []).map((item) => ({
      ...item,
      attempts: Array.isArray(item.attempts) ? item.attempts : [],
    }));
    return {
      ...record,
      datasets: record.datasets ?? [],
      repeat: record.repeat ?? 1,
      engine: resolveEngineOptions(record.engine),
      configHash: record.configHash ?? 'unknown',
      totals: { ...emptyTotals(), ...record.totals },
      summary: record.summary ?? summarizeCases(cases, record.estimatedCostUsd),
      categories: record.categories ?? tallyCategories(cases),
      usage: record.usage ?? emptyUsage(),
      cases,
      status: record.status ?? 'completed',
    };
  }
  const v1 = record;
  const cases = (v1.cases ?? []).map(caseFromV1);
  return {
    schemaVersion: 2,
    runId: v1.runId,
    ...(v1.label ? { label: v1.label } : {}),
    harness: v1.harness,
    suite: v1.suite,
    ...(v1.agentKey ? { agentKey: v1.agentKey } : {}),
    datasets: v1.datasets ?? [],
    ...(v1.model ? { model: v1.model } : {}),
    repeat: Math.max(1, ...cases.map((item) => item.runs)),
    engine: resolveEngineOptions(),
    configHash: 'legacy',
    startedAt: v1.startedAt,
    finishedAt: v1.finishedAt,
    durationMs: v1.durationMs,
    ...(v1.appVersion ? { appVersion: v1.appVersion } : {}),
    ...(v1.gitCommit ? { gitCommit: v1.gitCommit } : {}),
    totals: { ...emptyTotals(), ...v1.totals, gaps: 0 },
    summary: summarizeCases(cases, v1.estimatedCostUsd),
    categories: v1.categories ?? tallyCategories(cases),
    usage: v1.usage ?? emptyUsage(),
    ...(v1.estimatedCostUsd !== undefined
      ? { estimatedCostUsd: v1.estimatedCostUsd }
      : {}),
    ...(v1.costIncomplete ? { costIncomplete: true } : {}),
    cases,
    ...(v1.comparedToRunId ? { comparedToRunId: v1.comparedToRunId } : {}),
    ...(v1.regressions ? { regressions: v1.regressions } : {}),
    ...(v1.improvements ? { improvements: v1.improvements } : {}),
    status: 'completed',
  };
}

function emptyTotals(): EvalRunLogRecordV2['totals'] {
  return { cases: 0, passed: 0, failed: 0, errored: 0, gaps: 0, skipped: 0 };
}
