import { clip, redactSqlLiterals } from './redact';

describe('redactSqlLiterals', () => {
  it('replaces a string literal the question never mentioned', () => {
    expect(
      redactSqlLiterals(
        "SELECT count(*) FROM main.crm.customers WHERE email = 'ana@example.com'",
        'How many customers have that email?',
      ),
    ).toBe("SELECT count(*) FROM main.crm.customers WHERE email = '?'");
  });

  it('keeps a literal the user typed into the question, case-insensitively', () => {
    expect(
      redactSqlLiterals(
        "SELECT count(*) FROM matches WHERE winner = 'Argentina'",
        'How many matches did argentina win?',
      ),
    ).toBe("SELECT count(*) FROM matches WHERE winner = 'Argentina'");
  });

  it('ignores LIKE wildcards when matching the question', () => {
    expect(
      redactSqlLiterals(
        "SELECT * FROM teams WHERE name LIKE '%Brazil%' OR name LIKE '%Peru%'",
        'Matches of Brazil',
      ),
    ).toBe("SELECT * FROM teams WHERE name LIKE '%Brazil%' OR name LIKE '?'");
  });

  it('keeps numbers and identifiers, and handles escaped quotes', () => {
    expect(
      redactSqlLiterals(
        `SELECT "Team", count(*) FROM t WHERE year >= 2018 AND note = 'it''s O\\'Neil' LIMIT 10`,
        'Teams since 2018',
      ),
    ).toBe(
      `SELECT "Team", count(*) FROM t WHERE year >= 2018 AND note = '?' LIMIT 10`,
    );
  });

  it('keeps category codes (statuses, enums), not capitalised words or emails', () => {
    expect(
      redactSqlLiterals(
        "SELECT 1 FROM goals WHERE goal_type <> 'own_goal' AND stage = 'round_of_16' AND team = 'Croatia' AND pos = 'gk' AND status = 'completed' AND po = 'RECEIVED' AND email = 'ana@x.io' AND who = 'Garcia'",
        'top scorer excluding own goals',
      ),
    ).toBe(
      "SELECT 1 FROM goals WHERE goal_type <> 'own_goal' AND stage = 'round_of_16' AND team = '?' AND pos = 'gk' AND status = 'completed' AND po = 'RECEIVED' AND email = '?' AND who = '?'",
    );
  });

  it('leaves an empty literal alone', () => {
    expect(redactSqlLiterals("SELECT 1 WHERE x <> ''", 'q')).toBe(
      "SELECT 1 WHERE x <> ''",
    );
  });
});

describe('clip', () => {
  it('returns short text unchanged', () => {
    expect(clip('abc', 5)).toBe('abc');
  });

  it('cuts long text to the limit, marking the cut', () => {
    const clipped = clip('a'.repeat(3_000), 2_000);
    expect(clipped).toHaveLength(2_000);
    expect(clipped.endsWith('…')).toBe(true);
  });
});
