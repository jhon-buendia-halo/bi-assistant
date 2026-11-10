import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DATABRICKS_FIXTURE_CATALOG,
  SAMPLE_FIXTURES,
  databricksSource,
} from '../fixtures/registry';
import {
  buildLoadPlan,
  createTableSql,
  databricksFixtureSources,
  databricksType,
  findDumpDirectory,
  FixtureLoadError,
  formatPlan,
  inferSourceType,
  insertStatements,
  planStatements,
  qualifiedName,
  quoteIdent,
  readFixtureDump,
  readSeedSql,
  resolveColumns,
  resolveDatabricksFixture,
  rowCountProblems,
  runLoadPlan,
  seedTableColumns,
  sqlLiteral,
  stringLiteral,
  type LoadColumn,
  type LoadPlan,
  type SqlRunner,
} from './fixture-load';

const BACKEND_ROOT = join(__dirname, '..', '..', '..', '..');
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const TARGET = { catalog: 'evals', schema: 'world_cup' };

function column(type: string, nullable = true, name = 'c'): LoadColumn {
  return { name, sourceType: '', typeFrom: 'seed', type, nullable };
}

/** The real plan for one of the three samples, from the committed dump and seed. */
function realPlan(
  sourceId: string,
  target?: { catalog: string; schema: string },
): LoadPlan {
  const { fixture, source } = resolveDatabricksFixture(sourceId);
  return buildLoadPlan({
    fixture,
    source,
    dump: readFixtureDump(findDumpDirectory(BACKEND_ROOT, source.id)),
    seedSql: readSeedSql(FIXTURES_DIR, source),
    target: target ?? {
      catalog: DATABRICKS_FIXTURE_CATALOG,
      schema: fixture.schema,
    },
  });
}

/**
 * A warehouse that keeps only row counts: CREATE OR REPLACE empties a table,
 * an INSERT adds one row per value line, the count query reads them back
 * (as bigint, the way the driver may return a COUNT).
 */
function fakeWarehouse(options: { dropOne?: string } = {}) {
  const tables = new Map<string, number>();
  const statements: string[] = [];
  const runner: SqlRunner = {
    run: (sql) => {
      statements.push(sql);
      const create = /^CREATE OR REPLACE TABLE (\S+) \(/.exec(sql);
      if (create) tables.set(create[1], 0);
      const insert = /^INSERT INTO (\S+) \(/.exec(sql);
      if (insert) {
        if (!tables.has(insert[1]))
          throw new Error(`TABLE_OR_VIEW_NOT_FOUND ${insert[1]}`);
        const rows = sql
          .split('\n')
          .filter((line) => line.startsWith('  (')).length;
        const lost =
          options.dropOne && insert[1].endsWith(`\`${options.dropOne}\``)
            ? 1
            : 0;
        tables.set(insert[1], (tables.get(insert[1]) ?? 0) + rows - lost);
      }
      if (sql.startsWith("SELECT '")) {
        return Promise.resolve(
          sql.split('\nUNION ALL\n').map((part) => {
            const [, relation, table] =
              /^SELECT '([^']+)' AS relation, COUNT\(\*\) AS row_count FROM (\S+)$/.exec(
                part,
              ) ?? [];
            return { relation, row_count: BigInt(tables.get(table) ?? 0) };
          }),
        );
      }
      return Promise.resolve([]);
    },
  };
  return { runner, tables, statements };
}

