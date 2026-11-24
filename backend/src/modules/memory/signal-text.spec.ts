import {
  SIGNAL_NOTE_CHARS,
  SIGNAL_SQL_CHARS,
  clip,
  redactSqlLiterals,
  signalText,
} from './signal-text';

describe('redactSqlLiterals (knowledge R32)', () => {
  it('replaces a capitalised name the question never mentioned', () => {
    expect(
      redactSqlLiterals(
        "SELECT count(*) FROM goals WHERE player = 'Lionel Messi'",
        'How many goals did the top scorer of 2022 score?',
      ),
    ).toBe("SELECT count(*) FROM goals WHERE player = '?'");
  });

  it('replaces an email', () => {
    expect(
      redactSqlLiterals(
        "SELECT 1 FROM crm.customers WHERE email = 'ana@example.com'",
        'How many customers have that email?',
      ),
    ).toBe("SELECT 1 FROM crm.customers WHERE email = '?'");
  });

  it('keeps category codes: lowercase, uppercase, with digits and underscores', () => {
    expect(
      redactSqlLiterals(
        "SELECT 1 FROM g WHERE t <> 'own_goal' AND s = 'round_of_16' AND st = 'SETTLED' AND p = 'DF' AND x = 'completed'",
        'top scorer',
      ),
    ).toBe(
      "SELECT 1 FROM g WHERE t <> 'own_goal' AND s = 'round_of_16' AND st = 'SETTLED' AND p = 'DF' AND x = 'completed'",
    );
  });

  it('does not take a mixed-case or over-long token for a code', () => {
    expect(
      redactSqlLiterals(
        "SELECT 1 FROM t WHERE a = 'Own_goal' AND b = 'abcdefghijklmnopqrstuvwxyz'",
        'q',
      ),
    ).toBe("SELECT 1 FROM t WHERE a = '?' AND b = '?'");
  });

  it('keeps a literal that appears in the question, ignoring case', () => {
    expect(
      redactSqlLiterals(
        "SELECT count(*) FROM matches WHERE winner = 'Argentina'",
        'How many matches did argentina win?',
      ),
    ).toBe("SELECT count(*) FROM matches WHERE winner = 'Argentina'");
  });

  it('ignores LIKE wildcards at either end when matching the question', () => {
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

describe('signalText (knowledge R33)', () => {
  const base = {
    occurredAt: '2026-10-05T23:30:00.000Z',
    question: 'Who was the top scorer of the 2018 World Cup?',
    sql: "SELECT player FROM goals WHERE type <> 'own_goal' AND team = 'Croatia'",
  };

  it('writes an approval', () => {
    expect(signalText({ ...base, kind: 'verified_query' })).toBe(
      [
        '[verified_query · 2026-10-05]',
        'Question: Who was the top scorer of the 2018 World Cup?',
        "Approved SQL: SELECT player FROM goals WHERE type <> 'own_goal' AND team = '?'",
      ].join('\n'),
    );
  });

  it('writes a correction whose SQL is not to be reused', () => {
    const text = signalText({
      ...base,
      kind: 'correction',
      note: '  A shoot-out is a draw.  ',
    });
    expect(text).toBe(
      [
        '[correction · 2026-10-05]',
        'Question: Who was the top scorer of the 2018 World Cup?',
        "Corrected SQL (do not reuse): SELECT player FROM goals WHERE type <> 'own_goal' AND team = '?'",
        'Analyst note: A shoot-out is a draw.',
      ].join('\n'),
    );
    expect(text).not.toMatch(/Approved SQL|Final SQL/);
  });

  it('writes a rejection with its note line only when it has a note', () => {
    expect(
      signalText({ ...base, kind: 'rejection', note: 'Wrong team.' }),
    ).toBe(
      [
        '[rejection · 2026-10-05]',
        'Question: Who was the top scorer of the 2018 World Cup?',
        "Rejected SQL (do not reuse): SELECT player FROM goals WHERE type <> 'own_goal' AND team = '?'",
        'Analyst note: Wrong team.',
      ].join('\n'),
    );
    const bare = signalText({ ...base, kind: 'rejection', note: '   ' });
    expect(bare.split('\n')).toHaveLength(3);
    expect(bare).not.toContain('Analyst note');
  });

  it('dates the signal by the UTC day of the answer', () => {
    expect(
      signalText({
        ...base,
        kind: 'verified_query',
        occurredAt: '2026-10-06T01:00:00.000+05:00',
      }).split('\n')[0],
    ).toBe('[verified_query · 2026-10-05]');
  });

  it('clips the SQL at 2,000 characters and the note at 1,000', () => {
    const text = signalText({
      ...base,
      kind: 'rejection',
      sql: `SELECT ${'x'.repeat(3_000)}`,
      note: 'n'.repeat(1_500),
    });
    const [, , sqlLine, noteLine] = text.split('\n');
    const sql = sqlLine.slice('Rejected SQL (do not reuse): '.length);
    const note = noteLine.slice('Analyst note: '.length);
    expect(sql).toHaveLength(SIGNAL_SQL_CHARS);
    expect(sql.endsWith('…')).toBe(true);
    expect(note).toHaveLength(SIGNAL_NOTE_CHARS);
    expect(note.endsWith('…')).toBe(true);
  });
});
