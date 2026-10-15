import { fail, PASS, quotedList, stringListProblem } from './check';
import type { DeterministicCheck } from './check';
import { callsOf, quote, resultString } from './turn';

export interface VisualKeywordsArgs {
  keywords: string[];
}

/**
 * `visualKeywords` (agents-evals R120, criterion G4): a visual was created and
 * its title and description say what was asked. A chart of the wrong data
 * under the right title still passes; that is the judge's part (research 2.3).
 */
export const visualKeywords: DeterministicCheck<VisualKeywordsArgs> = {
  type: 'visualKeywords',
  id: 'check-visual-keywords',
  name: 'Visual Keywords Check',
  criterion: 'G4',
  args: { required: ['keywords'], optional: [] },
  validateArgs: (args) => stringListProblem(args, 'keywords'),
  describe: (args) =>
    `Checks that a created visual's title and description mention ${quotedList(args.keywords)}`,
  evaluate: (turn, args) => {
    const calls = callsOf(turn, 'create_visual');
    if (calls.length === 0) return fail('create_visual was not called');
    const created = calls.filter((call) => call.error === undefined);
    if (created.length === 0) {
      return fail(
        `create_visual failed: ${quote(calls[calls.length - 1].error ?? 'unknown error')}`,
      );
    }
    let closest: { title: string; missing: string[] } | undefined;
    for (const call of created) {
      const title = resultString(call, 'title') ?? '';
      const text =
        `${title} ${resultString(call, 'description') ?? ''}`.toLowerCase();
      const missing = args.keywords.filter(
        (keyword) => !text.includes(keyword.toLowerCase()),
      );
      if (missing.length === 0) return PASS;
      if (!closest || missing.length < closest.missing.length) {
        closest = { title, missing };
      }
    }
    return fail(
      `the visual "${quote(closest?.title || '(untitled)')}" does not mention ${quotedList(closest?.missing ?? [])}`,
    );
  },
};