describe('Databricks column types', () => {
  it.each([
    ['bigint', 'BIGINT'],
    ['integer', 'INT'],
    ['smallint', 'SMALLINT'],
    ['numeric(5,2)', 'DECIMAL(5,2)'],
    ['numeric(18, 4)', 'DECIMAL(18,4)'],
    ['numeric(10)', 'DECIMAL(10,0)'],
    ['double precision', 'DOUBLE'],
    ['real', 'FLOAT'],
    ['text', 'STRING'],
    ['char(3)', 'STRING'],
    ['character', 'STRING'],
    ['character varying(20)', 'STRING'],
    ['boolean', 'BOOLEAN'],
    ['date', 'DATE'],
    ['timestamptz', 'TIMESTAMP'],
    ['timestamp with time zone', 'TIMESTAMP'],
    ['timestamp without time zone', 'TIMESTAMP_NTZ'],
    ['jsonb', 'STRING'],
  ])('maps PostgreSQL %s to %s', (source, expected) => {
    expect(databricksType(source)).toBe(expected);
  });

  it('gives a bare numeric the most decimals its values carry', () => {
    expect(databricksType('numeric', [1.082955, 1.5, null, 2])).toBe(
      'DECIMAL(38,6)',
    );
    expect(databricksType('numeric', [3, 4])).toBe('DECIMAL(38,0)');
  });

  it('refuses a type it cannot map, or a decimal Databricks cannot hold', () => {
    expect(() => databricksType('int4range')).toThrow(
      'no Databricks type for the PostgreSQL type "int4range"',
    );
    expect(() => databricksType('numeric(40,2)')).toThrow('precision 1 to 38');
  });

  it('infers a type from values when the dump records none', () => {
    expect(inferSourceType([1, 2, null])).toBe('bigint');
    expect(inferSourceType([1, 2.5])).toBe('double precision');
    expect(inferSourceType(['2018-07-15', null])).toBe('date');
    expect(inferSourceType(['2022-12-18T15:00:00.000Z'])).toBe(
      'timestamp with time zone',
    );
    expect(inferSourceType([true, false])).toBe('boolean');
    expect(inferSourceType(['France', '2018-07-15'])).toBe('text');
    expect(inferSourceType([null, null])).toBe('text');
    expect(() => inferSourceType([1, 'one'])).toThrow('mixed kinds');
  });
});

describe('the seed DDL', () => {
  it('reads each CREATE TABLE with its declared types and NOT NULLs', () => {
    const tables = seedTableColumns(`
      CREATE TABLE world_cup.squad_members (
        tournament_team_id bigint NOT NULL REFERENCES tournament_teams(id),
        player_id bigint,
        squad_position text CHECK (squad_position IN ('GK', 'DF')), -- a comment, with a comma
        possession_pct numeric(5,2) NOT NULL CHECK (possession_pct BETWEEN 0 AND 100),
        PRIMARY KEY (tournament_team_id, player_id),
        UNIQUE (tournament_team_id, squad_position)
      );
      CREATE VIEW v AS SELECT 1;`);
    expect([...tables.keys()]).toEqual(['squad_members']);
    expect(tables.get('squad_members')).toEqual([
      { name: 'tournament_team_id', type: 'bigint', nullable: false },
      { name: 'player_id', type: 'bigint', nullable: false },
      { name: 'squad_position', type: 'text', nullable: true },
      { name: 'possession_pct', type: 'numeric(5,2)', nullable: false },
    ]);
  });

  it('reads the World Cup seed: twelve tables, precise numerics, nullable foreign keys', () => {
    const tables = seedTableColumns(
      readFileSync(join(FIXTURES_DIR, '001_world_cup.sql'), 'utf8'),
    );
    expect(tables.size).toBe(12);
    const stats = tables.get('match_team_statistics') ?? [];
    expect(stats.find((c) => c.name === 'expected_goals')).toEqual({
      name: 'expected_goals',
      type: 'numeric(5,2)',
      nullable: false,
    });
    const matches = tables.get('matches') ?? [];
    expect(matches.find((c) => c.name === 'kicked_off_at')?.type).toBe(
      'timestamptz',
    );
    expect(matches.find((c) => c.name === 'winner_team_id')?.nullable).toBe(
      true,
    );
    expect(matches.find((c) => c.name === 'id')?.nullable).toBe(false);
  });
});

