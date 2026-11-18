import { noRepairs } from './no-repairs';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };

function sql(sql: string, result: unknown, error?: string): CheckToolCall {
  return {
    name: 'run_readonly_sql',
    args: { sql, rationale: 'Why.' },
    argsReadable: true,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

const turn = (...toolCalls: CheckToolCall[]): CheckTurn => ({
  question: 'Who won the 2022 World Cup?',
  answer: 'Argentina.',
  toolCalls,
});

describe('noRepairs (R113, D3)', () => {
  it('passes when every query ran as written', () => {
    expect(
      noRepairs.evaluate(
        turn(sql('SELECT 1', { rows: [{ n: 1 }] })),
        {},
        context,
      ),
    ).toEqual({ passed: true });
  });

  it('fails on a query the SQL fixer rewrote, quoting it as written', () => {
    // The champion-2022 trace of the baseline: `t.name` and `year` were
    // guesses, rewritten to `t.common_name` and `tournament_year`.
    const verdict = noRepairs.evaluate(
      turn(
        sql('SELECT t.name FROM world_cup.teams t', {
          rows: [{ champion_team: 'Argentina' }],
          correctedSql: 'SELECT t.common_name FROM world_cup.teams t',
          note: 'original query failed and was auto-corrected',
        }),
        sql('SELECT 2', { rows: [] }),
      ),
      {},
      context,
    );
    expect(verdict).toEqual({
      passed: false,
      reason:
        'the SQL fixer rewrote 1 of 2 queries; the first as written: "SELECT t.name FROM world_cup.teams t"',
    });
  });

  it('passes a turn with no SQL, and does not count a call that failed', () => {
    expect(noRepairs.evaluate(turn(), {}, context).passed).toBe(true);
    expect(
      noRepairs.evaluate(
        turn(sql('SELECT x', undefined, 'column x does not exist')),
        {},
        context,
      ).passed,
    ).toBe(true);
  });

  it('describes itself for the Evals tab', () => {
    expect(noRepairs.describe({}, context)).toBe(
      'Checks that no SQL query needed the automatic SQL fix',
    );
    expect(noRepairs).toMatchObject({
      id: 'check-no-repairs',
      criterion: 'D3',
    });
  });
});
