import { fail, PASS, patternProblem, patternRegExp } from './check';
import type { DeterministicCheck, PatternArgs } from './check';
import { executedStatements, quote, writtenStatements } from './turn';

export interface NotMatchesArgs extends PatternArgs {
  /** Where the pattern must not appear: the answer (default) or the SQL. */
  in?: 'answer' | 'sql';
}

/** The matched text with a little context either side. */
function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * `notMatches` (agents-evals R122, no default criterion): a pattern that must
 * appear nowhere, such as a figure the data cannot hold on an out-of-scope
 * question (the no-fabrication substitute of research 2.3). It is brittle
 * both ways by nature: a refusal worded with a stray number fails it, and a
 * fabrication that avoids the pattern passes.
 */
export const notMatches: DeterministicCheck<NotMatchesArgs> = {
  type: 'notMatches',
  id: 'check-not-matches',
  name: 'Not Matches Check',
  args: { required: ['pattern'], optional: ['flags', 'in'] },
  validateArgs: (args) =>
    patternProblem(args) ??
    (args.in === undefined || args.in === 'answer' || args.in === 'sql'
      ? undefined
      : 'args."in" must be "answer" or "sql"'),
  describe: (args) =>
    `Checks that the ${args.in === 'sql' ? 'SQL' : 'answer'} does not match pattern ${patternRegExp(args).toString()}`,
  evaluate: (turn, args) => {
    const pattern = patternRegExp(args);
    const texts =
      args.in === 'sql'
        ? [...writtenStatements(turn), ...executedStatements(turn)]
        : [turn.answer];
    for (const text of texts) {
      const match = pattern.exec(text);
      if (match) {
        return fail(
          `the ${args.in === 'sql' ? 'SQL' : 'answer'} matches ${pattern.toString()} at "${match[0]}": "${quote(excerpt(text, match.index, match[0].length))}"`,
        );
      }
    }
    return PASS;
  },
};
