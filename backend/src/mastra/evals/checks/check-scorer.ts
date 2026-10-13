import { createScorer } from '@mastra/core/evals';
import type { MastraScorer } from '@mastra/core/evals';
import type { CheckContext, CheckVerdict, DeterministicCheck } from './check';
import { turnFromScorerRun } from './turn';

/** Run a check on a scorer run; a check that throws fails, it never aborts. */
export function evaluateRun(
  check: DeterministicCheck<any>,
  args: Record<string, unknown>,
  context: CheckContext,
  run: { input?: unknown; output?: unknown },
): CheckVerdict {
  try {
    return check.evaluate(turnFromScorerRun(run), args, context);
  } catch (err) {
    return {
      passed: false,
      reason: `the check could not read the run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * A deterministic check as a Mastra scorer (`createScorer`, as the plan
 * says), so `runEvals` scores it beside the `@mastra/evals/checks` helpers.
 *
 * The verdict is computed in the `analyze` step, not `preprocess`: the
 * runner's `checkReason()` turns a known `preprocessStepResult` shape into a
 * sentence and falls back to the scorer's `reason` only when there is none,
 * so leaving `preprocess` empty makes the reported reason exactly the one
 * the check wrote (agents-evals R68).
 */
export function checkScorer(
  check: DeterministicCheck<any>,
  args: Record<string, unknown>,
  context: CheckContext,
): MastraScorer<any, any, any, any> {
  return createScorer({
    id: check.id,
    name: check.name,
    description: check.describe(args, context),
    type: 'agent',
  })
    .analyze(({ run }) => evaluateRun(check, args, context, run))
    .generateScore(({ results }) => (results.analyzeStepResult?.passed ? 1 : 0))
    .generateReason(({ results }) =>
      results.analyzeStepResult?.passed
        ? ''
        : (results.analyzeStepResult?.reason ?? ''),
    );
}