describe('literals', () => {
  it('escapes a string the way Databricks reads it: backslash escapes, never doubled quotes', () => {
    expect(stringLiteral("Côte d'Ivoire")).toBe("'Côte d\\'Ivoire'");
    expect(stringLiteral('C:\\temp')).toBe("'C:\\\\temp'");
    expect(stringLiteral('two\nlines\tand\r')).toBe("'two\\nlines\\tand\\r'");
    expect(stringLiteral('bell\u0007')).toBe("'bell\\u0007'");
    expect(stringLiteral('')).toBe("''");
  });

  it('backticks identifiers, doubling a backtick', () => {
    expect(quoteIdent('matches')).toBe('`matches`');
    expect(quoteIdent('odd`name')).toBe('`odd``name`');
    expect(qualifiedName(TARGET, 'goals')).toBe('`evals`.`world_cup`.`goals`');
  });

  it('writes NULLs, booleans, whole numbers and their ranges', () => {
    expect(sqlLiteral(null, column('INT'))).toBe('NULL');
    expect(() => sqlLiteral(null, column('INT', false))).toThrow(
      'column c (INT): NULL in a NOT NULL column',
    );
    expect(sqlLiteral(true, column('BOOLEAN'))).toBe('TRUE');
    expect(sqlLiteral(false, column('BOOLEAN'))).toBe('FALSE');
    expect(() => sqlLiteral('true', column('BOOLEAN'))).toThrow(
      'is not a boolean',
    );
    expect(sqlLiteral(88966, column('INT'))).toBe('88966');
    expect(sqlLiteral(9_007_199_254_740_991, column('BIGINT'))).toBe(
      '9007199254740991',
    );
    expect(() => sqlLiteral(2_147_483_648, column('INT'))).toThrow(
      'out of range',
    );
    expect(() => sqlLiteral(1.5, column('BIGINT'))).toThrow(
      'not a whole number',
    );
  });

  it('writes decimals at their scale and refuses one that would lose digits', () => {
    expect(sqlLiteral(2.75, column('DECIMAL(5,2)'))).toBe('2.75');
    expect(sqlLiteral(46, column('DECIMAL(5,2)'))).toBe('46.00');
    expect(sqlLiteral(-0.5, column('DECIMAL(5,2)'))).toBe('-0.50');
    expect(sqlLiteral(3005.2223, column('DECIMAL(18,4)'))).toBe('3005.2223');
    expect(() => sqlLiteral(1.234, column('DECIMAL(5,2)'))).toThrow(
      'more than 2 decimals',
    );
    expect(() => sqlLiteral(1234, column('DECIMAL(5,2)'))).toThrow(
      'more than 3 integer digits',
    );
    expect(() => sqlLiteral('2.75', column('DECIMAL(5,2)'))).toThrow(
      'is not a number',
    );
    expect(sqlLiteral(0.1, column('DOUBLE'))).toBe('0.1');
  });

  it('writes dates and timestamps as typed literals', () => {
    expect(sqlLiteral('2018-07-15', column('DATE'))).toBe("DATE'2018-07-15'");
    expect(() => sqlLiteral('15/07/2018', column('DATE'))).toThrow(
      'YYYY-MM-DD',
    );
    expect(sqlLiteral('2022-12-18T15:00:00.000Z', column('TIMESTAMP'))).toBe(
      "TIMESTAMP'2022-12-18T15:00:00.000Z'",
    );
    expect(
      sqlLiteral('2022-12-18T15:00:00.000Z', column('TIMESTAMP_NTZ')),
    ).toBe("TIMESTAMP_NTZ'2022-12-18 15:00:00.000'");
    expect(() => sqlLiteral('soon', column('TIMESTAMP'))).toThrow(
      'not a timestamp',
    );
  });

  it('writes text, numbers held as text and JSON values as escaped strings', () => {
    expect(sqlLiteral("O'Brien", column('STRING'))).toBe("'O\\'Brien'");
    expect(sqlLiteral(7, column('STRING'))).toBe("'7'");
    expect(sqlLiteral({ a: "b'c" }, column('STRING'))).toBe(
      '\'{"a":"b\\\'c"}\'',
    );
  });
});

