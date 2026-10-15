import { fail, PASS, patternProblem, patternRegExp } from './check';
import type { DeterministicCheck, PatternArgs } from './check';
import { executedStatements, quote } from './turn';

/**
 * `sqlMatches` (agents-evals R121, no default criterion): a pattern the SQL
 * that ran must contain, such as the column a fact is encoded in or a
 * default filter's predicate. The file names the criterion it serves.
 */
export const sqlMatches: DeterministicCheck<PatternArgs> = {
  type: 'sqlMatches',
  id: 'check-sql-matches',
  name: 'SQL Matches Check',
  args: { required: ['pattern'], optional: ['flags'] },
  validateArgs: patternProblem,
  describe: (args) =>
    `Checks that a successful SQL query matches pattern ${patternRegExp(args).toString()}`,
  evaluate: (turn, args) => {
    const statements = executedStatements(turn);
    if (statements.length === 0) {
      return fail('no successful run_readonly_sql to inspect');
    }
    const pattern = patternRegExp(args);
    if (statements.some((sql) => pattern.test(sql))) return PASS;
    return fail(
      `no successful SQL matches ${pattern.toString()}; the last: "${quote(statements[statements.length - 1])}"`,
    );
  },
};
