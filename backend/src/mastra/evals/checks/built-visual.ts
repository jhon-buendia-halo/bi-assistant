import { fail, PASS } from './check';
import type { CheckVerdict, DeterministicCheck } from './check';
import { callsOf, quote } from './turn';
import type { CheckTurn } from './turn';

export interface BuiltVisualArgs {
  /** False: the turn must NOT build a visual. Default true. */
  built?: boolean;
}

/**
 * `builtVisual` (agents-evals R255, criterion G4): the turn built a visual
 * from data it queried, whoever built it, or with `built: false` it built
 * none. An agent builds one with a successful `create_visual` call after a
 * successful `run_readonly_sql`; the Answer a Business Question workflow
 * with its Build visual step (`outcome.visual`), which only runs after
 * Analyse's queries. What the visual says is `visualKeywords`'s part.
 */
export const builtVisual: DeterministicCheck<BuiltVisualArgs> = {
  type: 'builtVisual',
  id: 'check-built-visual',
  name: 'Built Visual Check',
  criterion: 'G4',
  args: { required: [], optional: ['built'] },
  validateArgs: (args) =>
    args.built === undefined || typeof args.built === 'boolean'
      ? undefined
      : '"built" must be true or false',
  describe: (args) =>
    args.built === false
      ? "Checks that no visual was built (no create_visual call, no visual from the workflow's Build visual)"
      : "Checks that a visual was built from queried data (create_visual after run_readonly_sql, or the workflow's Build visual)",
  evaluate: (turn, args) => {
    if (args.built === false) {
      if (turn.outcome?.visual) {
        return fail("the workflow's Build visual built a visual");
      }
      const created = callsOf(turn, 'create_visual').filter(
        (call) => call.error === undefined,
      );
      return created.length > 0
        ? fail('a visual was built (create_visual)')
        : PASS;
    }
    if (turn.outcome?.visual) return PASS;
    return agentVisual(turn);
  },
};

function agentVisual(turn: CheckTurn): CheckVerdict {
  const calls = callsOf(turn, 'create_visual');
  if (calls.length === 0) {
    return fail('no visual was built: create_visual was not called');
  }
  const firstQuery = turn.toolCalls.findIndex(
    (call) => call.name === 'run_readonly_sql' && call.error === undefined,
  );
  const built = turn.toolCalls.some(
    (call, index) =>
      call.name === 'create_visual' &&
      call.error === undefined &&
      firstQuery >= 0 &&
      index > firstQuery,
  );
  if (built) return PASS;
  if (calls.every((call) => call.error !== undefined)) {
    return fail(
      `create_visual failed: ${quote(calls[calls.length - 1].error ?? 'unknown error')}`,
    );
  }
  return fail(
    'create_visual was called before any successful run_readonly_sql',
  );
}
