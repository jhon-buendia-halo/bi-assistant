jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasources/connectors/postgres-profiling', () => ({
  PostgresProfiler: class {},
}));
jest.mock('../datasources/connectors/databricks-profiling', () => ({
  DatabricksProfiler: class {},
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));

import { buildSampledProfile } from './profile';
import { ProfileCache } from './profile-cache';
import { SyntheticDataService } from './synthetic-data.service';

const T = ['wc.public.teams', 'wc.public.players', 'wc.public.broken'];
const col = (name: string, type = 'text') => ({ name, type, nullable: true });

describe('SyntheticDataService with the real profile builder', () => {
  it('lines up the sampler, catalog, keys and builder seams', async () => {
    const outcome = (table: string, rows: Record<string, string | null>[]) => ({
      namespace: 'public',
      table,
      rowCountEstimate: rows.length,
      method: 'full' as const,
      columns: Object.keys(rows[0] ?? {}),
      rows,
      durationMs: 2,
    });
    const scoped = {
      tables: jest.fn().mockResolvedValue([
        {
          schema: 'public',
          table: 'teams',
          columns: [col('id', 'integer'), col('name')],
        },
        {
          schema: 'public',
          table: 'players',
          columns: [col('id', 'integer'), col('team_id', 'integer')],
        },
        { schema: 'public', table: 'broken', columns: [col('id', 'integer')] },
      ]),
      keys: jest.fn().mockResolvedValue([
        { schema: 'public', table: 'teams', columns: ['id'], kind: 'primary' },
        {
          schema: 'public',
          table: 'players',
          columns: ['id'],
          kind: 'primary',
        },
      ]),
      foreignKeys: jest.fn().mockResolvedValue([
        {
          schema: 'public',
          table: 'players',
          column: 'team_id',
          refSchema: 'public',
          refTable: 'teams',
          refColumn: 'id',
        },
      ]),
      sampleTable: jest.fn(async (_c: unknown, _ns: string, table: string) => {
        await Promise.resolve();
        if (table === 'broken') throw new Error('permission denied');
        return table === 'teams'
          ? outcome('teams', [
              { id: '1', name: 'A' },
              { id: '2', name: 'B' },
            ])
          : outcome('players', [
              { id: '1', team_id: '1' },
              { id: '2', team_id: '2' },
            ]);
      }),
    };
    const profiler = {
      withSessions: async (
        _c: unknown,
        _n: number,
        _s: unknown,
        fn: (s: unknown) => Promise<unknown>,
      ) => fn(scoped),
    };
    const now = 1_700_000_000_000;
    const service = new SyntheticDataService(
      {
        list: () =>
          Promise.resolve([
            {
              name: 'WC',
              datasourceId: 'ds1',
              datasourceKind: 'postgres',
              tables: T,
            },
          ]),
      } as never,
      {
        get: () =>
          Promise.resolve({
            id: 'ds1',
            name: 'WC DB',
            kind: 'postgres',
            config: { database: 'wc' },
          }),
      } as never,
      profiler as never,
      profiler as never,
      new ProfileCache(() => now),
      buildSampledProfile,
    );

    const p = await service.profile({ datasetName: 'WC', sampleSize: 10 });

    expect(p.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.version).toBe(1);
    expect(p.datasetName).toBe('WC');
    expect(p.datasourceId).toBe('ds1');
    expect(p.dialect).toBe('postgres');
    expect(p.sampleSize).toBe(10);
    expect(Date.parse(p.expiresAt) - Date.parse(p.generatedAt)).toBe(3_600_000);
    expect(p.tables.map((t) => t.key)).toEqual(T);
    expect(p.tables.map((t) => t.method)).toEqual([
      'full',
      'full',
      expect.any(String),
    ]);
    expect(p.tables[0].sampledRows).toBe(2);
    expect(p.tables[0].primaryKey).toEqual(['id']);
    expect(p.tables[2].error).toBe('permission denied');
    expect(p.tables[2].columns.map((c) => c.name)).toEqual(['id']);
    expect(p.relationships).toEqual([
      {
        fromTable: 'wc.public.players',
        fromColumns: ['team_id'],
        toTable: 'wc.public.teams',
        toColumns: ['id'],
        origin: 'declared',
      },
    ]);
    expect(service.getProfile(p.profileId)).toBe(p);
  });
});
