/**
 * The target run option of the command line (agents-evals R252): run a set's
 * questions on another target than the set's own, so the same questions can
 * be put to Emily (`assistant`, one agent with the dataset tools) and to the
 * whole Answer a Business Question workflow (`insights-analyst`) and the two
 * compared. Unset or blank: the set's own target, as before the option.
 *
 * Only the two targets that answer a business question end to end are
 * taken; the checks of either set read the answer and the tool calls, which
 * both targets produce.
 *
 * Pure module: no Nest, no Mastra, no model.
 */

/** The targets `EVAL_TARGET` may name. */
export const EVAL_TARGET_OVERRIDES = ['assistant', 'insights-analyst'] as const;

export type EvalTargetOverride = (typeof EVAL_TARGET_OVERRIDES)[number];

export type EvalTargetOverrideResult =
  { target?: EvalTargetOverride } | { error: string };

/** `EVAL_TARGET`, trimmed: unset or blank is no override. */
export function targetOverrideFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): EvalTargetOverrideResult {
  const value = env['EVAL_TARGET']?.trim() ?? '';
  if (!value) return {};
  const target = EVAL_TARGET_OVERRIDES.find((known) => known === value);
  return target
    ? { target }
    : {
        error: `Unknown EVAL_TARGET "${value}"; use ${EVAL_TARGET_OVERRIDES.join(' or ')}`,
      };
}

/** A memory arm runs only on the assistant (R232), whoever's set it is. */
export const TARGET_MEMORY_ERROR = 'Memory arms run only on the assistant';
