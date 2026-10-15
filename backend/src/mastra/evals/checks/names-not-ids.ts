import { fail, PASS, quotedList, stringListProblem } from './check';
import type { DeterministicCheck } from './check';
import { quote } from './turn';

export interface NamesNotIdsArgs {
  /** Entity nouns that, followed by a number, read as an id. */
  nouns?: string[];
}

export const DEFAULT_ID_NOUNS = [
  'team',
  'player',
  'club',
  'squad',
  'driver',
  'constructor',
];

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A bare identifier standing in for a name, the pattern `check-answers.ts`
 * pinned against observed answers (`Team ID **5**`, `1. Team ID 5 2. Team ID
 * 2`, `- **Team 4**: 87.13%`, `team_id 5`), with its noun list made a
 * parameter. Two branches: an entity noun with an optional id word, or a bare
 * `id`/`ids`. `(?![a-z])` instead of `\b` after each word, so `team_id` is
 * caught while `teams`, `identifier` and `player_name` are not; `[\W_]{0,4}`
 * for each gap, so `**`, `#`, `:`, `(` and `_` are crossed but a real word is
 * not, which keeps `Team France scored 14 goals` clean.
 */
export function bareIdentifierPattern(
  nouns: readonly string[] = DEFAULT_ID_NOUNS,
): RegExp {
  const alternatives = nouns.map(escape).join('|');
  return new RegExp(
    `(?:\\b(?:${alternatives})(?![a-z])(?:[\\W_]{0,4}(?:id|no|number)(?![a-z]))?|(?:\\b|_)ids?(?![a-z]))[\\W_]{0,4}\\d+\\b`,
    'i',
  );
}

/**
 * `namesNotIds` (agents-evals R113, criterion I1): the answer names things,
 * it does not hand the reader "Team ID 5". It does not look the id up: every
 * entity in the samples has a name, so any bare id is a failure.
 */
export const namesNotIds: DeterministicCheck<NamesNotIdsArgs> = {
  type: 'namesNotIds',
  id: 'check-names-not-ids',
  name: 'Names Not Ids Check',
  criterion: 'I1',
  args: { required: [], optional: ['nouns'] },
  validateArgs: (args) => stringListProblem(args, 'nouns'),
  describe: (args) =>
    args.nouns
      ? `Checks that the answer gives names, not bare ids (nouns ${quotedList(args.nouns)})`
      : 'Checks that the answer gives names, not bare ids',
  evaluate: (turn, args) => {
    const match = bareIdentifierPattern(args.nouns).exec(turn.answer);
    return match
      ? fail(
          `the answer reports a bare identifier ("${quote(match[0])}") instead of a name`,
        )
      : PASS;
  },
};
