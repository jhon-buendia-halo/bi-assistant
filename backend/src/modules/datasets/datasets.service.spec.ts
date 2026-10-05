jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import { DatasetsService, withSampleValues } from './datasets.service';
import type {
  DatasetDoc,
  DatasetEntitySnapshot,
} from './repositories/datasets.repository';

const claims: DatasetEntitySnapshot = {
  key: 'main.health.claims',
  columns: [
    { name: 'status', type: 'string', nullable: false },
    { name: 'amount', type: 'double', nullable: true },
  ],
};

/** Empty aggregate/top-values result — profiling degrades to "no profile". */
function emptyRunReadOnlySql() {
  return jest.fn().mockResolvedValue({ columns: [], rows: [] });
}

function build(
  sampleRows: jest.Mock,
  runReadOnlySql: jest.Mock = emptyRunReadOnlySql(),
) {
  const repository = {
    save: jest
      .fn()
      .mockImplementation((name: string, tables: unknown, entities: unknown) =>
        Promise.resolve({ name, tables, entities }),
      ),
    getByNames: jest.fn().mockResolvedValue([]),
  };
  const datasources = {
    get: jest
      .fn()
      .mockResolvedValue({ id: 'ds-1', kind: 'databricks', name: 'DBX' }),
    sampleRows,
    // Mirrors DatasourcesService.sampleRowsMany's fallback: per-entity
    // sampling with failures returned as Error values, never thrown.
    sampleRowsMany: jest.fn(
      async (id: string, entities: string[], limit: number) => {
        const results = new Map<string, unknown>();
        for (const entity of entities) {
          try {
            results.set(entity, await sampleRows(id, entity, limit));
          } catch (err) {
            results.set(
              entity,
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
        return results;
      },
    ),
    runReadOnlySql,
    foreignKeys: jest.fn().mockResolvedValue([]),
  };
  const store = {
    update: jest
      .fn()
      .mockImplementation((filter: { name: string }, patch: unknown) =>
        Promise.resolve({ name: filter.name, ...(patch as object) }),
      ),
    unset: jest
      .fn()
      .mockImplementation((filter: { name: string }) =>
        Promise.resolve({ name: filter.name }),
      ),
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
  };
  return {
    service: new DatasetsService(
      repository as never,
      datasources as never,
      store,
    ),
    repository,
    datasources,
    store,
  };
}

/** The snapshots handed to `DatasetsRepository.save` on its first call. */
function savedEntities(repository: {
  save: jest.Mock;
}): DatasetEntitySnapshot[] {
  const calls = repository.save.mock.calls as unknown[][];
  return calls[0][2] as DatasetEntitySnapshot[];
}

describe('withSampleValues', () => {
  it('takes up to five distinct stringified values per column', () => {
    const rows = [
      { status: 'PAID' },
      { status: 'PAID' },
      { status: 'DENIED' },
      { status: 'PENDING' },
      { status: 'APPEALED' },
      { status: 'VOID' },
      { status: 'REVERSED' },
    ];

    const [status] = withSampleValues(claims.columns, rows);

    expect(status.sampleValues).toEqual([
      'PAID',
      'DENIED',
      'PENDING',
      'APPEALED',
      'VOID',
    ]);
  });

  it('skips nulls and leaves a column with no values untouched', () => {
    const columns = withSampleValues(claims.columns, [
      { status: null, amount: 12.5 },
      { status: undefined, amount: 12.5 },
    ]);

    expect(columns[0].sampleValues).toBeUndefined();
    expect(columns[1].sampleValues).toEqual(['12.5']);
  });

  it('truncates long values to 40 characters', () => {
    const [status] = withSampleValues(claims.columns, [
      { status: 'x'.repeat(80) },
    ]);

    expect(status.sampleValues?.[0]).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('DatasetsService.save', () => {
  it('enriches every included entity before persisting', async () => {
    const sampleRows = jest
      .fn()
      .mockResolvedValue({ columns: ['status'], rows: [{ status: 'PAID' }] });
    const { service, repository, datasources } = build(sampleRows);

    await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [claims],
      datasourceId: 'ds-1',
    });

    expect(datasources.sampleRows).toHaveBeenCalledWith(
      'ds-1',
      'main.health.claims',
      50,
    );
    expect(savedEntities(repository)[0].columns[0].sampleValues).toEqual([
      'PAID',
    ]);
  });

  it('still saves when sampling a table fails', async () => {
    const sampleRows = jest.fn().mockRejectedValue(new Error('no access'));
    const { service, repository } = build(sampleRows);

    await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [claims],
      datasourceId: 'ds-1',
    });

    expect(savedEntities(repository)).toEqual([claims]);
  });

  it('rejects a kind that disagrees with the saved datasource', async () => {
    const { service } = build(jest.fn());

    await expect(
      service.save({
        name: 'health',
        tables: ['main.health.claims'],
        entities: [claims],
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
      }),
    ).rejects.toThrow('Datasource kind must be databricks');
  });

  it('profiles included columns and stamps profiledAt via the doc store', async () => {
    const sampleRows = jest
      .fn()
      .mockResolvedValue({ columns: ['status'], rows: [{ status: 'PAID' }] });
    const runReadOnlySql = jest.fn().mockImplementation((_id, sql: string) => {
      if (sql.includes('GROUP BY')) {
        return Promise.resolve({
          columns: ['value', 'value_count'],
          rows: [{ value: 'PAID', value_count: 5 }],
        });
      }
      return Promise.resolve({
        columns: [],
        rows: [
          {
            rows_total: 5,
            c0_nonnull: 5,
            c0_distinct: 1,
            c0_min: 'PAID',
            c0_max: 'PAID',
          },
        ],
      });
    });
    const singleColumn: DatasetEntitySnapshot = {
      key: 'main.health.claims',
      columns: [{ name: 'status', type: 'string', nullable: false }],
    };
    const { service, repository, store, datasources } = build(
      sampleRows,
      runReadOnlySql,
    );

    await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [singleColumn],
      datasourceId: 'ds-1',
    });

    expect(datasources.runReadOnlySql).toHaveBeenCalled();
    const saved = savedEntities(repository)[0];
    expect(saved.columns[0].profile).toEqual(
      expect.objectContaining({
        sampledRows: 5,
        distinctCount: 1,
        constant: true,
        min: 'PAID',
        max: 'PAID',
        topValues: [{ value: 'PAID', count: 5 }],
      }),
    );
    const [filterArg, patchArg] = store.update.mock.calls[0] as [
      { name: string },
      { profiledAt: string },
    ];
    expect(filterArg).toEqual({ name: 'health' });
    expect(typeof patchArg.profiledAt).toBe('string');
  });

  it('keeps sample values but skips profiling SQL on a REST datasource', async () => {
    const sampleRows = jest
      .fn()
      .mockResolvedValue({ columns: ['status'], rows: [{ status: 'PAID' }] });
    const { service, repository, datasources } = build(sampleRows);
    datasources.get.mockResolvedValue({ id: 'ds-1', kind: 'rest', name: 'API' });

    await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [claims],
      datasourceId: 'ds-1',
    });

    expect(datasources.runReadOnlySql).not.toHaveBeenCalled();
    const saved = savedEntities(repository)[0];
    expect(saved.columns[0].sampleValues).toEqual(['PAID']);
    expect(saved.columns[0].profile).toBeUndefined();
  });

  it('leaves profiledAt untouched when profiling produces nothing', async () => {
    const sampleRows = jest
      .fn()
      .mockResolvedValue({ columns: ['status'], rows: [{ status: 'PAID' }] });
    const { service, repository, store } = build(sampleRows);

    await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [claims],
      datasourceId: 'ds-1',
    });

    expect(store.update).not.toHaveBeenCalled();
    expect(repository.getByNames).toHaveBeenCalledWith(['health']);
  });
});

