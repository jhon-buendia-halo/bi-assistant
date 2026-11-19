import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { callsOf } from './turn';
import type { CheckTurn } from './turn';

export interface AskedClarificationArgs {
  /** False: the turn must NOT end on a clarifying question. Default true. */
  asked?: boolean;
}

/** Who asked a clarifying question this turn, or undefined. */
function askedBy(turn: CheckTurn): string | undefined {
  if (turn.outcome?.clarification) return "the workflow's Plan";
  const calls = callsOf(turn, 'ask_clarification');
  return calls.some((call) => call.error === undefined)
    ? 'ask_clarification'
    : undefined;
}

/**
 * `askedClarification` (agents-evals R254, criterion D5): the turn ended on
 * a clarifying question, whoever asked it, or with `asked: false` it did
 * not. An agent asks with a successful `ask_clarification` call; the Answer
 * a Business Question workflow asks in its Plan step, with no tool call,
 * which its target records as the turn's outcome (`outcome.clarification`).
 * Both count, so the same question scores an agent and the workflow alike;
 * how many options it offered is `optionCount`'s part.
 */
export const askedClarification: DeterministicCheck<AskedClarificationArgs> = {
  type: 'askedClarification',
  id: 'check-asked-clarification',
  name: 'Asked Clarification Check',
  criterion: 'D5',
  args: { required: [], optional: ['asked'] },
  validateArgs: (args) =>
    args.asked === undefined || typeof args.asked === 'boolean'
      ? undefined
      : '"asked" must be true or false',
  describe: (args) =>
    args.asked === false
      ? "Checks that the turn did not end on a clarifying question (ask_clarification or the workflow's Plan)"
      : "Checks that the turn ended on a clarifying question (ask_clarification or the workflow's Plan)",
  evaluate: (turn, args) => {
    const by = askedBy(turn);
    if (args.asked === false) {
      return by ? fail(`a clarifying question was asked (${by})`) : PASS;
    }
    if (by) return PASS;
    return fail(
      callsOf(turn, 'ask_clarification').length > 0
        ? 'ask_clarification was called but failed'
        : 'no clarifying question was asked: no ask_clarification call and no question from the workflow',
    );
  },
};
