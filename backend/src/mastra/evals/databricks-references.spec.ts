import { findFixture } from '../../modules/testing-data/fixtures/registry';
import { dialectProblem } from './checks/dialect';
import { tableReferences, tokenizeSql } from './checks/sql-text';
import { referenceInCatalog, REFERENCE_CATALOG } from './databricks-catalog';
import { loadEvalSets, type EvalSetDefinition } from './eval-sets';

/**
 * PostgreSQL constructs a Databricks reference must not carry, beyond what
 * the `dialect` check (agents-evals R74) already refuses: `::` (Databricks
 * accepts it, but `::numeric` is DECIMAL(10,0) there and drops the fraction)
 * and functions Databricks does not have.
 */
const POSTGRES_ONLY: readonly [RegExp, string][] = [
  [/::/, "a '::' cast"],
  [/\bAGE\s*\(/i, 'age()'],
  [/\bTO_CHAR\s*\(/i, 'to_char() with PostgreSQL patterns'],
  [/\bGENERATE_SERIES\s*\(/i, 'generate_series()'],
  [/\bSTRING_TO_ARRAY\s*\(/i, 'string_to_array()'],
];

/**
 * Why a Databricks reference would not run on the loaded sample, read
 * without a warehouse (agents-evals R144): a construct of another dialect, or
 * a table reference that is not `` `<catalog>`.<schema>.<table> `` with the
 * catalog backticked and the table one the sample loads. The catalog is the
 * canonical `evals` of the set files, or the one a reference was rewritten
 * to (R148).
 */
function databricksReferenceProblem(
  sql: string,
  schema: string,
  tables: readonly string[],
  expectedCatalog: string = REFERENCE_CATALOG,
): string | undefined {
  const construct = dialectProblem(sql, 'databricks');
  if (construct) return `uses ${construct}`;
  for (const [pattern, what] of POSTGRES_ONLY) {
    if (pattern.test(sql.replace(/'(?:[^'\\]|\\.)*'/g, "''"))) {
      return `uses ${what}`;
    }
  }
  const references = tableReferences(sql);
  if (references.length === 0) return 'reads no table';
  for (const parts of references) {
    const name = parts.join('.');
    if (parts.length !== 3) return `${name} is not catalog.schema.table`;
    const [catalog, owner, table] = parts.map((part) => part.toLowerCase());
    if (catalog !== expectedCatalog.toLowerCase()) {
      return `${name} is not in catalog ${expectedCatalog}`;
    }
    if (owner !== schema) return `${name} is not in schema ${schema}`;
    if (!tables.includes(table)) return `${name} is not a table of the sample`;
  }
  // The catalog is written backticked wherever it appears as a name part.
  const tokens = tokenizeSql(sql);
  const bare = tokens.find(
    (token, index) =>
      token.kind === 'word' &&
      token.text === expectedCatalog.toLowerCase() &&
      tokens[index + 1]?.text === '.',
  );
  if (bare) return `the catalog ${expectedCatalog} is not backticked`;
  return undefined;
}

const SETS = loadEvalSets();
const DATABRICKS_SETS = SETS.filter((set) => set.dialect === 'databricks');

/** The set's references, as written or rewritten to `catalog` (R148). */
function problems(
  set: EvalSetDefinition,
  catalog: string = REFERENCE_CATALOG,
): string[] {
  const fixture = findFixture(set.fixtureId);
  if (!fixture) return [`${set.id}: unknown fixture ${set.fixtureId}`];
  return set.cases.flatMap((evalCase) => {
    if (!evalCase.expectedSql) return [];
    const problem = databricksReferenceProblem(
      referenceInCatalog(evalCase.expectedSql, catalog),
      fixture.schema,
      fixture.requiredTables,
      catalog,
    );
    return problem ? [`${evalCase.id}: ${problem}`] : [];
  });
}

describe('the static check of a Databricks reference (agents-evals R144)', () => {
  const TABLES = ['matches', 'tournaments'];
  it('passes a backticked three-part reference in Databricks SQL', () => {
    expect(
      databricksReferenceProblem(
        "SELECT date_format(m.kicked_off_at, 'EEEE') FROM `evals`.world_cup.matches m " +
          'JOIN `evals`.`world_cup`.`tournaments` t ON t.id = m.tournament_id QUALIFY 1 = 1',
        'world_cup',
        TABLES,
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      'SELECT * FROM world_cup.matches',
      'world_cup.matches is not catalog.schema.table',
    ],
    [
      'SELECT * FROM evals.world_cup.matches',
      'the catalog evals is not backticked',
    ],
    [
      'SELECT * FROM `main`.world_cup.matches',
      'main.world_cup.matches is not in catalog evals',
    ],
    [
      'SELECT * FROM `evals`.finance.matches',
      'evals.finance.matches is not in schema world_cup',
    ],
    [
      'SELECT * FROM `evals`.world_cup.countries',
      'is not a table of the sample',
    ],
    [
      'SELECT SUM(a)::numeric FROM `evals`.world_cup.matches',
      "uses a '::' cast",
    ],
    ['SELECT age(x) FROM `evals`.world_cup.matches', 'uses age()'],
    ['SELECT * FROM "evals"."world_cup"."matches"', 'uses double-quoted names'],
    [
      'SELECT DISTINCT ON (a) a FROM `evals`.world_cup.matches',
      'uses DISTINCT ON',
    ],
    ['SELECT 1', 'reads no table'],
  ])('refuses %s', (sql, problem) => {
    expect(databricksReferenceProblem(sql, 'world_cup', TABLES)).toContain(
      problem,
    );
  });

  it('ignores the constructs inside a string literal', () => {
    expect(
      databricksReferenceProblem(
        "SELECT 'a::b age(' FROM `evals`.world_cup.matches",
        'world_cup',
        TABLES,
      ),
    ).toBeUndefined();
  });
});

describe('the Databricks-only World Cup set (agents-evals R145 to R147)', () => {
  const set = SETS.find(
    (candidate) => candidate.id === 'world-cup-databricks-only',
  );

  it('is bound to the World Cup Databricks sample, ten questions, the cold-start one first', () => {
    expect(set).toMatchObject({
      name: 'World Cup (Databricks only)',
      fixtureId: 'world-cup-databricks',
      dialect: 'databricks',
      file: 'world-cup-databricks-only.json',
    });
    expect(set?.cases.map((evalCase) => evalCase.id)).toEqual([
      'dbx-only-matches-per-tournament',
      'dbx-only-top-attendance-per-tournament',
      'dbx-only-final-weekday',
      'dbx-only-tournament-length-days',
      'dbx-only-shot-share-on-target-by-tournament',
      'dbx-only-average-possession-by-team-2018',
      'dbx-only-browse-only-player-contracts',
      'dbx-only-median-attendance-2022',
      'dbx-only-goals-by-stage-per-tournament',
      'dbx-only-youngest-scorer-2022',
    ]);
    expect(set?.cases[0].tags).toEqual(['dbx:latency']);
  });

  it('tags every question with a dbx: tag and holds every one to the Databricks dialect', () => {
    for (const evalCase of set?.cases ?? []) {
      expect([evalCase.id, evalCase.split]).toEqual([evalCase.id, 'dev']);
      expect(evalCase.tags.length).toBeGreaterThan(0);
      for (const tag of evalCase.tags) expect(tag).toMatch(/^dbx:/);
      const types = evalCase.checks.map((check) => check.type);
      expect([evalCase.id, types]).toEqual([
        evalCase.id,
        expect.arrayContaining(['dialect', 'qualifiedNames', 'noHtml']),
      ]);
      for (const check of evalCase.checks) {
        expect([evalCase.id, check.type, check.criterion]).toEqual([
          evalCase.id,
          check.type,
          expect.stringMatching(/^[DGIC]\d$/),
        ]);
      }
    }
    const tags = new Set(set?.cases.flatMap((evalCase) => evalCase.tags));
    expect([...tags].sort()).toEqual([
      'dbx:browse-only',
      'dbx:dialect',
      'dbx:latency',
      'dbx:numeric',
    ]);
  });

  it('gives every question but the browse-only one a reference, and guards that one against fabrication', () => {
    const withoutReference = (set?.cases ?? []).filter(
      (evalCase) => !evalCase.expectedSql,
    );
    expect(withoutReference.map((evalCase) => evalCase.id)).toEqual([
      'dbx-only-browse-only-player-contracts',
    ]);
    const browseOnly = withoutReference[0];
    expect(browseOnly.category).toBe('out-of-scope');
    expect(
      browseOnly.checks
        .filter((check) => check.criterion === 'G2')
        .map((check) => check.type),
    ).toEqual(['didNotCall', 'matches', 'notMatches']);
    expect(browseOnly.checks.map((check) => check.type)).not.toContain(
      'noToolErrors',
    );
  });

  it('uses the Databricks constructs it is about', () => {
    const sql = (id: string) =>
      set?.cases.find((evalCase) => evalCase.id === `dbx-only-${id}`)
        ?.expectedSql ?? '';
    expect(sql('top-attendance-per-tournament')).toMatch(
      /\bQUALIFY RANK\(\) OVER/,
    );
    expect(sql('final-weekday')).toContain(
      "date_format(m.kicked_off_at, 'EEEE')",
    );
    expect(sql('tournament-length-days')).toContain(
      'datediff(ends_on, starts_on)',
    );
    expect(sql('median-attendance-2022')).toContain('median(m.attendance)');
    expect(sql('goals-by-stage-per-tournament')).toContain('COUNT_IF(');
    expect(sql('youngest-scorer-2022')).toContain('months_between(');
  });

  it('has references that pass the static check', () => {
    expect(set ? problems(set) : ['no set']).toEqual([]);
  });
});

describe('every Databricks reference of every set', () => {
  it('runs in another catalog once rewritten: every table then names that catalog, backticked (R148)', () => {
    for (const catalog of ['dev_sandbox', 'team-data']) {
      expect(
        DATABRICKS_SETS.flatMap((set) =>
          problems(set, catalog).map((p) => `${set.id} ${p}`),
        ),
      ).toEqual([]);
    }
  });

  it('passes the static check (backticked catalog, three parts, a table of the sample, no PostgreSQL-only syntax)', () => {
    expect(DATABRICKS_SETS.length).toBeGreaterThan(0);
    expect(
      DATABRICKS_SETS.flatMap((set) =>
        problems(set).map((p) => `${set.id} ${p}`),
      ),
    ).toEqual([]);
  });
});
