import {
  assistantEvalDatasetError,
  evalFixture,
} from './assistant-eval-datasets';
import type { DatasetSnapshot } from '../tool-services';
import type { SampleFixture } from '../../modules/testing-data/fixtures/registry';

const WORLD_CUP = evalFixture('world-cup');

/**
 * The scope a complete World Cup load produces — derived from the registry,
 * so this spec cannot drift from what the loader actually provisions.
 */
const tables = WORLD_CUP.requiredTables.map(
  (table) => `world_cup.${WORLD_CUP.schema}.${table}`,
);

function fixture(overrides: Partial<DatasetSnapshot> = {}): DatasetSnapshot {
  return {
    name: 'Sample',
    datasourceId: 'world-cup',
    datasourceKind: 'postgres',
    tables,
    ...overrides,
  };
}

/** Preflight against the World Cup registry entry, the way a run does. */
function check(
  names: string[],
  snapshots: DatasetSnapshot[],
  sample: SampleFixture | string = WORLD_CUP,
): string | undefined {
  return assistantEvalDatasetError(names, snapshots, sample);
}

describe('assistant eval dataset preflight', () => {
  it('rejects the F1 scope from the failed report, even if renamed World Cup', () => {
    const error = check(
      ['World Cup'],
      [
        fixture({
          name: 'World Cup',
          tables: ['formula1.formula1.race'],
        }),
      ],
    );
    expect(error).toContain('bundled World Cup sample');
    expect(error).toContain('2018 and 2022');
    expect(error).toContain('Missing entities: world_cup.tournaments');
  });

  it('accepts arbitrary dataset names and tables split across the same source', () => {
    expect(
      check(
        ['Core', 'Stats'],
        [
          fixture({ name: 'Core', tables: tables.slice(0, 4) }),
          fixture({ name: 'Stats', tables: tables.slice(4) }),
        ],
      ),
    ).toBeUndefined();
  });

  it('accepts schema.table keys as well as catalog.schema.table', () => {
    expect(
      check(
        ['Sample'],
        [
          fixture({
            tables: tables.map((table) => table.split('.').slice(-2).join('.')),
          }),
        ],
      ),
    ).toBeUndefined();
  });

  it('does not accept matching table names under a different schema', () => {
    expect(
      check(
        ['Sample'],
        [
          fixture({
            tables: tables.map((table) =>
              table.replace('world_cup.world_cup.', 'db.other.'),
            ),
          }),
        ],
      ),
    ).toContain('Missing entities');
  });

  it('rejects missing selections and does not use unselected snapshots', () => {
    expect(check([], [])).toContain('No datasets selected');
    expect(check(['Missing'], [fixture()])).toContain(
      'Datasets not found: Missing',
    );
  });

  it('rejects an incomplete dataset with an actionable list', () => {
    expect(
      check(
        ['Sample'],
        [
          fixture({
            tables: tables.filter((table) => !table.endsWith('.matches')),
          }),
        ],
      ),
    ).toContain('Missing entities: world_cup.matches.');
  });

  it('rejects a fixture spread across multiple datasources', () => {
    expect(
      check(
        ['Sample', 'Other'],
        [fixture(), fixture({ name: 'Other', datasourceId: 'other' })],
      ),
    ).toContain('one PostgreSQL datasource');
  });

  it.each([
    { datasourceId: undefined },
    { datasourceKind: undefined },
    { datasourceKind: 'databricks' as const },
  ])('rejects unsupported or missing datasource metadata: %p', (overrides) => {
    expect(check(['Sample'], [fixture(overrides)])).toContain(
      'one PostgreSQL datasource',
    );
  });
});

describe('the fixture registry is the single source of required entities', () => {
  it('requires every table the registry entry lists, and nothing else', () => {
    // Drop one required entity at a time: each must be reported by name, which
    // only holds if the check reads `requiredTables` rather than its own copy.
    for (const table of WORLD_CUP.requiredTables) {
      const missingOne = tables.filter(
        (entity) => !entity.endsWith(`.${table}`),
      );
      expect(check(['Sample'], [fixture({ tables: missingOne })])).toContain(
        `Missing entities: ${WORLD_CUP.schema}.${table}.`,
      );
    }
    // The full registry-derived scope, and only it, is enough.
    expect(check(['Sample'], [fixture()])).toBeUndefined();
  });

  it('validates a synthetic fixture against its own tables and schema', () => {
    const sample: SampleFixture = {
      id: 'synthetic',
      name: 'Synthetic',
      description: 'A made-up sample used only by this spec.',
      schema: 'synth',
      defaults: {
        host: '127.0.0.1',
        port: 5432,
        database: 'synth',
        user: 'synth',
        password: '',
        ssl: false,
      },
      datasourceName: 'Synthetic PostgreSQL',
      datasetName: 'Synthetic',
      requiredTables: ['alpha', 'beta'],
    };

    expect(
      check(
        ['Sample'],
        [fixture({ tables: ['db.synth.alpha', 'db.synth.beta'] })],
        sample,
      ),
    ).toBeUndefined();
    // The World Cup scope satisfies nothing here — the entities come from the
    // fixture passed in, not from a module-level constant.
    expect(check(['Sample'], [fixture()], sample)).toContain(
      'Missing entities: synth.alpha, synth.beta',
    );
    expect(check(['Sample'], [fixture()], sample)).toContain(
      'bundled Synthetic sample',
    );
  });

  it('fails loudly when a question set points at an unknown fixture', () => {
    expect(() => evalFixture('no-such-sample')).toThrow(
      'Unknown sample fixture "no-such-sample"',
    );
    expect(() => check(['Sample'], [fixture()], 'no-such-sample')).toThrow(
      'Unknown sample fixture',
    );
  });
});
