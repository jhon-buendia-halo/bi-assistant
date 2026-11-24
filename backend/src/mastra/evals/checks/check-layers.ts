/**
 * The three layers of an eval check (agents-evals R258). Framework-free.
 *
 * - `outcome`: what the user gets: the answer's text and figures, the query
 *   result behind it, a clarifying question, a visual, the judge. Every target
 *   is scored on it, and it is the only layer a comparison across targets
 *   (agent against workflow) reads.
 * - `path`: how an agent got there: which tools it called, in which order,
 *   whether it repaired or errored on the way. The agent's own gate; a
 *   workflow is not compared on it.
 * - `step`: one step of a workflow (Plan, Analyse, Validate, Write answer,
 *   Build visual), scored inside the same run. Diagnostic: it names where a
 *   question broke and never changes the question's verdict.
 */
export type CheckLayer = 'outcome' | 'path' | 'step';

export const CHECK_LAYERS: readonly CheckLayer[] = ['outcome', 'path', 'step'];

/** The checks that read how the answer was reached, not what it is. */
export const PATH_CHECK_IDS: ReadonlySet<string> = new Set([
  'check-called-tool',
  'check-did-not-call',
  'check-tool-order',
  'check-no-tool-errors',
  'check-no-repairs',
  'check-rationale-ok',
  'retry-no-rediscovery',
]);

/** Every workflow step check's id starts with it. */
export const STEP_CHECK_PREFIX = 'step-';

/**
 * Checks that compare two workflow steps with each other (the
 * `insights-analyst-edge` set): they are step checks under older ids, so an
 * agent with no steps is not failed for lacking them (fixed 2026-11-23).
 */
export const CROSS_STEP_CHECK_IDS: ReadonlySet<string> = new Set([
  'plan-entities-in-sql',
  'headline-figures-in-rows',
]);

/** The layer of a check, by its id. */
export function layerOf(checkId: string): CheckLayer {
  if (checkId.startsWith(STEP_CHECK_PREFIX)) return 'step';
  if (CROSS_STEP_CHECK_IDS.has(checkId)) return 'step';
  return PATH_CHECK_IDS.has(checkId) ? 'path' : 'outcome';
}

/** Whether a check counts toward its question's verdict (not a step check). */
export function gatesVerdict(checkId: string | undefined): boolean {
  return checkId === undefined || layerOf(checkId) !== 'step';
}