describe('statements', () => {
  const columns = [
    column('BIGINT', false, 'id'),
    column('STRING', true, 'name'),
  ];
  const rows = [1, 2, 3, 4, 5].map((id) => ({ id, name: `team ${id}` }));
  const fq = qualifiedName(TARGET, 'teams');

  it('creates the table with backticked columns and NOT NULL where the source has it', () => {
    expect(createTableSql(fq, columns)).toBe(
      'CREATE OR REPLACE TABLE `evals`.`world_cup`.`teams` (\n' +
        '  `id` BIGINT NOT NULL,\n' +
        '  `name` STRING\n' +
        ')',
    );
  });

  it('inserts one row per line, in batches of at most the row limit', () => {
    const statements = insertStatements(fq, columns, rows, {
      rows: 2,
      chars: 1_000_000,
    });
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe(
      'INSERT INTO `evals`.`world_cup`.`teams` (`id`, `name`) VALUES\n' +
        "  (1, 'team 1'),\n" +
        "  (2, 'team 2')",
    );
    expect(statements[2]).toBe(
      "INSERT INTO `evals`.`world_cup`.`teams` (`id`, `name`) VALUES\n  (5, 'team 5')",
    );
  });

  it('closes a batch before it passes the character limit, and sends an oversized row alone', () => {
    const head =
      'INSERT INTO `evals`.`world_cup`.`teams` (`id`, `name`) VALUES\n'.length;
    const row = "  (1, 'team 1')".length;
    // Room for two rows and their separator, not three.
    const statements = insertStatements(fq, columns, rows, {
      rows: 100,
      chars: head + row * 2 + 2,
    });
    expect(statements.map((s) => s.split('\n').length - 1)).toEqual([2, 2, 1]);
    for (const statement of statements) {
      expect(statement.length).toBeLessThanOrEqual(head + row * 2 + 2);
    }
    expect(
      insertStatements(fq, columns, rows.slice(0, 2), { rows: 100, chars: 10 }),
    ).toHaveLength(2);
    expect(insertStatements(fq, columns, [])).toEqual([]);
  });

  it('names the row and the column of a value that does not fit', () => {
    expect(() =>
      insertStatements(fq, columns, [
        { id: 1, name: 'a' },
        { id: null, name: 'b' },
      ]),
    ).toThrow('row 2, column id (BIGINT): NULL in a NOT NULL column');
  });
});

describe('the dump', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ba186-dump-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses a relation whose row count differs from _meta.json', () => {
    writeFileSync(
      join(dir, '_meta.json'),
      JSON.stringify({ tables: { teams: 2 } }),
    );
    writeFileSync(join(dir, 'teams.json'), JSON.stringify([{ id: 1 }]));
    expect(() => readFixtureDump(dir)).toThrow(
      'teams in ' + dir + ' holds 1 rows; _meta.json says 2',
    );
  });

  it('refuses a relation _meta.json lists but the dump lacks', () => {
    writeFileSync(
      join(dir, '_meta.json'),
      JSON.stringify({ tables: { teams: 0 } }),
    );
    expect(() => readFixtureDump(dir)).toThrow(
      'has no teams.json.gz or teams.json',
    );
  });

  it('refuses rows whose columns differ from the declared ones, and a seed that disagrees with the dump', () => {
    const declared = [{ name: 'id', type: 'bigint', nullable: false }];
    expect(() =>
      resolveColumns({ name: 'teams', rows: [{ id: 1, extra: 2 }] }, declared),
    ).toThrow('relation teams, row 1: has the columns id, extra; expected id');
    expect(() =>
      resolveColumns(
        {
          name: 'teams',
          rows: [],
          columns: [{ name: 'code', type: 'text', nullable: false }],
        },
        declared,
      ),
    ).toThrow('the dump lists the columns code, the seed id');
  });
});

