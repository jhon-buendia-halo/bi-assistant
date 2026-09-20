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

function build(sampleRows: jest.Mock) {
  const repository = {
    save: jest
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve({ name, tables: [] }),
      ),
  };
  const datasources = {
    get: jest
      .fn()
      .mockResolvedValue({ id: 'ds-1', kind: 'databricks', name: 'DBX' }),
    sampleRows,
  };
  return {
    service: new DatasetsService(repository as never, datasources as never),
    repository,
    datasources,
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
});
