import { assistantEvalDatasetError } from './assistant-eval-datasets';
import type { DatasetSnapshot } from '../tool-services';

const tables = [
  'tournaments',
  'teams',
  'matches',
  'venues',
  'players',
  'goals',
  'match_team_statistics',
  'v_match_results',
  'v_player_goal_totals',
].map((table) => `world_cup.world_cup.${table}`);

function fixture(overrides: Partial<DatasetSnapshot> = {}): DatasetSnapshot {
  return {
    name: 'Sample',
    datasourceId: 'world-cup',
    datasourceKind: 'postgres',
    tables,
    ...overrides,
  };
}

describe('assistant eval dataset preflight', () => {
  it('rejects the F1 scope from the failed report, even if renamed World Cup', () => {
    const error = assistantEvalDatasetError(
      ['World Cup'],
      [
        fixture({
          name: 'World Cup',
          tables: ['formula1.formula1.race'],
        }),
      ],
    );
    expect(error).toContain('bundled World Cup sample (2018 and 2022)');
    expect(error).toContain('Missing entities: world_cup.tournaments');
  });

  it('accepts arbitrary dataset names and tables split across the same source', () => {
    expect(
      assistantEvalDatasetError(
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
      assistantEvalDatasetError(
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
      assistantEvalDatasetError(
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
    expect(assistantEvalDatasetError([], [])).toContain('No datasets selected');
    expect(assistantEvalDatasetError(['Missing'], [fixture()])).toContain(
      'Datasets not found: Missing',
    );
  });

  it('rejects an incomplete dataset with an actionable list', () => {
    expect(
      assistantEvalDatasetError(
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
      assistantEvalDatasetError(
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
    expect(
      assistantEvalDatasetError(['Sample'], [fixture(overrides)]),
    ).toContain('one PostgreSQL datasource');
  });
});
