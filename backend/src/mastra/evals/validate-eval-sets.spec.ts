// The entry point boots the whole app; its pure part is what is tested here.
// Neither module may load under Jest (ESM-only Mastra deps, connectors), and
// neither is needed: the Nest boot only runs when the file is executed.
jest.mock('../../app.module', () => ({ AppModule: class {} }));
jest.mock('../../modules/datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import {
  requiredEntities,
  SAMPLE_FIXTURES,
} from '../../modules/testing-data/fixtures/registry';
import { loadEvalSets } from './eval-set-files';
import type { EvalSetDefinition } from './eval-set-files';
import { RESULT_SET_ROW_LIMIT, runReferenceSql } from './result-set-check';
import {
  referenceOutsideDatasets,
  validateEvalSet,
} from './validate-eval-sets';
import type { ReferenceRunner } from './validate-eval-sets';

const WORLD_CUP = loadEvalSets().find((set) => set.id === 'world-cup')!;
const WITH_REFERENCE = WORLD_CUP.cases.filter((c) => c.expectedSql);

/** Runs the validator, collecting what it prints. */
async function validate(
  run: ReferenceRunner,
  set: EvalSetDefinition = WORLD_CUP,
  preflightError?: string,
  datasetEntities?: string[],
) {
  const lines: string[] = [];
  const result = await validateEvalSet(
    set,
    preflightError,
    run,
    (line) => lines.push(line),
    datasetEntities,
  );
  return { result, lines };
}

/** The World Cup dataset's entities, as a saved dataset names them. */
const WORLD_CUP_ENTITIES = [
  'tournaments',
  'teams',
  'venues',
  'players',
  'matches',
  'goals',
  'match_team_statistics',
  'disciplinary_events',
  'v_match_results',
  'v_player_goal_totals',
].map((table) => `world_cup.world_cup.${table}`);

