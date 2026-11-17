jest.mock('./connectors/databricks.connector', () => ({
  DatabricksConnector: class {},
}));
jest.mock('./connectors/postgres.connector', () => ({
  PostgresConnector: class {},
}));
jest.mock('./connectors/rest.connector', () => ({
  RestConnector: class {},
}));
jest.mock('./connectors/file.connector', () => ({
  FileConnector: class {},
}));

import { join } from 'path';
import { DatasourcesService } from './datasources.service';
import type {
  CatalogInfo,
  Datasource,
  FileDatasourceConfig,
} from './entities/datasource.entity';

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

describe('DatasourcesService.save Databricks host (BA-322)', () => {
  it('stores the bare hostname when the form sends a workspace URL', async () => {
    const { service, repository } = build(null);
    const save = jest.fn((doc: Datasource) => Promise.resolve(doc));
    Object.assign(repository, { save });
    await service.save({
      name: 'Databricks',
      kind: 'databricks',
      config: {
        host: 'https://dbc-1.cloud.databricks.com/',
        token: 't',
        warehouseId: 'w',
      },
    });
    expect(save.mock.calls[0][0].config).toEqual({
      host: 'dbc-1.cloud.databricks.com',
      token: 't',
      warehouseId: 'w',
    });
  });
});

describe('DatasourcesService and the file kind (ADR-0052)', () => {
  const fileConfig: FileDatasourceConfig = { files: [] };
  const fileDatasource: Datasource = {
    id: 'ds-file',
    name: 'Sales sheets',
    kind: 'file',
    config: fileConfig,
  };

  function buildFile() {
    const repository = {
      get: jest.fn().mockResolvedValue(fileDatasource),
      save: jest.fn((doc: Datasource) => Promise.resolve(doc)),
    };
    const file = {
      sampleRows: jest.fn().mockResolvedValue({ columns: [], rows: [] }),
      testConnection: jest.fn().mockResolvedValue(undefined),
      summary: jest.fn().mockReturnValue('0 files · 0 tables'),
      mask: jest.fn((c: unknown) => c),
    };
    const service = new DatasourcesService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      file as never,
    );
    return { service, repository, file };
  }

  const previous = process.env.APP_DATA_DIR;
  beforeEach(() => {
    process.env.APP_DATA_DIR = join('/srv', 'app-data');
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
  });

  it('dispatches the file kind to its connector', () => {
    const { service, file } = buildFile();

    expect(service.connector('file')).toBe(file);
  });

  it('names file in the unknown-kind error', () => {
    const { service } = buildFile();

    expect(() => service.connector('excel' as never)).toThrow(
      'kind must be one of: databricks, postgres, rest, file',
    );
  });

  it('hands the connector the database path of the datasource, under the data dir', async () => {
    const { service, file } = buildFile();

    await service.sampleRows('ds-file', 'file.s.t', 5);

    expect(file.sampleRows).toHaveBeenCalledWith(
      {
        files: [],
        databasePath: join(
          '/srv',
          'app-data',
          'files',
          'ds-file',
          'data.duckdb',
        ),
      },
      'file.s.t',
      5,
    );
  });

  it('never trusts a database path the client sends', async () => {
    const { service, file } = buildFile();
    const sent = { files: [], databasePath: '/etc/other.duckdb' };

    // A test imports the files into a throwaway database of its own
    // (story 1.31.3); the client's path never reaches a connector.
    await expect(service.testConnection('file', sent)).rejects.toThrow(
      'Add at least one .xlsx or .csv file',
    );
    expect(file.testConnection).not.toHaveBeenCalled();
  });

  it('adds no password to a file config when it restores secrets', async () => {
    // A test (16) of a file config never reaches withSecrets (story 1.31.3);
    // a save of an existing file datasource does.
    const { service, repository } = buildFile();

    await service.save({
      id: 'ds-file',
      name: 'Sales sheets',
      kind: 'file',
      config: { files: [] },
    });

    const stored = repository.save.mock.calls[0][0].config as unknown as Record<
      string,
      unknown
    >;
    expect(stored).not.toHaveProperty('password');
  });

  it('never stores the database path', async () => {
    const { service, repository } = buildFile();

    await service.save({
      id: 'ds-file',
      name: 'Sales sheets',
      kind: 'file',
      config: { files: [], databasePath: '/x' } as never,
    });

    expect(repository.save.mock.calls[0][0].config).toEqual({ files: [] });
  });
});

describe('DatasourcesService.runReadOnlySql stop signal (datasources R38)', () => {
  function withSql() {
    const built = build(null);
    const runReadOnlySql = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue({ columns: [], rows: [], totalRows: 0 });
    Object.assign(built.databricks, { runReadOnlySql });
    return { ...built, runReadOnlySql };
  }

  it('hands the signal to the connector after the row limits', async () => {
    const { service, runReadOnlySql } = withSql();
    const { signal } = new AbortController();

    await service.runReadOnlySql('ds-1', 'SELECT 1', 10, 50_001, { signal });
    await service.runReadOnlySql('ds-1', 'SELECT 1', 10, undefined, {
      signal,
    });

    expect(runReadOnlySql.mock.calls[0].slice(1)).toEqual([
      'SELECT 1',
      10,
      50_001,
      { signal },
    ]);
    expect(runReadOnlySql.mock.calls[1].slice(1)).toEqual([
      'SELECT 1',
      10,
      undefined,
      { signal },
    ]);
  });

  it('calls the connector as before without options', async () => {
    const { service, runReadOnlySql } = withSql();

    await service.runReadOnlySql('ds-1', 'SELECT 1', 10);
    await service.runReadOnlySql('ds-1', 'SELECT 1', 10, 500);

    expect(runReadOnlySql.mock.calls[0]).toHaveLength(3);
    expect(runReadOnlySql.mock.calls[1]).toHaveLength(4);
  });
});
