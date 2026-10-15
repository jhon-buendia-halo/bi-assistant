import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { quote } from './turn';
import type { CheckToolCall } from './turn';

/** The calls the prompt asks a rationale of ("Say why, every time"). */
const RATIONALE_TOOLS = ['run_readonly_sql', 'sample_rows'];

/**
 * Sentences: a `.`, `!` or `?` run followed by a capital letter (or an
 * opening quote or bracket) or by the end. A decimal (`2.5`) or `e.g. the`
 * is not an end; text after the last end counts as one more sentence.
 */
export function sentenceCount(text: string): number {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 0;
  const ends = flat.match(/[.!?]+(?=\s+["'([]?[A-Z]|\s*$)/g) ?? [];
  const closed = /[.!?]+["')\]]?\s*$/.test(flat);
  return ends.length + (closed ? 0 : 1);
}

/** SQL syntax a business sentence never needs. */
const SQL_SYNTAX: readonly [RegExp, string][] = [
  [
    /\b(?:SELECT|FROM|WHERE|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|UNION|DISTINCT)\b/,
    'SQL keyword',
  ],
  [/\b(?:group|order)\s+by\b/i, 'SQL clause'],
  [
    /\b(?:count|sum|avg|min|max|round|coalesce|cast|nullif|date_trunc|extract)\s*\(/i,
    'SQL function',
  ],
];

/** Names written the way SQL writes them, not the way a reader says them. */
const CODE_NAMES: readonly [RegExp, string][] = [
  [/`[^`]+`/, 'name in backticks'],
  [/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/, 'column-style name'],
  [/\b[a-z_][a-z0-9_]+(?:\.[a-z_][a-z0-9_]+)+\b/, 'dotted table name'],
];

/** Why one call's rationale breaks R115, or undefined when it holds. */
export function rationaleProblem(call: CheckToolCall): string | undefined {
  const rationale = call.args.rationale;
  if (typeof rationale !== 'string' || !rationale.trim()) {
    return 'gave no rationale';
  }
  const sentences = sentenceCount(rationale);
  if (sentences > 2) {
    return `the rationale has ${sentences} sentences, at most two ("${quote(rationale)}")`;
  }
  for (const [pattern, what] of [...SQL_SYNTAX, ...CODE_NAMES]) {
    const match = pattern.exec(rationale);
    if (match) {
      return `the rationale names ${what} "${match[0]}" ("${quote(rationale)}")`;
    }
  }
  return undefined;
}

/**
 * `rationaleOk` (agents-evals R115, criterion I3): every SQL and sampling step
 * says why in one or two business sentences, with no SQL syntax or column
 * names. Whether the sentence explains the step rather than restating the
 * question is the judge's part (research 2.3).
 */
export const rationaleOk: DeterministicCheck = {
  type: 'rationaleOk',
  id: 'check-rationale-ok',
  name: 'Rationale Check',
  criterion: 'I3',
  args: { required: [], optional: [] },
  describe: () =>
    'Checks that every SQL and sampling step has a one- or two-sentence business rationale',
  evaluate: (turn) => {
    let position = 0;
    for (const call of turn.toolCalls) {
      position += 1;
      // A stored record clipped past parsing cannot be judged; a live run
      // always has readable arguments.
      if (!RATIONALE_TOOLS.includes(call.name) || !call.argsReadable) continue;
      const problem = rationaleProblem(call);
      if (problem) return fail(`step ${position} (${call.name}): ${problem}`);
    }
    return PASS;
  },
};
