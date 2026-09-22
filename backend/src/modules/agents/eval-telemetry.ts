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

export function sumUsage(items: readonly (TokenUsage | undefined)[]): TokenUsage {
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

  const inputTokens = count(raw.inputTokens ?? raw.promptTokens ?? raw.input_tokens);
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
  return value && typeof value === 'object' ? (value as Record<string, any>) : undefined;
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
  return perStep.length ? sumUsage(perStep as TokenUsage[]) : undefined;
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

/** Per-category tally, the unit the improvement loop is steered by. */
export interface CategoryTally {
  total: number;
  passed: number;
}

export interface EvalRunLogCase {
  id: string;
  category?: string;
  verdict: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';
  /** Short qualifier: `result-mismatch`, `no-sql`, `timeout`, … */
  reason?: string;
  durationMs: number;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
}

/**
 * One line of the spending and quality history, written to
 * `logs/evals/<date>-<suite>-<label>.json` by every harness that spends
 * tokens. Versioned so the shape can change without orphaning old runs.
 */
export interface EvalRunLogRecord {
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

/** Per-category tallies from case-level verdicts. SKIPs are not counted. */
export function tallyCategories(
  cases: readonly { category?: string; verdict: EvalRunLogCase['verdict'] }[],
): Record<string, CategoryTally> {
  const tally: Record<string, CategoryTally> = {};
  for (const item of cases) {
    if (item.verdict === 'SKIP') continue;
    const key = item.category ?? 'uncategorised';
    const entry = (tally[key] ??= { total: 0, passed: 0 });
    entry.total += 1;
    if (item.verdict === 'PASS') entry.passed += 1;
  }
  return tally;
}
