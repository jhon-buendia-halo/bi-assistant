import { notMatches } from './not-matches';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };
/** The out-of-scope case's figure guard: any number but the covered years. */
const noFigure = {
  pattern: '\\b(?!(?:1970|2018|2022)\\b)\\d+(?:[.,]\\d+)*\\b',
};

function turn(answer: string, toolCalls: CheckToolCall[] = []): CheckTurn {
  return {
    question: 'How many goals did Pelé score in the 1970 World Cup?',
    answer,
    toolCalls,
  };
}

describe('notMatches (R123)', () => {
  it('passes a refusal that names only the covered years', () => {
    // The baseline's passing out-of-scope answer, shortened.
    expect(
      notMatches.evaluate(
        turn(
          'The dataset does not contain the 1970 World Cup. The available tournaments are limited to the 2018 and 2022 FIFA World Cups.',
        ),
        noFigure,
        context,
      ),
    ).toEqual({ passed: true });
  });

  it('fails a fabricated figure, quoting it in context', () => {
    // The baseline's "Pelé scored a total of 6 goals in the 1970 World Cup".
    const verdict = notMatches.evaluate(
      turn(
        "If you have access to this data elsewhere, you may be able to find that Pelé scored a total of 6 goals in the 1970 World Cup. If you'd like further help, ask.",
      ),
      noFigure,
      context,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(
      /^the answer matches \/.+\/ at "6": "…ble to find that Pelé scored a total of 6 goals in the 1970 World Cup\. If you'd l…"$/,
    );
  });

  it('can guard the SQL instead, written or executed', () => {
    const call: CheckToolCall = {
      name: 'run_readonly_sql',
      args: { sql: 'SELECT * FROM world_cup.goals' },
      argsReadable: true,
      result: {
        rows: [],
        correctedSql: 'SELECT * FROM world_cup.goals WHERE is_test',
      },
    };
    const args = { pattern: 'is_test', in: 'sql' as const };
    expect(notMatches.evaluate(turn('…', [call]), args, context).reason).toBe(
      'the SQL matches /is_test/ at "is_test": "SELECT * FROM world_cup.goals WHERE is_test"',
    );
    expect(notMatches.describe(args, context)).toBe(
      'Checks that the SQL does not match pattern /is_test/',
    );
    expect(notMatches.validateArgs?.({ pattern: 'x', in: 'both' })).toBe(
      'args."in" must be "answer" or "sql"',
    );
  });
});
