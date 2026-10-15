import { tableName, tableReferences, withoutLiterals } from './sql-text';

const names = (sql: string) =>
  tableReferences(sql).map((parts) => parts.join('.'));

describe('tableReferences (R111)', () => {
  it('reads FROM and JOIN names, aliased or not, with every name part', () => {
    expect(
      names(
        'SELECT home.common_name FROM world_cup.matches match JOIN world_cup.tournaments AS tournament ON tournament.id = match.tournament_id LEFT JOIN world_cup.teams home ON home.id = match.home_team_id',
      ),
    ).toEqual([
      'world_cup.matches',
      'world_cup.tournaments',
      'world_cup.teams',
    ]);
  });

  it('reads a comma list after FROM, and three-part and quoted names', () => {
    expect(names('SELECT * FROM a.x, b.y AS y2, c.z')).toEqual([
      'a.x',
      'b.y',
      'c.z',
    ]);
    expect(names('SELECT 1 FROM db.world_cup.goals g')).toEqual([
      'db.world_cup.goals',
    ]);
    expect(tableReferences('SELECT 1 FROM "api.world_cup.matches" m')).toEqual([
      ['api', 'world_cup', 'matches'],
    ]);
    expect(tableReferences('SELECT 1 FROM "world_cup"."matches"')).toEqual([
      ['world_cup', 'matches'],
    ]);
  });

  it('leaves out CTE names, subqueries and table functions, but reads inside them', () => {
    expect(
      names(
        'WITH totals AS (SELECT team_id FROM world_cup.goals), more AS (SELECT 1 FROM world_cup.teams) SELECT * FROM totals JOIN (SELECT id FROM world_cup.matches) m ON true CROSS JOIN generate_series(1, 3) s',
      ),
    ).toEqual(['world_cup.goals', 'world_cup.teams', 'world_cup.matches']);
    expect(names('WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r')).toEqual([]);
  });

  it('does not read the FROM of EXTRACT, SUBSTRING, TRIM or IS DISTINCT FROM', () => {
    expect(
      names(
        "SELECT EXTRACT(YEAR FROM kicked_off_at), SUBSTRING(name FROM 1 FOR 3), TRIM(BOTH ' ' FROM name) FROM world_cup.matches WHERE a IS DISTINCT FROM b",
      ),
    ).toEqual(['world_cup.matches']);
  });

  it('ignores names in comments and string literals', () => {
    expect(
      names(
        "SELECT 'FROM fake.table' AS s FROM real.table -- JOIN other.one\n/* FROM x.y */",
      ),
    ).toEqual(['real.table']);
  });

  it('returns nothing for a statement with no table', () => {
    expect(tableReferences('SELECT 1')).toEqual([]);
    expect(tableReferences('')).toEqual([]);
  });
});

describe('tableName', () => {
  it('is the last name part, lowercased', () => {
    expect(tableName(['API', 'World_Cup', 'Goals'])).toBe('goals');
  });
});

describe('withoutLiterals', () => {
  it('empties string literals and drops comments, keeping quoted names', () => {
    expect(
      withoutLiterals(
        "SELECT 'a::b' , \"x\" -- ILIKE\nFROM t /* :: */ WHERE n = 'it''s'",
      ),
    ).toBe("SELECT '' , \"x\"  \nFROM t   WHERE n = ''");
  });
});
