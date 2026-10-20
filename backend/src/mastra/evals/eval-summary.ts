/**
 * Question and check statuses, and a run's summary by status, split,
 * category and criterion (agents-evals R146 to R148, R153, R212, R213). A
 * not-scored check (the judge was off for its question) is a gap: it never
 * makes a question pass, and a question with no scored check is not scored
 * rather than passed.
 *
 * Pure module: no Nest, no Mastra, no model. The runner, the run service, the
 * report and the command line all read it.
 */
import { EVAL_CATEGORIES, EVAL_CRITERIA } from './eval-set-files';
import type { EvalSplit } from './eval-set-files';
import { formatPercentRange, wilson95 } from './eval-stats';
import type { Interval } from './eval-stats';
import { costOf, PRICE_TABLE, sumUsage } from './eval-usage';
import type { ModelRate, ModelUsageEntry } from './eval-usage';
// Type-only: erased at compile time, so no runtime edge to the agent stack.
import type {
  AssistantEvalCaseResult,
  EvalCheckResult,
} from './assistant.evals';

export const EVAL_STATUSES = ['passed', 'failed', 'not-scored'] as const;
export type EvalStatus = (typeof EVAL_STATUSES)[number];

/** Where a question with no category (a run saved before categories) counts. */
export const UNCATEGORISED = 'uncategorised';

/** The questions of one split, with the interval of their pass rate (R213). */
export interface EvalSplitSummary {
  passed: number;
  failed: number;
  notScored: number;
  flaky: number;
  total: number;
  /** Wilson's 95% interval of passed over scored; absent when none scored. */
  interval?: Interval;
}

export interface EvalCategorySummary {
  category: string;
  passed: number;
  failed: number;
  notScored: number;
  flaky: number;
  total: number;
  /** The category's dev and held-out questions (R213). */
  dev: EvalSplitSummary;
  heldOut: EvalSplitSummary;
}

export interface EvalCriterionSummary {
  criterion: string;
  passed: number;
  failed: number;
  total: number;
}

export interface EvalRunSummary {
  /** Questions per status; a flaky question is failed (R211). */
  passed: number;
  failed: number;
  notScored: number;
  /** Questions with passed and failed attempts. */
  flaky: number;
  bySplit: { dev: EvalSplitSummary; heldOut: EvalSplitSummary };
  byCategory: EvalCategorySummary[];
  /** Scored checks with a criterion over every attempt, not questions. */
  byCriterion: EvalCriterionSummary[];
}

/** Enough of a check or a question to know its status, old records included. */
interface HasStatus {
  status?: EvalStatus;
  passed?: boolean;
}

/** A check's status; one saved before statuses reads from its `passed`. */
export function checkStatusOf(check: HasStatus): EvalStatus {
  return check.status ?? (check.passed ? 'passed' : 'failed');
}

/** A question's status; one saved before statuses reads from its `passed`. */
export function resultStatusOf(result: HasStatus): EvalStatus {
  return result.status ?? (result.passed ? 'passed' : 'failed');
}

/**
 * A question's status from its checks (R147): failed when its run threw;
 * not scored when no check was scored; passed when every scored check passed.
 */
export function questionStatus(
  checks: readonly HasStatus[],
  error?: string,
): EvalStatus {
  if (error) return 'failed';
  const scored = checks
    .map(checkStatusOf)
    .filter((status) => status !== 'not-scored');
  if (scored.length === 0) return 'not-scored';
  return scored.every((status) => status === 'passed') ? 'passed' : 'failed';
}

/** A check result as a stored run may hold it: before BA-184 it had no status. */
export type StoredEvalCheckResult = Omit<EvalCheckResult, 'status'> & {
  status?: EvalStatus;
};

/**
 * A question result as a stored run may hold it: no status before BA-184; no
 * split and no attempt counts before BA-242.
 */
export type StoredEvalCaseResult = Omit<
  AssistantEvalCaseResult,
  'status' | 'checkResults' | 'split' | 'passes' | 'runs' | 'flaky'
> & {
  status?: EvalStatus;
  checkResults?: StoredEvalCheckResult[];
  split?: EvalSplit;
  passes?: number;
  runs?: number;
  flaky?: boolean;
};

/**
 * Fill what a result saved before BA-184 or BA-242 lacks (data-model 3.8):
 * the statuses from each `passed` flag (R147); the split from `splitOf`,
 * the question bank case with its id, else `dev` (R215); and one attempt
 * (R211). Its category and usage stay as they were.
 */
export function withResultDefaults(
  result: StoredEvalCaseResult,
  splitOf: (caseId: string) => EvalSplit | undefined = () => undefined,
): AssistantEvalCaseResult {
  const status = resultStatusOf(result);
  return {
    ...result,
    checkResults: (result.checkResults ?? []).map((check) => ({
      ...check,
      status: checkStatusOf(check),
    })),
    status,
    split: result.split ?? splitOf(result.id) ?? 'dev',
    passes: result.passes ?? (status === 'passed' ? 1 : 0),
    runs: result.runs ?? 1,
    flaky: result.flaky ?? false,
  };
}