describe('the three Databricks samples', () => {
  it('are World Cup, finance and marketing analytics, each mirroring its PostgreSQL sample', () => {
    expect(databricksFixtureSources()).toEqual([
      'world-cup',
      'finance',
      'marketing-analytics',
    ]);
    const databricks = SAMPLE_FIXTURES.filter(
      (f) => f.datasourceKind === 'databricks',
    );
    expect(databricks.map((f) => f.id)).toEqual([
      'world-cup-databricks',
      'finance-databricks',
      'marketing-analytics-databricks',
    ]);
    for (const fixture of databricks) {
      const source = databricksSource(fixture);
      expect(source?.datasourceKind ?? 'postgres').toBe('postgres');
      expect(fixture.schema).toBe(source?.schema);
      expect(fixture.requiredTables).toEqual(source?.requiredTables);
      expect(fixture.seedFile).toBeUndefined();
      expect(fixture.defaults.database).toBe(DATABRICKS_FIXTURE_CATALOG);
      expect(fixture.description).toContain(
        `npm run fixture:databricks -- --fixture ${source?.id}`,
      );
    }
  });

  it('resolves --fixture by the source id or the Databricks id, and refuses any other', () => {
    expect(resolveDatabricksFixture('world-cup').fixture.id).toBe(
      'world-cup-databricks',
    );
    expect(resolveDatabricksFixture('finance-databricks').source.id).toBe(
      'finance',
    );
    expect(() => resolveDatabricksFixture('formula-1')).toThrow(
      'No Databricks sample for "formula-1". Known: world-cup, finance, marketing-analytics.',
    );
  });

  it.each([
    ['world-cup', 14, 'worldcup-rest-api'],
    ['finance', 17, join('fixtures', 'finance')],
    ['marketing-analytics', 14, join('fixtures', 'marketing-analytics')],
  ])(
    'plans %s from its committed dump: %i relations, every required one, every value typed',
    (sourceId, relations, dumpDir) => {
      const plan = realPlan(sourceId);
      expect(plan.dumpDirectory).toContain(dumpDir);
      expect(plan.relations).toHaveLength(relations);
      expect(plan.createSchema).toBe(
        `CREATE SCHEMA IF NOT EXISTS \`evals\`.\`${plan.fixture.schema}\``,
      );
      for (const table of plan.fixture.requiredTables) {
        expect(plan.relations.map((r) => r.name)).toContain(table);
      }
      for (const relation of plan.relations) {
        expect(relation.qualifiedName).toBe(
          `\`evals\`.\`${plan.fixture.schema}\`.\`${relation.name}\``,
        );
        const inserted = relation.inserts
          .map((insert) => insert.split('\n').length - 1)
          .reduce((sum, n) => sum + n, 0);
        expect([relation.name, inserted]).toEqual([
          relation.name,
          relation.rowCount,
        ]);
        for (const insert of relation.inserts) {
          expect(insert.split('\n').length - 1).toBeLessThanOrEqual(500);
          expect(insert.length).toBeLessThanOrEqual(262_144);
        }
      }
      // Tables take their types from the seed; only views may be read elsewhere.
      for (const relation of plan.relations) {
        const from = new Set(relation.columns.map((c) => c.typeFrom));
        expect([relation.name, [...from]]).toEqual([
          relation.name,
          [
            relation.name.startsWith('v_')
              ? expect.stringMatching(/dump|values/)
              : 'seed',
          ],
        ]);
      }
    },
  );

  it('keeps the World Cup types: precise decimals, instants, NOT NULL keys, inferred views', () => {
    const plan = realPlan('world-cup');
    const types = (relation: string) =>
      Object.fromEntries(
        (plan.relations.find((r) => r.name === relation)?.columns ?? []).map(
          (c) => [c.name, `${c.type}${c.nullable ? '' : ' NOT NULL'}`],
        ),
      );
    expect(types('match_team_statistics')).toMatchObject({
      possession_pct: 'DECIMAL(5,2) NOT NULL',
      expected_goals: 'DECIMAL(5,2) NOT NULL',
      match_id: 'BIGINT NOT NULL',
    });
    expect(types('matches')).toMatchObject({
      kicked_off_at: 'TIMESTAMP NOT NULL',
      group_letter: 'STRING',
      went_to_extra_time: 'BOOLEAN NOT NULL',
      attendance: 'INT',
    });
    expect(types('tournaments')).toMatchObject({ starts_on: 'DATE NOT NULL' });
    expect(types('v_match_results')).toMatchObject({
      tournament_year: 'BIGINT',
      kicked_off_at: 'TIMESTAMP',
      winner: 'STRING',
    });
    const matches = plan.relations.find((r) => r.name === 'matches');
    expect(matches?.inserts[0]).toContain(
      "(1, 2, 64, 'final', NULL, TIMESTAMP'2022-12-18T15:00:00.000Z', 9, 1, 6, 3, 3, TRUE, 4, 2, 1, 88966)",
    );
    const stats = plan.relations.find(
      (r) => r.name === 'match_team_statistics',
    );
    expect(stats?.inserts[0]).toMatch(
      /\(\d+, \d+, \d+\.\d{2}, (?:\d+, ){7}\d+\.\d{2}\)/,
    );
  });

  it('keeps the domain types from the seed, and the view columns from the dump', () => {
    const finance = realPlan('finance');
    const col = (plan: LoadPlan, relation: string, name: string) =>
      plan.relations
        .find((r) => r.name === relation)
        ?.columns.find((c) => c.name === name);
    expect(col(finance, 'holdings', 'quantity')?.type).toBe('DECIMAL(18,4)');
    expect(col(finance, 'fx_rates', 'usd_per_unit')?.type).toBe(
      'DECIMAL(12,6)',
    );
    expect(col(finance, 'branches', 'state_code')?.type).toBe('STRING');
    expect(col(finance, 'v_accounts', 'is_test')).toMatchObject({
      type: 'BOOLEAN',
      typeFrom: 'dump',
      nullable: true,
    });
    const marketing = realPlan('marketing-analytics');
    expect(col(marketing, 'channels', 'is_digital')?.type).toBe('BOOLEAN');
  });

  it('honours another catalog or schema in every statement', () => {
    const plan = realPlan('world-cup', {
      catalog: 'dev sandbox',
      schema: 'wc_ba9',
    });
    for (const statement of planStatements(plan).slice(0, -1)) {
      expect(statement).toContain('`dev sandbox`.`wc_ba9`');
    }
    expect(plan.verify).toContain('FROM `dev sandbox`.`wc_ba9`.`matches`');
  });
});

