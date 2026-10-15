/**
 * Question and check statuses, and a run's summary by status, category and
 * criterion (agents-evals R145 to R147, R152). A not-scored check (the judge
 * was off for its question) is a gap: it never makes a question pass, and a
 * question with no scored check is not scored rather than passed.
 *
 * Pure module: no Nest, no Mastra, no model. The runner, the run service, the
 * report and the command line all read it.
 */
import { EVAL_CATEGORIES, EVAL_CRITERIA } from './eval-set-files';
// Type-only: erased at compile time, so no runtime edge to the agent stack.
import type {
  AssistantEvalCaseResult,
  EvalCheckResult,
} from './assistant.evals';

export const EVAL_STATUSES = ['passed', 'failed', 'not-scored'] as const;
export type EvalStatus = (typeof EVAL_STATUSES)[number];

/** Where a question with no category (a run saved before categories) counts. */
export const UNCATEGORISED = 'uncategorised';

export interface EvalCategorySummary {
  category: string;
  passed: number;
  failed: number;
  notScored: number;
  total: number;
}

export interface EvalCriterionSummary {
  criterion: string;
  passed: number;
  failed: number;
  total: number;
}

export interface EvalRunSummary {
  /** Questions per status. */
  passed: number;
  failed: number;
  notScored: number;
  byCategory: EvalCategorySummary[];
  /** Scored checks with a criterion, not questions. */
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
 * A question's status from its checks (R146): failed when its run threw;
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

/** A question result as a stored run may hold it (no status before BA-184). */
export type StoredEvalCaseResult = Omit<
  AssistantEvalCaseResult,
  'status' | 'checkResults'
> & {
  status?: EvalStatus;
  checkResults?: StoredEvalCheckResult[];
};

/** Fill the statuses a result saved before BA-184 lacks (R146). */
export function withStatusDefaults(
  result: StoredEvalCaseResult,
): AssistantEvalCaseResult {
  return {
    ...result,
    checkResults: (result.checkResults ?? []).map((check) => ({
      ...check,
      status: checkStatusOf(check),
    })),
    status: resultStatusOf(result),
  };
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

/** What the summary reads from a result; old and partial records included. */
interface SummarisableResult extends HasStatus {
  category?: string;
  checkResults?: readonly (HasStatus & { criterion?: string })[];
}

/** A run's summary of its finished results (R147). */
export function summarizeEvalResults(
  results: readonly SummarisableResult[],
): EvalRunSummary {
  const categories = new Map<string, EvalCategorySummary>();
  const criteria = new Map<string, EvalCriterionSummary>();
  const categoryOrder: string[] = [];
  const criterionOrder: string[] = [];
  const totals = { passed: 0, failed: 0, notScored: 0 };

  for (const result of results) {
    const status = resultStatusOf(result);
    const key = status === 'not-scored' ? 'notScored' : status;
    totals[key] += 1;

    const category = result.category || UNCATEGORISED;
    let byCategory = categories.get(category);
    if (!byCategory) {
      byCategory = { category, passed: 0, failed: 0, notScored: 0, total: 0 };
      categories.set(category, byCategory);
      categoryOrder.push(category);
    }
    byCategory[key] += 1;
    byCategory.total += 1;

    for (const check of result.checkResults ?? []) {
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
    ...totals,
    byCategory: ordered(categoryOrder, EVAL_CATEGORIES, UNCATEGORISED).map(
      (category) => categories.get(category)!,
    ),
    byCriterion: ordered(criterionOrder, EVAL_CRITERIA).map((criterion) =>
      criteria.get(criterion)!,
    ),
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * `## By category` and `## By criterion`, as the Markdown report and the
 * command line print them (R152, R153).
 */
export function renderSummaryMarkdown(summary: EvalRunSummary): string[] {
  const lines = ['## By category', ''];
  if (summary.byCategory.length === 0) {
    lines.push('No finished questions yet.');
  } else {
    lines.push(
      '| Category | Passed | Failed | Not scored | Total |',
      '| --- | --- | --- | --- | --- |',
      ...summary.byCategory.map(
        (entry) =>
          `| ${cell(entry.category)} | ${entry.passed} | ${entry.failed} | ${entry.notScored} | ${entry.total} |`,
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
