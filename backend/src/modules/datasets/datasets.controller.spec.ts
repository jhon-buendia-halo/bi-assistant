// The service imports the datasource connectors (ESM Databricks driver Jest can't load).
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import { DatasetsController } from './datasets.controller';
import type { DatasetsService } from './datasets.service';
import type { DatasetDoc } from './repositories/datasets.repository';

const FULL: DatasetDoc = {
  name: 'World Cup',
  datasourceId: 'pg',
  datasourceKind: 'postgres',
  tables: ['public.matches'],
  entities: [{ name: 'public.matches', columns: [] }] as never,
  schemas: [{ schema: 'public', layer: 'gold', description: '' }] as never,
  updatedAt: '2026-11-16T00:00:00.000Z',
};

describe('DatasetsController.list (api.md 21)', () => {
  const controller = new DatasetsController({
    list: () => Promise.resolve([FULL]),
  } as unknown as DatasetsService);

  it('answers whole datasets by default', async () => {
    expect(await controller.list()).toEqual({ datasets: [FULL] });
    expect(await controller.list('everything')).toEqual({ datasets: [FULL] });
  });

  it('answers datasets without their snapshot and notes with view=summary', async () => {
    expect(await controller.list('summary')).toEqual({
      datasets: [
        {
          name: 'World Cup',
          datasourceId: 'pg',
          datasourceKind: 'postgres',
          tables: ['public.matches'],
          updatedAt: '2026-11-16T00:00:00.000Z',
        },
      ],
    });
  });
});