/**
 * `withResultDefaults` with no question bank to read splits from (every
 * missing split reads `dev`); the BA-184 name, safe to pass to `map`.
 */
export function withStatusDefaults(
  result: StoredEvalCaseResult,
): AssistantEvalCaseResult {
  return withResultDefaults(result);
}

/** The keys in a fixed order, then the others in order of first appearance. */
function ordered(
  seen: readonly string[],
  known: readonly string[],
  last?: string,
): string[] {
  const present = new Set(seen);
  const rest = Array.from(present).filter(
    (key) => !known.includes(key) && key !== last,
  );
  return [
    ...known.filter((key) => present.has(key)),
    ...rest,
    ...(last !== undefined && present.has(last) ? [last] : []),
  ];
}

/** What the summary reads from a check: its status and criterion. */
type SummarisableCheck = HasStatus & { criterion?: string };

/** What the summary reads from a result; old and partial records included. */
interface SummarisableResult extends HasStatus {
  category?: string;
  split?: string;
  flaky?: boolean;
  checkResults?: readonly SummarisableCheck[];
  attempts?: readonly { checkResults?: readonly SummarisableCheck[] }[];
}

type StatusCounts = Pick<
  EvalSplitSummary,
  'passed' | 'failed' | 'notScored' | 'flaky' | 'total'
>;

function emptyCounts(): StatusCounts {
  return { passed: 0, failed: 0, notScored: 0, flaky: 0, total: 0 };
}

function countInto(
  counts: StatusCounts,
  status: EvalStatus,
  flaky: boolean,
): void {
  counts[status === 'not-scored' ? 'notScored' : status] += 1;
  if (flaky) counts.flaky += 1;
  counts.total += 1;
}

/** Counts with the Wilson interval of passed over scored (R212). */
function withInterval(counts: StatusCounts): EvalSplitSummary {
  const interval = wilson95(counts.passed, counts.passed + counts.failed);
  return { ...counts, ...(interval ? { interval } : {}) };
}