describe('eval:validate', () => {
  it('prints a ✓ line per reference query and exits 0 when all run', async () => {
    const run = jest.fn().mockResolvedValue({ rowCount: 1 });
    const { result, lines } = await validate(run);

    expect(WITH_REFERENCE).toHaveLength(50);
    expect(run.mock.calls).toEqual(
      WITH_REFERENCE.map((c) => [c.expectedSql, c.id]),
    );
    expect(lines.slice(0, 50)).toEqual(
      WITH_REFERENCE.map((c) => `✓ ${c.id}  postgres  1 rows`),
    );
    // Cases with no reference query have nothing to validate: no line.
    expect(lines.join('\n')).not.toContain('schema-discovery');
    expect(lines.at(-1)).toBe(
      '\nworld-cup: 50 of 50 reference queries passed; 13 cases have no reference query.',
    );
    expect(result).toEqual({
      ran: 50,
      failed: 0,
      withoutReference: 13,
      exitCode: 0,
    });
  });

  it('fails on a broken reference, naming the case, and still runs the others', async () => {
    const run = jest.fn((sql: string, caseId: string) =>
      caseId === 'champion-2022'
        ? Promise.reject(
            new Error('column champion.common_nme does not exist\n  at …'),
          )
        : Promise.resolve({ rowCount: 2 }),
    );
    const { result, lines } = await validate(run);

    expect(lines[0]).toBe(
      '✗ champion-2022  postgres  column champion.common_nme does not exist at …',
    );
    expect(lines.slice(1, 50)).toEqual(
      WITH_REFERENCE.slice(1).map((c) => `✓ ${c.id}  postgres  2 rows`),
    );
    expect(run).toHaveBeenCalledTimes(50);
    expect(result).toMatchObject({ ran: 50, failed: 1, exitCode: 1 });
  });

  it('fails a reference truncated at the row limit, the way the result-set check does', async () => {
    const execute = jest.fn().mockResolvedValue({
      rows: Array.from({ length: RESULT_SET_ROW_LIMIT }, (_, i) => ({ i })),
    });
    const { result, lines } = await validate(async (sql) => ({
      rowCount: (await runReferenceSql(sql, execute)).length,
    }));

    expect(execute).toHaveBeenCalledWith(
      WITH_REFERENCE[0].expectedSql,
      RESULT_SET_ROW_LIMIT,
    );
    expect(lines[0]).toBe(
      '✗ champion-2022  postgres  reference result is truncated; completeness cannot be verified',
    );
    expect(result.exitCode).toBe(1);
  });

  it('fails a reference that returns no rows', async () => {
    const { result, lines } = await validate(
      jest.fn().mockResolvedValue({ rowCount: 0 }),
    );
    expect(lines[0]).toBe(
      '✗ champion-2022  postgres  the reference returned 0 rows',
    );
    expect(result).toMatchObject({ failed: 50, exitCode: 1 });
  });

  it('stops at the dataset preflight: prints it, runs nothing, exits 1', async () => {
    const run = jest.fn();
    const { result, lines } = await validate(
      run,
      WORLD_CUP,
      'These evals require the bundled World Cup sample. Missing entities: world_cup.tournaments.',
    );
    expect(run).not.toHaveBeenCalled();
    expect(lines[0]).toContain('Missing entities: world_cup.tournaments');
    expect(result).toMatchObject({ ran: 0, exitCode: 1 });
  });

  it('validates the REST variant against its SQLite references', async () => {
    const rest = loadEvalSets().find((set) => set.id === 'world-cup-rest')!;
    const run = jest.fn<ReturnType<ReferenceRunner>, [string, string]>();
    run.mockResolvedValue({ rowCount: 1 });
    const { lines } = await validate(run, rest);
    expect(lines[0]).toBe('✓ rest-champion-2022  sqlite  1 rows');
    expect(run.mock.calls[0][0]).toContain('FROM api.world_cup.tournaments');
  });

  describe('references read only dataset entities (R110, BA-183)', () => {
    // The last 11 questions of the World Cup bank, the former golden set.
    const BANK = loadEvalSets().find((set) => set.id === 'world-cup')!;
    const GOLDEN = { ...BANK, cases: BANK.cases.slice(-11) };

    it('fails a reference reading a table the datasets lack, without running it', async () => {
      // The gap BA-182 found by hand: two golden questions read
      // disciplinary_events, which the sample did not require at first.
      const without = WORLD_CUP_ENTITIES.filter(
        (entity) => !entity.endsWith('.disciplinary_events'),
      );
      const run = jest.fn<ReturnType<ReferenceRunner>, [string, string]>();
      run.mockResolvedValue({ rowCount: 3 });
      const { result, lines } = await validate(run, GOLDEN, undefined, without);
      const failed = lines.filter((line) => line.startsWith('✗'));
      expect(failed).toEqual([
        '✗ card-types-recorded  postgres  the reference reads world_cup.disciplinary_events, which is not in the selected datasets',
        '✗ yellow-card-share  postgres  the reference reads world_cup.disciplinary_events, which is not in the selected datasets',
      ]);
      expect(run.mock.calls.map(([, id]) => id)).not.toContain(
        'card-types-recorded',
      );
      expect(run).toHaveBeenCalledTimes(9);
      expect(result).toMatchObject({ ran: 11, failed: 2, exitCode: 1 });
    });

    it('passes every moved reference against the full World Cup dataset', async () => {
      for (const set of [WORLD_CUP, GOLDEN]) {
        const { result } = await validate(
          jest.fn().mockResolvedValue({ rowCount: 1 }),
          set,
          undefined,
          WORLD_CUP_ENTITIES,
        );
        expect([set.id, result.exitCode]).toEqual([set.id, 0]);
      }
      const rest = loadEvalSets().find((set) => set.id === 'world-cup-rest')!;
      const { result } = await validate(
        jest.fn().mockResolvedValue({ rowCount: 1 }),
        rest,
        undefined,
        WORLD_CUP_ENTITIES.map((entity) =>
          entity.replace('world_cup.world_cup.', 'api.world_cup.'),
        ),
      );
      expect(result.exitCode).toBe(0);
    });

    it('holds for every reference of every set against its sample’s required entities, with no database', () => {
      // The same rule the validator applies to the selected datasets, run
      // on the fixture registry, so a gap fails here before any setup.
      const outside: string[] = [];
      for (const set of loadEvalSets()) {
        const fixture = SAMPLE_FIXTURES.find(
          (sample) => sample.id === set.fixtureId,
        )!;
        for (const evalCase of set.cases) {
          const entity =
            evalCase.expectedSql &&
            referenceOutsideDatasets(
              evalCase.expectedSql,
              requiredEntities(fixture),
            );
          if (entity) outside.push(`${set.id} ${evalCase.id}: ${entity}`);
        }
      }
      expect(outside).toEqual([]);
    });

    it('compares on the last two name parts, ignoring case, and skips what is not a table', () => {
      const entities = ['wc_db.World_Cup.Goals', 'wc_db.world_cup.teams'];
      expect(
        referenceOutsideDatasets(
          'WITH g AS (SELECT * FROM world_cup.goals) SELECT EXTRACT(YEAR FROM now()), t.name FROM g JOIN "api.world_cup.teams" t ON true, generate_series(1, 2) s',
          entities,
        ),
      ).toBeUndefined();
      expect(
        referenceOutsideDatasets('SELECT 1 FROM goals', entities),
      ).toBeUndefined();
      expect(
        referenceOutsideDatasets('SELECT 1 FROM other_schema.goals', entities),
      ).toBe('other_schema.goals');
      expect(referenceOutsideDatasets('SELECT 1 FROM venues', entities)).toBe(
        'venues',
      );
    });
  });
});

