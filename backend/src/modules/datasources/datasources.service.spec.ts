jest.mock('./connectors/databricks.connector', () => ({
  DatabricksConnector: class {},
}));
jest.mock('./connectors/postgres.connector', () => ({
  PostgresConnector: class {},
}));
jest.mock('./connectors/rest.connector', () => ({
  RestConnector: class {},
}));

import { DatasourcesService } from './datasources.service';
import type { CatalogInfo, Datasource } from './entities/datasource.entity';

const datasource: Datasource = {
  id: 'ds-1',
  name: 'Databricks',
  kind: 'databricks',
  config: {
    host: 'example.cloud.databricks.com',
    token: 't',
    warehouseId: 'w',
  },
};

const catalogs: CatalogInfo[] = [{ name: 'main', schemas: [] }];

function build(cached: { catalogs: CatalogInfo[]; fetchedAt: string } | null) {
  const repository = {
    list: jest.fn().mockResolvedValue([datasource]),
    get: jest.fn().mockResolvedValue(datasource),
    delete: jest.fn().mockResolvedValue(1),
  };
  const store = { ...cached, id: datasource.id };
  const inventoryCache = {
    get: jest.fn().mockResolvedValue(cached ? store : null),
    save: jest.fn().mockResolvedValue(store),
    delete: jest.fn().mockResolvedValue(1),
  };
  const databricks = {
    inventory: jest.fn().mockResolvedValue(catalogs),
    summary: jest.fn().mockReturnValue(''),
    mask: jest.fn().mockReturnValue({}),
  };
  const service = new DatasourcesService(
    repository as never,
    inventoryCache as never,
    databricks as never,
    {} as never,
    {} as never,
  );
  return { service, repository, inventoryCache, databricks };
}

describe('DatasourcesService inventory cache', () => {
  it('serves the cached snapshot without touching the connector', async () => {
    const { service, inventoryCache, databricks } = build({
      catalogs,
      fetchedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await service.inventory('ds-1');

    expect(result).toEqual({
      catalogs,
      fetchedAt: '2024-01-01T00:00:00.000Z',
      cached: true,
    });
    expect(databricks.inventory).not.toHaveBeenCalled();
    expect(inventoryCache.save).not.toHaveBeenCalled();
  });

  it('runs a live inventory and stores it when nothing is cached', async () => {
    const { service, inventoryCache, databricks } = build(null);

    const result = await service.inventory('ds-1');

    expect(databricks.inventory).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.catalogs).toEqual(catalogs);
    expect(inventoryCache.save).toHaveBeenCalledWith(
      'ds-1',
      catalogs,
      result.fetchedAt,
    );
  });

  it('refresh=true bypasses the cache and overwrites it', async () => {
    const { service, inventoryCache, databricks } = build({
      catalogs: [],
      fetchedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await service.inventory('ds-1', true);

    expect(inventoryCache.get).not.toHaveBeenCalled();
    expect(databricks.inventory).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.fetchedAt).not.toBe('2024-01-01T00:00:00.000Z');
    expect(inventoryCache.save).toHaveBeenCalledWith(
      'ds-1',
      catalogs,
      result.fetchedAt,
    );
  });

  it('drops the cached inventory when the datasource is deleted', async () => {
    const { service, inventoryCache } = build(null);

    await service.delete('ds-1');

    expect(inventoryCache.delete).toHaveBeenCalledWith('ds-1');
  });
});

describe('DatasourcesService.cachedInventory', () => {
  it('returns the stored snapshot without touching the connector', async () => {
    const { service, databricks } = build({
      catalogs,
      fetchedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await service.cachedInventory('ds-1');

    expect(result).toEqual({
      catalogs,
      fetchedAt: '2024-01-01T00:00:00.000Z',
      cached: true,
    });
    expect(databricks.inventory).not.toHaveBeenCalled();
  });

  it('returns null instead of walking a datasource with no snapshot', async () => {
    const { service, databricks, inventoryCache } = build(null);

    const result = await service.cachedInventory('ds-1');

    expect(result).toBeNull();
    expect(databricks.inventory).not.toHaveBeenCalled();
    expect(inventoryCache.save).not.toHaveBeenCalled();
  });
});

describe('DatasourcesService layer and description', () => {
  const existing: Datasource = {
    ...datasource,
    layer: 'landing',
    description: 'x',
  };

  function setup(stored: Datasource | null = existing) {
    const repository = {
      get: jest.fn().mockResolvedValue(stored),
      list: jest.fn().mockResolvedValue([]),
      save: jest.fn((d: Datasource) =>
        Promise.resolve({ ...d, id: d.id ?? 'ds-new' }),
      ),
    };
    const databricks = {
      summary: jest.fn().mockReturnValue(''),
      mask: jest.fn().mockReturnValue({}),
    };
    const service = new DatasourcesService(
      repository as never,
      {} as never,
      databricks as never,
      {} as never,
      {} as never,
    );
    return { service, repository };
  }

  const base = {
    name: 'Databricks',
    kind: 'databricks' as const,
    config: datasource.config,
  };

  it('persists a trimmed description and the layer, and returns both', async () => {
    const { service, repository } = setup();
    const view = await service.save({
      ...base,
      layer: 'consumption',
      description: '  Gold tables  ',
    });
    const persisted = repository.save.mock.calls[0][0];
    expect(persisted.layer).toBe('consumption');
    expect(persisted.description).toBe('Gold tables');
    expect(view.layer).toBe('consumption');
    expect(view.description).toBe('Gold tables');
  });

  it('rejects an unknown layer and persists nothing', async () => {
    const { service, repository } = setup();
    await expect(
      service.save({ ...base, layer: 'bronze' as never }),
    ).rejects.toThrow('layer must be one of: landing, normalized, consumption');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects a non-string description and persists nothing', async () => {
    const { service, repository } = setup();
    await expect(
      service.save({ ...base, description: 5 as never }),
    ).rejects.toThrow('description must be a string');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('keeps layer and description when an edit omits them', async () => {
    const { service, repository } = setup();
    const view = await service.save({ ...base, id: 'ds-1' });
    const persisted = repository.save.mock.calls[0][0];
    expect(persisted.layer).toBe('landing');
    expect(persisted.description).toBe('x');
    expect(view.layer).toBe('landing');
    expect(view.description).toBe('x');
  });

  it.each([null, ''] as const)(
    'clears both when an edit sends layer %p and description null',
    async (layer) => {
      const { service, repository } = setup();
      const view = await service.save({
        ...base,
        id: 'ds-1',
        layer,
        description: null,
      });
      const persisted = repository.save.mock.calls[0][0];
      expect(persisted).not.toHaveProperty('layer');
      expect(persisted).not.toHaveProperty('description');
      expect(view).not.toHaveProperty('layer');
      expect(view).not.toHaveProperty('description');
    },
  );

  it('cuts a 600-character description to 500', async () => {
    const { service, repository } = setup();
    await service.save({ ...base, description: 'a'.repeat(600) });
    expect(repository.save.mock.calls[0][0].description).toBe('a'.repeat(500));
  });

  it('does not store a whitespace-only description', async () => {
    const { service, repository } = setup();
    await service.save({ ...base, description: '   ' });
    expect(repository.save.mock.calls[0][0]).not.toHaveProperty('description');
  });

  it('lists a datasource with neither field without the keys', async () => {
    const { service, repository } = setup();
    repository.list.mockResolvedValue([datasource]);
    const [view] = await service.list();
    expect(view).not.toHaveProperty('layer');
    expect(view).not.toHaveProperty('description');
  });
});
