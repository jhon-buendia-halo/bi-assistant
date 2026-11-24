import Database from 'better-sqlite3';
import { dialect, dialectProblem } from './dialect';
import type { CheckToolCall, CheckTurn } from './turn';

function sqlTurn(...statements: string[]): CheckTurn {
  return {
    question: 'Which knockout matches went to a penalty shootout?',
    answer: '…',
    toolCalls: statements.map((sql): CheckToolCall => ({
      name: 'run_readonly_sql',
      args: { sql, rationale: 'Why.' },
      argsReadable: true,
      result: { rows: [] },
    })),
  };
}

describe('dialect (R118, I6)', () => {
  it('fails PostgreSQL syntax on the REST set (SQLite), naming it', () => {
    expect(
      dialect.evaluate(
        sqlTurn(
          'SELECT 1 FROM api.world_cup.goals',
          "SELECT name FROM api.world_cup.players WHERE full_name ILIKE '%Pelé%'",
        ),
        {},
        { dialect: 'sqlite' },
      ),
    ).toEqual({
      passed: false,
      reason:
        'the SQL uses ILIKE, which SQLite (the REST connector) does not support: "SELECT name FROM api.world_cup.players WHERE full_name ILIKE \'%Pelé%\'"',
    });
    // The same statement is fine on the PostgreSQL set.
    expect(
      dialect.evaluate(
        sqlTurn(
          "SELECT name FROM world_cup.players WHERE full_name ILIKE '%Pelé%'",
        ),
        {},
        { dialect: 'postgres' },
      ).passed,
    ).toBe(true);
  });

  it('reads the SQL as written, including a call that failed or was repaired', () => {
    const turn = sqlTurn('SELECT goals::numeric FROM api.world_cup.goals');
    turn.toolCalls[0].error = 'unrecognized token: ":"';
    expect(dialect.evaluate(turn, {}, { dialect: 'sqlite' }).reason).toMatch(
      /^the SQL uses "::" casts, which SQLite/,
    );
  });

  it('fails Databricks and SQLite syntax on PostgreSQL, and quoted names on Databricks', () => {
    expect(
      dialectProblem('SELECT `name` FROM world_cup.teams', 'postgres'),
    ).toBe('backtick-quoted names');
    expect(dialectProblem('SELECT IFNULL(a, 0) FROM t', 'postgres')).toBe(
      'IFNULL',
    );
    expect(
      dialectProblem('SELECT * FROM "world_cup"."matches"', 'databricks'),
    ).toBe('double-quoted names (read as strings)');
    expect(
      dialectProblem('SELECT * FROM `cat`.`world_cup`.`matches`', 'databricks'),
    ).toBeUndefined();
  });

  it('ignores syntax inside string literals and comments, and passes a turn with no SQL', () => {
    expect(
      dialectProblem(
        "SELECT 'a::b ILIKE' AS s FROM api.world_cup.goals -- ILIKE\n/* :: */",
        'sqlite',
      ),
    ).toBeUndefined();
    expect(dialect.evaluate(sqlTurn(), {}, { dialect: 'sqlite' }).passed).toBe(
      true,
    );
  });

  it('describes itself with the set’s dialect', () => {
    expect(dialect.describe({}, { dialect: 'sqlite' })).toBe(
      'Checks that the SQL fits the SQLite (the REST connector) dialect',
    );
    expect(dialect.describe({}, { dialect: 'postgres' })).toBe(
      'Checks that the SQL fits the PostgreSQL dialect',
    );
  });

  describe('pinned against the SQLite the REST connector bundles', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER, s TEXT, d TEXT)');
    const runs = (sql: string): boolean => {
      try {
        db.prepare(sql).all();
        return true;
      } catch {
        return false;
      }
    };

    it.each([
      'SELECT x::int FROM t',
      "SELECT x FROM t WHERE s ILIKE 'a'",
      "SELECT x FROM t WHERE s SIMILAR TO 'a'",
      'SELECT DISTINCT ON (x) x FROM t',
      'SELECT x FROM t QUALIFY x = 1',
      "SELECT INTERVAL '1 day'",
      'SELECT EXTRACT(YEAR FROM d) FROM t',
      "SELECT DATE_TRUNC('day', d) FROM t",
      'SELECT TO_CHAR(x) FROM t',
      'SELECT NOW()',
      'SELECT GREATEST(1, 2)',
      'SELECT LEAST(1, 2)',
    ])('flags what SQLite cannot run: %s', (sql) => {
      expect(runs(sql)).toBe(false);
      expect(dialectProblem(sql, 'sqlite')).toBeDefined();
    });

    it.each([
      // Runs on the bundled SQLite (3.53), so it is not flagged.
      'SELECT COUNT(*) FILTER (WHERE x > 0) FROM t',
      'SELECT match.x FROM t AS match WHERE match.x = 1',
      'SELECT `x` FROM t',
      "SELECT strftime('%Y', d) FROM t",
      'SELECT CAST(x AS NUMERIC) FROM t',
      'SELECT x FROM t WHERE x IS DISTINCT FROM 2',
    ])('does not flag what SQLite runs: %s', (sql) => {
      expect(runs(sql)).toBe(true);
      expect(dialectProblem(sql, 'sqlite')).toBeUndefined();
    });
  });
});
