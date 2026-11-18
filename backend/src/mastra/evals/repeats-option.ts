/**
 * The repeats run option (agents-evals R209, R222): how many attempts a run
 * makes at each question, 1 by default, 3 or 5. One run of a question is a
 * sample of one from a flaky distribution; with three or five attempts a
 * question passes only when every attempt passed (pass^k, R211).
 *
 * Pure module: no Nest, no Mastra, no model.
 */

export const EVAL_REPEATS = [1, 3, 5] as const;
export type EvalRepeats = (typeof EVAL_REPEATS)[number];

/** How a run saved before the option existed reads: one attempt each. */
export const LEGACY_REPEATS: EvalRepeats = 1;

export type RepeatsResult = { repeats: EvalRepeats } | { error: string };

/** A string as written, anything else JSON-encoded (R209). */
function shown(value: unknown): string {
  return typeof value === 'string' ? value : String(JSON.stringify(value));
}

function refused(value: unknown): RepeatsResult {
  return { error: `Repeats must be 1, 3 or 5 (got "${shown(value)}")` };
}

/**
 * Read the repeats as the API receives them (api.md endpoint 36): missing
 * (or `null`) is 1, and only the numbers 1, 3 and 5 are taken, so the string
 * `"3"` is refused too.
 */
export function parseRepeats(value: unknown): RepeatsResult {
  if (value === undefined || value === null) return { repeats: 1 };
  const repeats = EVAL_REPEATS.find((allowed) => allowed === value);
  return repeats ? { repeats } : refused(value);
}

/**
 * The command line's `EVAL_REPEATS`, read as text (R222): unset or blank is
 * 1; otherwise `1`, `3` or `5`.
 */
export function repeatsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): RepeatsResult {
  const value = env['EVAL_REPEATS']?.trim() ?? '';
  if (!value) return { repeats: 1 };
  const repeats = EVAL_REPEATS.find((allowed) => String(allowed) === value);
  return repeats ? { repeats } : refused(value);
}
