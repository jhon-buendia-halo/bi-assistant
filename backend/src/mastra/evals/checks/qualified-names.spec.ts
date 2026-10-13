import { qualifiedNames } from './qualified-names';
import type { CheckTurn } from './turn';

function sqlTurn(...statements: string[]): CheckTurn {
  return {
    question: 'How many goals were scored of each goal type?',
    answer: '…',
    toolCalls: statements.map((sql) => ({
      name: 'run_readonly_sql',
      args: { sql, rationale: 'Why.' },
      argsReadable: true,
      result: { rows: [] },
    })),
  };
}

describe('qualifiedNames (R75, I6)', () => {
  it('accepts schema.table on PostgreSQL, and the three-part names the baseline used', () => {
    expect(
      qualifiedNames.evaluate(
        sqlTurn(
          'SELECT goal_type, COUNT(*) FROM world_cup.goals GROUP BY goal_type',
          'SELECT t.common_name FROM world_cup_ba9_baseline.world_cup.tournaments AS tour JOIN world_cup_ba9_baseline.world_cup.teams AS t ON tour.champion_team_id = t.id',
        ),
        {},
        { dialect: 'postgres' },
      ),
    ).toEqual({ passed: true });
  });

  it('fails a bare table name, naming it', () => {
    expect(
      qualifiedNames.evaluate(
        sqlTurn(
          'SELECT * FROM goals g JOIN world_cup.teams t ON t.id = g.team_id',
        ),
        {},
        { dialect: 'postgres' },
      ),
    ).toEqual({
      passed: false,
      reason:
        '"goals" is not fully qualified (schema.table): "SELECT * FROM goals g JOIN world_cup.teams t ON t.id = g.team_id"',
    });
  });

  it('needs api.schema.table on the REST set, and accepts it quoted', () => {
    const verdict = qualifiedNames.evaluate(
      sqlTurn('SELECT * FROM world_cup.goals'),
      {},
      { dialect: 'sqlite' },
    );
    expect(verdict.reason).toMatch(
      /^"world_cup.goals" is not fully qualified \(api.schema.table\)/,
    );
    expect(
      qualifiedNames.evaluate(
        sqlTurn(
          'SELECT * FROM api.world_cup.goals g JOIN "api.world_cup.matches" m ON m.id = g.match_id',
        ),
        {},
        { dialect: 'sqlite' },
      ).passed,
    ).toBe(true);
    expect(qualifiedNames.describe({}, { dialect: 'databricks' })).toBe(
      'Checks that every table in the SQL is fully qualified (catalog.schema.table)',
    );
  });

  it('does not count CTE names, and passes a turn with no SQL', () => {
    expect(
      qualifiedNames.evaluate(
        sqlTurn(
          'WITH totals AS (SELECT team_id, COUNT(*) n FROM world_cup.goals GROUP BY team_id) SELECT * FROM totals',
        ),
        {},
        { dialect: 'postgres' },
      ).passed,
    ).toBe(true);
    expect(
      qualifiedNames.evaluate(sqlTurn(), {}, { dialect: 'postgres' }).passed,
    ).toBe(true);
  });
});