describe('DatasetsService.reprofile', () => {
  const existing: DatasetDoc = {
    name: 'health',
    tables: ['main.health.claims'],
    entities: [claims],
    datasourceId: 'ds-1',
    datasourceKind: 'databricks',
  };

  it('recomputes profiles without re-sampling values', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: [],
      rows: [
        {
          rows_total: 10,
          c0_nonnull: 10,
          c0_distinct: 2,
          c0_min: 'DENIED',
          c0_max: 'PAID',
          c1_nonnull: 8,
          c1_distinct: 6,
          c1_min: '1.5',
          c1_max: '99.5',
        },
      ],
    });
    const { service, repository, store, datasources } = build(
      jest.fn(),
      runReadOnlySql,
    );
    repository.getByNames = jest.fn().mockResolvedValue([existing]);

    await service.reprofile('health');

    expect(datasources.sampleRows).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(
      'health',
      existing.tables,
      expect.any(Array),
      { id: 'ds-1', kind: 'databricks' },
    );
    const [filterArg, patchArg] = store.update.mock.calls[0] as [
      { name: string },
      { profiledAt: string },
    ];
    expect(filterArg).toEqual({ name: 'health' });
    expect(typeof patchArg.profiledAt).toBe('string');
  });

  it('throws when the dataset does not exist', async () => {
    const { service, repository } = build(jest.fn());
    repository.getByNames = jest.fn().mockResolvedValue([]);

    await expect(service.reprofile('missing')).rejects.toThrow(
      'Dataset "missing" not found',
    );
  });

  it('throws when the dataset has no datasource', async () => {
    const { service, repository } = build(jest.fn());
    repository.getByNames = jest
      .fn()
      .mockResolvedValue([{ name: 'health', tables: [], entities: [] }]);

    await expect(service.reprofile('health')).rejects.toThrow(
      'has no datasource to profile',
    );
  });
});

describe('DatasetsService.updateDescription', () => {
  it('trims and sets the description', async () => {
    const { service, repository, store } = build(jest.fn());
    repository.getByNames = jest
      .fn()
      .mockResolvedValue([{ name: 'health', tables: [], entities: [] }]);

    await service.updateDescription('health', '  Claims by member.  ');

    expect(store.update).toHaveBeenCalledWith(
      { name: 'health' },
      { description: 'Claims by member.' },
    );
  });

  it('clears the description on an empty string', async () => {
    const { service, repository, store } = build(jest.fn());
    repository.getByNames = jest
      .fn()
      .mockResolvedValue([{ name: 'health', tables: [], entities: [] }]);

    await service.updateDescription('health', '   ');

    expect(store.unset).toHaveBeenCalledWith({ name: 'health' }, 'description');
    expect(store.update).not.toHaveBeenCalled();
  });

  it('rejects a description over 2000 characters', async () => {
    const { service, repository } = build(jest.fn());
    repository.getByNames = jest
      .fn()
      .mockResolvedValue([{ name: 'health', tables: [], entities: [] }]);

    await expect(
      service.updateDescription('health', 'x'.repeat(2001)),
    ).rejects.toThrow('2000 characters or fewer');
  });

  it('throws when the dataset does not exist', async () => {
    const { service, repository } = build(jest.fn());
    repository.getByNames = jest.fn().mockResolvedValue([]);

    await expect(service.updateDescription('missing', 'hello')).rejects.toThrow(
      'Dataset "missing" not found',
    );
  });
});
