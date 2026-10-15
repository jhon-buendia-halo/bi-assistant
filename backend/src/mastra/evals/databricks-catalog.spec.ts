import { tableReferences } from './checks/sql-text';
import {
  catalogOfEntities,
  DatabricksCatalogError,
  REFERENCE_CATALOG,
  referenceForDatasets,
  referenceInCatalog,
} from './databricks-catalog';
import { loadEvalSets } from './eval-set-files';

const SETS = loadEvalSets();
/** A real reference: the golden set's pass-accuracy question on Databricks. */
const GOLDEN = SETS.find(
  (set) => set.id === 'world-cup-golden-databricks',
)?.cases.find((evalCase) => evalCase.id === 'dbx-pass-accuracy-by-team')
  ?.expectedSql as string;

describe('the catalog of the selected datasets (agents-evals R191)', () => {
  it('is the first part of every entity key, compared ignoring case', () => {
    expect(REFERENCE_CATALOG).toBe('evals');
    expect(
      catalogOfEntities([
        'Dev_Sandbox.world_cup.goals',
        'dev_sandbox.world_cup.teams',
      ]),
    ).toBe('dev_sandbox');
  });

  it('is refused when the entities name several catalogs, none, or a key has no catalog', () => {
    expect(() =>
      catalogOfEntities(['evals.world_cup.goals', 'main.world_cup.teams']),
    ).toThrow(
      'The selected datasets span several catalogs (evals, main); the Databricks reference queries run in one. ' +
        'Select datasets whose entities are all in one catalog.',
    );
    expect(() => catalogOfEntities([])).toThrow('hold no entity');
    expect(() =>
      catalogOfEntities(['evals.world_cup.goals', 'world_cup.teams']),
    ).toThrow('The entity "world_cup.teams" is not catalog.schema.table');
    expect(() =>
      catalogOfEntities(['main.world_cup.goals', 'evals.x.y']),
    ).toThrow(DatabricksCatalogError);
  });
});

describe('a reference rewritten to the catalog (agents-evals R191)', () => {
  it('rewrites every backticked `evals`. of a real reference, and nothing else', () => {
    expect(GOLDEN).toContain('FROM `evals`.world_cup.match_team_statistics s');
    const rewritten = referenceInCatalog(GOLDEN, 'dev_sandbox');
    expect(rewritten).toBe(GOLDEN.split('`evals`.').join('`dev_sandbox`.'));
    expect(tableReferences(rewritten).map((parts) => parts[0])).toEqual([
      'dev_sandbox',
      'dev_sandbox',
    ]);
  });

  it('backticks the new catalog, doubling a backtick in its name', () => {
    expect(
      referenceInCatalog('SELECT * FROM `evals`.world_cup.goals', 'team-data'),
    ).toBe('SELECT * FROM `team-data`.world_cup.goals');
    expect(
      referenceInCatalog(
        'SELECT * FROM `evals`.`world_cup`.`goals`',
        'odd`one',
      ),
    ).toBe('SELECT * FROM `odd``one`.`world_cup`.`goals`');
  });

  it('leaves every other form as written', () => {
    for (const sql of [
      'SELECT * FROM evals.world_cup.goals',
      'SELECT `evals` FROM `main`.world_cup.goals',
      "SELECT '`evals`.world_cup.goals' AS label FROM `main`.world_cup.goals",
      "SELECT 'it\\'s `evals`.x' FROM `main`.world_cup.goals",
      'SELECT 1 -- from `evals`.world_cup.goals\nFROM `main`.world_cup.goals',
      'SELECT /* `evals`.x */ 1 FROM `main`.world_cup.goals',
      'SELECT * FROM `my``evals`.world_cup.goals',
      'SELECT * FROM `EVALS`.world_cup.goals',
    ]) {
      expect(referenceInCatalog(sql, 'dev_sandbox')).toBe(sql);
    }
  });

  it('changes nothing when the catalog is evals', () => {
    expect(referenceInCatalog(GOLDEN, 'evals')).toBe(GOLDEN);
  });
});

describe('a reference for the selected datasets, by dialect', () => {
  const PG = 'SELECT * FROM world_cup.goals';
  const ODD = ['evals.world_cup.goals', 'main.world_cup.teams'];

  it('runs a Databricks reference in the datasets catalog', () => {
    expect(
      referenceForDatasets(GOLDEN, 'databricks', [
        'dev_sandbox.world_cup.teams',
      ]),
    ).toBe(referenceInCatalog(GOLDEN, 'dev_sandbox'));
    expect(() => referenceForDatasets(GOLDEN, 'databricks', ODD)).toThrow(
      DatabricksCatalogError,
    );
  });

  it('changes no PostgreSQL or SQLite reference, and reads no catalog for them', () => {
    expect(referenceForDatasets(PG, 'postgres', ODD)).toBe(PG);
    expect(
      referenceForDatasets(
        'SELECT `evals`.x FROM api.world_cup.goals',
        'sqlite',
        [],
      ),
    ).toBe('SELECT `evals`.x FROM api.world_cup.goals');
    expect(
      referenceForDatasets(
        'SELECT * FROM `evals`.world_cup.goals',
        'postgres',
        ['main.a.b'],
      ),
    ).toBe('SELECT * FROM `evals`.world_cup.goals');
  });
});
