jest.mock('./connectors/databricks.connector', () => ({
  DatabricksConnector: class {},
}));
jest.mock('./connectors/postgres.connector', () => ({
  PostgresConnector: class {},
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
