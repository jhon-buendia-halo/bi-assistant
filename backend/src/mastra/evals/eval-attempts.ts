/**
 * A question's attempts and their fold into one result (agents-evals R210,
 * R211). With Repeats k a run asks each question k times, one attempt after
 * another; the question passes only when every attempt passed (pass^k), and
 * a question with both passed and failed attempts is flaky and counts as
 * failed. The result shows its representative attempt, the first failed one
 * or else the first, and with k above 1 keeps every attempt.
 *
 * Pure module: no Nest, no Mastra, no model.
 */
// Type-only: erased at compile time, so no runtime edge to the agent stack.
import type {
  AssistantEvalCase,
  AssistantEvalCaseResult,
  EvalAttempt,
} from './assistant.evals';
import { costOf, mergeUsage } from './eval-usage';
import type { ModelUsageEntry, PriceTable } from './eval-usage';
import { resultStatusOf } from './eval-summary';
import type { EvalStatus } from './eval-summary';

/** The cost of some usage in dollars, or `null` when not priced (R221). */
export function costUsdOf(
  usage: readonly ModelUsageEntry[],
  table?: PriceTable,
): number | null {
  const cost = costOf(usage, table);
  return 'usd' in cost ? cost.usd : null;
}

/**
 * The sum of several costs, to six decimals: `null` when any is not priced.
 * A missing cost (a result saved before usage was recorded) adds nothing.
 */
export function sumCostUsd(
  costs: readonly (number | null | undefined)[],
): number | null {
  if (costs.some((cost) => cost === null)) return null;
  const dollars = costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

/** One attempt as a result's `attempts` holds it. */
function toAttempt(
  result: AssistantEvalCaseResult,
  index: number,
): EvalAttempt {
  const usage = result.usage ?? [];
  return {
    attempt: index + 1,
    status: resultStatusOf(result),
    passed: resultStatusOf(result) === 'passed',
    scores: result.scores,
    checkResults: result.checkResults,
    answer: result.answer,
    toolCalls: result.toolCalls,
    ...(result.error !== undefined ? { error: result.error } : {}),
    durationMs: result.durationMs,
    usage,
    costUsd: result.costUsd === undefined ? costUsdOf(usage) : result.costUsd,
  };
}

/**
 * Fold a question's attempts, in order, into its result (R211): `passed`
 * only when every attempt passed, `not-scored` when every attempt was not
 * scored, `failed` otherwise. Checks, scores, answer, tool calls, error and
 * duration are the representative attempt's; usage and cost are the sums.
 */
export function foldAttempts(
  attempts: readonly AssistantEvalCaseResult[],
): AssistantEvalCaseResult {
  if (attempts.length === 0) {
    throw new RangeError('A question needs at least one attempt to fold');
  }
  const statuses = attempts.map(resultStatusOf);
  const passes = statuses.filter((status) => status === 'passed').length;
  const failures = statuses.filter((status) => status === 'failed').length;
  const status: EvalStatus =
    passes === attempts.length
      ? 'passed'
      : statuses.every((each) => each === 'not-scored')
        ? 'not-scored'
        : 'failed';
  const representative =
    attempts.find((_, index) => statuses[index] === 'failed') ?? attempts[0];
  // A folded result never nests attempts of its own.
  const fields = { ...representative };
  delete fields.attempts;
  const recorded = attempts.some((attempt) => attempt.usage !== undefined);
  return {
    ...fields,
    status,
    passed: status === 'passed',
    passes,
    runs: attempts.length,
    flaky: passes > 0 && failures > 0,
    ...(recorded
      ? {
          usage: attempts.reduce<ModelUsageEntry[]>(
            (sum, attempt) => mergeUsage(sum, attempt.usage),
            [],
          ),
          costUsd: sumCostUsd(attempts.map((attempt) => attempt.costUsd)),
        }
      : {}),
    ...(attempts.length > 1 ? { attempts: attempts.map(toAttempt) } : {}),
  };
}

/** What an attempt that threw past the runner records: a failure. */
function thrownAttempt(
  evalCase: AttemptCase,
  err: unknown,
  durationMs: number,
): AssistantEvalCaseResult {
  return {
    id: evalCase.id,
    question: evalCase.question,
    ...(evalCase.category !== undefined ? { category: evalCase.category } : {}),
    split: evalCase.split ?? 'dev',
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    status: 'failed',
    passed: false,
    error: err instanceof Error ? err.message : String(err),
    durationMs,
    passes: 0,
    runs: 1,
    flaky: false,
    usage: [],
    costUsd: 0,
  };
}

/** What the attempts of a case need to know about it. */
export type AttemptCase = Pick<
  AssistantEvalCase,
  'id' | 'question' | 'category' | 'split'
>;

/**
 * Run `repeats` attempts of one question, one after another, and fold them
 * (R210, R211). `onAttempt` hears the number of each attempt (1 to k) as it
 * starts. An attempt that throws fails with its error, and the question's
 * other attempts still run.
 */
export async function runCaseAttempts(
  evalCase: AttemptCase,
  repeats: number,
  runOnce: (attempt: number) => Promise<AssistantEvalCaseResult>,
  onAttempt?: (attempt: number) => void,
): Promise<AssistantEvalCaseResult> {
  const attempts: AssistantEvalCaseResult[] = [];
  for (let attempt = 1; attempt <= Math.max(1, repeats); attempt++) {
    onAttempt?.(attempt);
    const startedAt = Date.now();
    try {
      attempts.push(await runOnce(attempt));
    } catch (err) {
      attempts.push(thrownAttempt(evalCase, err, Date.now() - startedAt));
    }
  }
  return foldAttempts(attempts);
}