describe('eval:validate on a Databricks set (agents-evals R192)', () => {
  const DBX_ONLY = loadEvalSets().find(
    (set) => set.id === 'world-cup-databricks-only',
  )!;
  const inCatalog = (catalog: string) =>
    SAMPLE_FIXTURES.find(
      (fixture) => fixture.id === 'world-cup-databricks',
    )!.requiredTables.map((table) => `${catalog}.world_cup.${table}`);

  it('runs every reference in the catalog of the selected datasets', async () => {
    const run = jest.fn().mockResolvedValue({ rowCount: 2 });
    const { result } = await validate(
      run,
      DBX_ONLY,
      undefined,
      inCatalog('dev_sandbox'),
    );

    const withReference = DBX_ONLY.cases.filter((c) => c.expectedSql);
    expect(run.mock.calls).toEqual(
      withReference.map((c) => [
        (c.expectedSql as string).split('`evals`.').join('`dev_sandbox`.'),
        c.id,
      ]),
    );
    for (const [sql] of run.mock.calls as [string][]) {
      expect(sql).not.toContain('`evals`');
    }
    expect(result.exitCode).toBe(0);
  });

  it('runs them as written when the datasets are in the evals catalog', async () => {
    const run = jest.fn().mockResolvedValue({ rowCount: 2 });
    await validate(run, DBX_ONLY, undefined, inCatalog('evals'));
    expect((run.mock.calls as [string, string][]).map(([sql]) => sql)).toEqual(
      DBX_ONLY.cases.filter((c) => c.expectedSql).map((c) => c.expectedSql),
    );
  });

  it('refuses entities that span catalogs before running anything', async () => {
    const run = jest.fn();
    const { result, lines } = await validate(run, DBX_ONLY, undefined, [
      ...inCatalog('evals').slice(1),
      inCatalog('main')[0],
    ]);
    expect(run).not.toHaveBeenCalled();
    expect(lines[0]).toBe(
      '✗ dataset preflight  The selected datasets span several catalogs (evals, main); ' +
        'the Databricks reference queries run in one. Select datasets whose entities are all in one catalog.',
    );
    expect(result.exitCode).toBe(1);
  });

  it('leaves a PostgreSQL set as written, whatever its datasets are called', async () => {
    const run = jest.fn().mockResolvedValue({ rowCount: 1 });
    await validate(run, WORLD_CUP, undefined, [
      ...WORLD_CUP_ENTITIES,
      'another.world_cup.goals',
    ]);
    expect((run.mock.calls as [string, string][]).map(([sql]) => sql)).toEqual(
      WITH_REFERENCE.map((c) => c.expectedSql),
    );
  });
});
