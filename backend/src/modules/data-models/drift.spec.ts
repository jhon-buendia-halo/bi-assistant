import { driftReport } from './drift';
import { bootstrapFromSnapshot } from './bootstrap';
import type {
  DatasetDoc,
  DatasetEntitySnapshot,
} from '../datasets/repositories/datasets.repository';

const MATCHES_KEY = 'world_cup.world_cup.matches';
const TEAMS_KEY = 'world_cup.world_cup.teams';
const VENUES_KEY = 'world_cup.world_cup.venues';

const matches: DatasetEntitySnapshot = {
  key: MATCHES_KEY,
  columns: [
    { name: 'match_id', type: 'bigint', nullable: false },
    { name: 'attendance', type: 'integer', nullable: true },
  ],
};

const teams: DatasetEntitySnapshot = {
  key: TEAMS_KEY,
  columns: [{ name: 'team_id', type: 'bigint', nullable: false }],
};

function dataset(entities: DatasetEntitySnapshot[]): DatasetDoc {
  return {
    name: 'World Cup Core',
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    tables: entities.map((e) => e.key),
    entities,
  };
}

const NOW = '2026-01-01T00:00:00.000Z';

describe('driftReport', () => {
  it('reports no drift when the snapshot is unchanged', () => {
    const base = dataset([matches, teams]);
    const { model } = bootstrapFromSnapshot(base, [], 1);

    const report = driftReport(model, base, NOW);

    expect(report).toMatchObject({
      checkedAt: NOW,
      snapshotOf: 1,
      added: [],
      removed: [],
      changed: [],
      entitiesAdded: [],
      entitiesRemoved: [],
    });
  });

  it('lists a removed column and an added column', () => {
    const base = dataset([matches, teams]);
    const { model } = bootstrapFromSnapshot(base, [], 1);

    const drifted: DatasetEntitySnapshot = {
      key: MATCHES_KEY,
      columns: [
        { name: 'match_id', type: 'bigint', nullable: false },
        { name: 'spectators', type: 'integer', nullable: true },
      ],
    };
    const report = driftReport(model, dataset([drifted, teams]), NOW);

    expect(report.removed).toEqual(['matches.attendance']);
    expect(report.added).toEqual(['matches.spectators']);
  });

  it('lists a changed attribute type', () => {
    const base = dataset([matches, teams]);
    const { model } = bootstrapFromSnapshot(base, [], 1);

    const retyped: DatasetEntitySnapshot = {
      key: MATCHES_KEY,
      columns: [
        { name: 'match_id', type: 'bigint', nullable: false },
        { name: 'attendance', type: 'text', nullable: true },
      ],
    };
    const report = driftReport(model, dataset([retyped, teams]), NOW);

    expect(report.changed).toEqual([
      { ref: 'matches.attendance', from: 'integer', to: 'string' },
    ]);
  });

  it('lists an entirely new table as entitiesAdded, named as bootstrap would', () => {
    const base = dataset([matches, teams]);
    const { model } = bootstrapFromSnapshot(base, [], 1);

    const report = driftReport(
      model,
      dataset([
        matches,
        teams,
        {
          key: VENUES_KEY,
          columns: [{ name: 'venue_id', type: 'bigint', nullable: false }],
        },
      ]),
      NOW,
    );

    expect(report.entitiesAdded).toEqual(['venues']);
    expect(report.entitiesRemoved).toEqual([]);
  });

  it('lists a bound table missing from the snapshot as entitiesRemoved', () => {
    const base = dataset([matches, teams]);
    const { model } = bootstrapFromSnapshot(base, [], 1);

    const report = driftReport(model, dataset([matches]), NOW);

    expect(report.entitiesRemoved).toEqual(['teams']);
  });

  it('checks rest bindings too, so a REST dataset does not look entirely added (finding 8)', () => {
    const endpoint: DatasetEntitySnapshot = {
      key: 'api.default.users',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'email', type: 'string', nullable: false },
      ],
    };
    const base: DatasetDoc = {
      name: 'Users API',
      datasourceId: 'ds-rest',
      datasourceKind: 'rest',
      tables: [endpoint.key],
      entities: [endpoint],
    };
    const { model } = bootstrapFromSnapshot(base, [], 1);

    const unchanged = driftReport(model, base, NOW);
    expect(unchanged.entitiesAdded).toEqual([]);
    expect(unchanged.added).toEqual([]);

    const drifted: DatasetEntitySnapshot = {
      key: endpoint.key,
      columns: [{ name: 'id', type: 'integer', nullable: false }],
    };
    const report = driftReport(model, { ...base, entities: [drifted] }, NOW);
    expect(report.removed).toEqual(['users.email']);
  });

  it('reports the removed attribute name, not the physical column it was mapped to (finding 5)', () => {
    const renamed: DatasetEntitySnapshot = {
      key: MATCHES_KEY,
      columns: [
        { name: 'match_id', type: 'bigint', nullable: false },
        { name: 'Attendance Count', type: 'integer', nullable: true },
      ],
    };
    const base = dataset([renamed, teams]);
    const { model } = bootstrapFromSnapshot(base, [], 1);
    // bootstrap mapped "Attendance Count" -> attribute "attendance_count"
    // with a `columns` override back to the physical name.
    expect(model.entities[0].bindings[0]).toMatchObject({
      columns: { attendance_count: 'Attendance Count' },
    });

    const columnGone: DatasetEntitySnapshot = {
      key: MATCHES_KEY,
      columns: [{ name: 'match_id', type: 'bigint', nullable: false }],
    };
    const report = driftReport(model, dataset([columnGone, teams]), NOW);

    expect(report.removed).toEqual(['matches.attendance_count']);
  });
});