describe('the load', () => {
  it('runs the plan in order, and a second run leaves the same rows (idempotent)', async () => {
    const plan = realPlan('world-cup');
    const warehouse = fakeWarehouse();
    const log: string[] = [];

    const first = await runLoadPlan(plan, warehouse.runner, (line) =>
      log.push(line),
    );
    const afterFirst = new Map(warehouse.tables);
    await runLoadPlan(plan, warehouse.runner);

    expect(warehouse.statements.slice(0, first.statements)).toEqual(
      planStatements(plan),
    );
    expect(first.relations.find((r) => r.name === 'goals')).toEqual({
      name: 'goals',
      rows: 47,
    });
    expect(warehouse.tables).toEqual(afterFirst);
    expect(warehouse.tables.get('`evals`.`world_cup`.`matches`')).toBe(16);
    expect(log[0]).toBe('✔ schema evals.world_cup');
    expect(log).toContain('✔ matches: 16 rows in 1 INSERT');
    expect(log[log.length - 1]).toBe(
      '✔ row counts match the dump for all 14 relations',
    );
  });

  it('fails naming every relation whose count on the warehouse differs from the dump', async () => {
    const plan = realPlan('world-cup');
    await expect(
      runLoadPlan(plan, fakeWarehouse({ dropOne: 'goals' }).runner),
    ).rejects.toThrow('goals: expected 47 rows, found 46');
  });

  it('fails naming the statement the warehouse refused', async () => {
    const plan = realPlan('world-cup');
    const runner: SqlRunner = {
      run: (sql) =>
        sql.startsWith('CREATE SCHEMA')
          ? Promise.reject(
              new Error(
                'PERMISSION_DENIED: User does not have USE CATALOG on evals',
              ),
            )
          : Promise.resolve([]),
    };
    await expect(runLoadPlan(plan, runner)).rejects.toThrow(
      'creating schema evals.world_cup failed: PERMISSION_DENIED: User does not have USE CATALOG on evals',
    );
  });

  it('reads counts as numbers, bigints or numeric text, and reports a relation left out', () => {
    const plan = realPlan('world-cup');
    const counts = plan.relations.map((r, i) => ({
      relation: r.name,
      row_count:
        i % 3 === 0
          ? r.rowCount
          : i % 3 === 1
            ? BigInt(r.rowCount)
            : String(r.rowCount),
    }));
    expect(rowCountProblems(plan, counts)).toEqual([]);
    expect(rowCountProblems(plan, counts.slice(1))).toEqual([
      `${plan.relations[0].name}: missing from the count`,
    ]);
  });
});

describe('the dry run', () => {
  it('prints every statement with the types, abbreviating the INSERTs unless asked', () => {
    const plan = realPlan('world-cup');
    const short = formatPlan(plan);
    expect(short).toContain(
      '-- Databricks load plan for the World Cup (Databricks) sample (world-cup-databricks)',
    );
    expect(short).toContain('-- target: evals.world_cup');
    expect(short).toContain(
      `-- 14 relations, 341 rows, ${planStatements(plan).length} statements; INSERTs abbreviated to 2 rows`,
    );
    expect(short).toContain(
      'possession_pct DECIMAL(5,2) <- numeric(5,2) (seed)',
    );
    expect(short).toContain('  -- … 14 more rows in this statement');
    expect(
      short
        .trimEnd()
        .endsWith('FROM `evals`.`world_cup`.`v_player_goal_totals`;'),
    ).toBe(true);
    const full = formatPlan(plan, { full: true });
    expect(full).not.toContain('more rows in this statement');
    for (const statement of planStatements(plan))
      expect(full).toContain(`${statement};`);
  });
});

describe('errors', () => {
  it('are FixtureLoadErrors, so the script reports them without a stack', () => {
    expect(() => databricksType('point')).toThrow(FixtureLoadError);
  });
});
