import { sqlMatches } from './sql-matches';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };
const penalties = { pattern: 'penalt', flags: 'i' };

function sql(
  written: string,
  result: Record<string, unknown> | undefined,
  error?: string,
): CheckToolCall {
  return {
    name: 'run_readonly_sql',
    args: { sql: written, rationale: 'Why.' },
    argsReadable: true,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

const turn = (...toolCalls: CheckToolCall[]): CheckTurn => ({
  question: 'Which knockout matches went to a penalty shootout?',
  answer: '…',
  toolCalls,
});

describe('sqlMatches (R78)', () => {
  it('passes when one successful query matches', () => {
    expect(
      sqlMatches.evaluate(
        turn(
          sql('SELECT 1 FROM world_cup.matches', { rows: [] }),
          sql(
            'SELECT * FROM world_cup.v_match_results WHERE home_penalties IS NOT NULL',
            { rows: [] },
          ),
        ),
        penalties,
        context,
      ),
    ).toEqual({ passed: true });
  });

  it('reads the statement that ran: the fixer’s rewrite, not a failed call', () => {
    expect(
      sqlMatches.evaluate(
        turn(
          sql('SELECT shootout FROM world_cup.matches', {
            rows: [],
            correctedSql:
              'SELECT home_penalties FROM world_cup.matches WHERE home_penalties IS NOT NULL',
          }),
        ),
        penalties,
        context,
      ).passed,
    ).toBe(true);
    expect(
      sqlMatches.evaluate(
        turn(sql('SELECT penalties FROM x', undefined, 'no such column')),
        penalties,
        context,
      ),
    ).toEqual({
      passed: false,
      reason: 'no successful run_readonly_sql to inspect',
    });
  });

  it('fails naming the pattern and the last query', () => {
    expect(
      sqlMatches.evaluate(
        turn(
          sql("SELECT id FROM world_cup.matches WHERE stage = 'final'", {
            rows: [],
          }),
        ),
        penalties,
        context,
      ),
    ).toEqual({
      passed: false,
      reason:
        'no successful SQL matches /penalt/i; the last: "SELECT id FROM world_cup.matches WHERE stage = \'final\'"',
    });
    expect(sqlMatches.describe(penalties, context)).toBe(
      'Checks that a successful SQL query matches pattern /penalt/i',
    );
  });

  it('refuses flags that make a match stateful, or a pattern that does not compile', () => {
    expect(sqlMatches.validateArgs?.({ pattern: 'a', flags: 'g' })).toMatch(
      /without "g" or "y"/,
    );
    expect(sqlMatches.validateArgs?.({ pattern: '(' })).toMatch(
      /not a valid regular expression/,
    );
    expect(sqlMatches.validateArgs?.(penalties)).toBeUndefined();
  });
});
