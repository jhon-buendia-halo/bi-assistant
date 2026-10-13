import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { callsOf, correctedSql, quote, writtenSql } from './turn';

/**
 * `noRepairs` (agents-evals R69, criterion D3, first-try SQL): no
 * `run_readonly_sql` call needed the SQL fixer. The fixer's rewrite rides
 * back on the tool result as `correctedSql`. A turn with no SQL passes;
 * a call that still failed after a repair is `noToolErrors`'s to count.
 */
export const noRepairs: DeterministicCheck = {
  type: 'noRepairs',
  id: 'check-no-repairs',
  name: 'No Repairs Check',
  criterion: 'D3',
  args: { required: [], optional: [] },
  describe: () => 'Checks that no SQL query needed the automatic SQL fix',
  evaluate: (turn) => {
    const calls = callsOf(turn, 'run_readonly_sql');
    const repaired = calls.filter((call) => correctedSql(call) !== undefined);
    if (repaired.length === 0) return PASS;
    const first = repaired[0];
    return fail(
      `the SQL fixer rewrote ${repaired.length} of ${calls.length} queries; the first as written: "${quote(writtenSql(first) ?? '(not recorded)')}"`,
    );
  },
};
