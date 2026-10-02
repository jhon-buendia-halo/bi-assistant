jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import { DatasetsService, withSampleValues } from './datasets.service';
import type { DatasetEntitySnapshot } from './repositories/datasets.repository';

const claims: DatasetEntitySnapshot = {
  key: 'main.health.claims',
  columns: [
    { name: 'status', type: 'string', nullable: false },
    { name: 'amount', type: 'double', nullable: true },
  ],
};

function build(
  sampleRows: jest.Mock,
  options: { existingModel?: unknown } = {},
) {
  const repository = {
    save: jest
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve({ name, tables: [] }),
      ),
    delete: jest.fn().mockResolvedValue(1),
  };
  // `DataModelsService` is a separate module (ADR-0006); `DatasetsService`
  // only calls through its bootstrap/drift/delete bridge, so a plain fake
  // is enough here — no need to pull in the real service and its own deps.
  const dataModels = {
    get: jest.fn().mockResolvedValue(options.existingModel ?? null),
    ensureBootstrapped: jest.fn().mockResolvedValue(undefined),
    mergeSnapshot: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(1),
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
  };
  return {
    service: new DatasetsService(
      repository as never,
      datasources as never,
      dataModels as never,
    ),
    repository,
    datasources,
    dataModels,
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

  it('bootstraps a data model on the first save of a dataset', async () => {
    const { service, dataModels } = build(jest.fn().mockResolvedValue(null));

    const saved = await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [claims],
      datasourceId: 'ds-1',
    });

    expect(dataModels.get).toHaveBeenCalledWith('health');
    expect(dataModels.ensureBootstrapped).toHaveBeenCalledWith(saved);
    expect(dataModels.mergeSnapshot).not.toHaveBeenCalled();
  });

  it('merges the snapshot instead of bootstrapping when a model already exists', async () => {
    const { service, dataModels } = build(jest.fn().mockResolvedValue(null), {
      existingModel: { dataset: 'health', currentVersion: 1, versions: [] },
    });

    const saved = await service.save({
      name: 'health',
      tables: ['main.health.claims'],
      entities: [claims],
      datasourceId: 'ds-1',
    });

    expect(dataModels.mergeSnapshot).toHaveBeenCalledWith(saved);
    expect(dataModels.ensureBootstrapped).not.toHaveBeenCalled();
  });
});

describe('DatasetsService.delete', () => {
  it('deletes the data model along with the dataset', async () => {
    const { service, repository, dataModels } = build(jest.fn());

    const removed = await service.delete('health');

    expect(removed).toBe(1);
    expect(repository.delete).toHaveBeenCalledWith('health');
    expect(dataModels.delete).toHaveBeenCalledWith('health');
  });

  it('does not touch the data model when nothing was deleted', async () => {
    const { service, repository, dataModels } = build(jest.fn());
    repository.delete.mockResolvedValueOnce(0);

    expect(await service.delete('missing')).toBe(0);
    expect(dataModels.delete).not.toHaveBeenCalled();
  });
});
