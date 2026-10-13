import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { callsOf } from './turn';

/**
 * `optionCount` (agents-evals R76, criterion I5): at most one clarification,
 * and that one offers 2 to 4 distinct options ("one short question with 2-4
 * concrete options"). Whether the options are grounded in the data is the
 * judge's part (research 2.3); whether the turn had to ask is `calledTool`'s.
 */
export const optionCount: DeterministicCheck = {
  type: 'optionCount',
  id: 'check-option-count',
  name: 'Option Count Check',
  criterion: 'I5',
  args: { required: [], optional: [] },
  describe: () =>
    'Checks that at most one clarification was asked, with 2 to 4 options',
  evaluate: (turn) => {
    const calls = callsOf(turn, 'ask_clarification');
    if (calls.length === 0) return PASS;
    if (calls.length > 1) {
      return fail(
        `ask_clarification was called ${calls.length} times; at most once per question`,
      );
    }
    const [call] = calls;
    // A stored record clipped past parsing cannot be judged.
    if (!call.argsReadable) return PASS;
    const options = call.args.options;
    if (!Array.isArray(options)) {
      return fail('the clarification carried no options');
    }
    if (options.length < 2 || options.length > 4) {
      return fail(
        `the clarification offered ${options.length} option${options.length === 1 ? '' : 's'}; it needs 2 to 4`,
      );
    }
    const labels = options.map((option: unknown) => {
      const label =
        option && typeof option === 'object'
          ? (option as { label?: unknown }).label
          : undefined;
      return typeof label === 'string' ? label.trim() : '';
    });
    if (labels.some((label) => !label)) {
      return fail('an option of the clarification has no label');
    }
    const seen = new Set<string>();
    for (const label of labels) {
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return fail(`the clarification offers "${label}" twice`);
      }
      seen.add(key);
    }
    return PASS;
  },
};