/** A run's summary of its finished results (R148, R213). */
export function summarizeEvalResults(
  results: readonly SummarisableResult[],
): EvalRunSummary {
  const categories = new Map<
    string,
    { counts: StatusCounts; dev: StatusCounts; heldOut: StatusCounts }
  >();
  const criteria = new Map<string, EvalCriterionSummary>();
  const categoryOrder: string[] = [];
  const criterionOrder: string[] = [];
  const totals = emptyCounts();
  const splits = { dev: emptyCounts(), heldOut: emptyCounts() };

  for (const result of results) {
    const status = resultStatusOf(result);
    const flaky = result.flaky === true;
    const split = result.split === 'held-out' ? 'heldOut' : 'dev';
    countInto(totals, status, flaky);
    countInto(splits[split], status, flaky);

    const category = result.category || UNCATEGORISED;
    let byCategory = categories.get(category);
    if (!byCategory) {
      byCategory = {
        counts: emptyCounts(),
        dev: emptyCounts(),
        heldOut: emptyCounts(),
      };
      categories.set(category, byCategory);
      categoryOrder.push(category);
    }
    countInto(byCategory.counts, status, flaky);
    countInto(byCategory[split], status, flaky);

    // Every attempt's checks, or the result's own when it has no attempts.
    const checkLists = result.attempts?.length
      ? result.attempts.map((attempt) => attempt.checkResults ?? [])
      : [result.checkResults ?? []];
    for (const check of checkLists.flat()) {
      const checkStatus = checkStatusOf(check);
      if (!check.criterion || checkStatus === 'not-scored') continue;
      let byCriterion = criteria.get(check.criterion);
      if (!byCriterion) {
        byCriterion = {
          criterion: check.criterion,
          passed: 0,
          failed: 0,
          total: 0,
        };
        criteria.set(check.criterion, byCriterion);
        criterionOrder.push(check.criterion);
      }
      byCriterion[checkStatus] += 1;
      byCriterion.total += 1;
    }
  }

  return {
    passed: totals.passed,
    failed: totals.failed,
    notScored: totals.notScored,
    flaky: totals.flaky,
    bySplit: {
      dev: withInterval(splits.dev),
      heldOut: withInterval(splits.heldOut),
    },
    byCategory: ordered(categoryOrder, EVAL_CATEGORIES, UNCATEGORISED).map(
      (category) => {
        const entry = categories.get(category)!;
        return {
          category,
          passed: entry.counts.passed,
          failed: entry.counts.failed,
          notScored: entry.counts.notScored,
          flaky: entry.counts.flaky,
          total: entry.counts.total,
          dev: withInterval(entry.dev),
          heldOut: withInterval(entry.heldOut),
        };
      },
    ),
    byCriterion: ordered(criterionOrder, EVAL_CRITERIA).map((criterion) =>
      criteria.get(criterion)!,
    ),
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** A split's cell: `<passed>/<scored> (<interval>)`, or `—` (R216, R218). */
export function splitCell(split: EvalSplitSummary): string {
  const scored = split.passed + split.failed;
  if (scored === 0) return '—';
  return `${split.passed}/${scored} (${formatPercentRange(split.interval)})`;
}

/**
 * The report's and the command line's `Dev:` and `Held-out:` lines (R218):
 * `Dev: <passed>/<scored> passed · 95% interval <interval>`, the interval
 * `—` with no scored question.
 */
export function splitLines(summary: EvalRunSummary): string[] {
  const line = (label: string, split: EvalSplitSummary) =>
    `${label}: ${split.passed}/${split.passed + split.failed} passed · 95% interval ${formatPercentRange(split.interval)}`;
  return [
    line('Dev', summary.bySplit.dev),
    line('Held-out', summary.bySplit.heldOut),
  ];
}

/**
 * `## By category` and `## By criterion`, as the Markdown report and the
 * command line print them (R153, R154, R218).
 */
export function renderSummaryMarkdown(summary: EvalRunSummary): string[] {
  const lines = ['## By category', ''];
  if (summary.byCategory.length === 0) {
    lines.push('No finished questions yet.');
  } else {
    lines.push(
      '| Category | Dev | Held-out | Flaky | Not scored | Total |',
      '| --- | --- | --- | --- | --- | --- |',
      ...summary.byCategory.map(
        (entry) =>
          `| ${cell(entry.category)} | ${splitCell(entry.dev)} | ${splitCell(entry.heldOut)} | ${entry.flaky} | ${entry.notScored} | ${entry.total} |`,
      ),
    );
  }
  lines.push('', '## By criterion', '');
  if (summary.byCriterion.length === 0) {
    lines.push('No scored check names a criterion.');
  } else {
    lines.push(
      '| Criterion | Passed | Failed | Total |',
      '| --- | --- | --- | --- |',
      ...summary.byCriterion.map(
        (entry) =>
          `| ${cell(entry.criterion)} | ${entry.passed} | ${entry.failed} | ${entry.total} |`,
      ),
    );
  }
  return lines;
}

/** A count with thousands separators: `12,345`. */
function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Usage as the report's `Tokens:` lines write it (R218): `<input> in
 * (<cached> cached) · <output> out (<reasoning> reasoning) · <calls> calls`
 * (`1 call` for one), every call counted, then ` · <n> without usage` when
 * calls reported none; `not recorded` when there is no usage (a run saved
 * before BA-242).
 */
export function tokensText(usage?: readonly ModelUsageEntry[]): string {
  if (!usage) return 'not recorded';
  const total = sumUsage(usage);
  const calls = total.calls + total.unreportedCalls;
  const text =
    `${thousands(total.inputTokens)} in (${thousands(total.cachedInputTokens)} cached) · ` +
    `${thousands(total.outputTokens)} out (${thousands(total.reasoningTokens)} reasoning) · ` +
    `${thousands(calls)} ${calls === 1 ? 'call' : 'calls'}`;
  return total.unreportedCalls > 0
    ? `${text} · ${thousands(total.unreportedCalls)} without usage`
    : text;
}

/** Dollars to four decimals: `$0.0123`. */
export function dollars(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * The models of `usage` with no rate, from the run's `rates` snapshot when it
 * has one, else the bundled price table (R220, R221).
 */
export function unpricedModels(
  usage: readonly ModelUsageEntry[],
  rates?: Readonly<Record<string, ModelRate>>,
): string[] {
  const cost = costOf(usage, rates ?? PRICE_TABLE);
  return 'notPriced' in cost ? cost.notPriced : [];
}

/**
 * A cost as the report's `Cost:` lines write it (R218): `$<cost>`, followed
 * by ` · $<cost per question> per question` when `questions` is above 0;
 * `not priced (<models>)` when `costUsd` is `null`; `not recorded` when there
 * is no usage.
 */
export function costText(
  costUsd: number | null | undefined,
  usage: readonly ModelUsageEntry[] | undefined,
  rates?: Readonly<Record<string, ModelRate>>,
  questions = 0,
): string {
  if (!usage || costUsd === undefined) return 'not recorded';
  if (costUsd === null) {
    const models = unpricedModels(usage, rates);
    const named = models.length
      ? models
      : Array.from(new Set(usage.map((entry) => entry.model)));
    return `not priced (${named.join(', ')})`;
  }
  return questions > 0
    ? `${dollars(costUsd)} · ${dollars(costUsd / questions)} per question`
    : dollars(costUsd);
}
