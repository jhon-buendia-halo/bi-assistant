jest.mock('pg', () => ({ Client: jest.fn() }));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));

import { Client } from 'pg';
import {
  TestingDataService,
  type SampleFixtureView,
  type TestingDataStatus,
} from './testing-data.service';
import {
  SAMPLE_FIXTURES,
  findFixture,
  requiredEntityKeys,
  type SampleFixture,
} from './fixtures/registry';
import type { CatalogInfo } from '../datasources/entities/datasource.entity';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';

/** Everything below is driven by the registry entry, never by a local copy. */
const WORLD_CUP = findFixture('world-cup') as SampleFixture;
const REQUIRED_TABLES = WORLD_CUP.requiredTables;
/** The keys the repo defaults produce: catalog and schema are both world_cup. */
const REQUIRED_ENTITY_KEYS = requiredEntityKeys(WORLD_CUP, WORLD_CUP.schema);
const TESTING_DATASOURCE_NAME = WORLD_CUP.datasourceName;
const TESTING_DATASET_NAME = WORLD_CUP.datasetName;

const DEFAULT_INPUT = {
  host: '127.0.0.1',
  port: 55432,
  database: 'world_cup',
  user: 'world_cup',
  password: 'world_cup_dev',
  ssl: false,
};

const savedDatasource = {
  id: 'ds-1',
  name: TESTING_DATASOURCE_NAME,
  kind: 'postgres' as const,
  summary: '127.0.0.1:55432/world_cup',
  config: {},
};

/** The datasource view the app stores once loaded — password already masked. */
const loadedDatasourceView = {
  id: 'ds-1',
  name: TESTING_DATASOURCE_NAME,
  kind: 'postgres' as const,
  config: {
    host: '127.0.0.1',
    port: 55432,
    database: 'world_cup',
    user: 'world_cup',
    password: '********',
    ssl: false,
  },
};

// ---------------------------------------------------------------- pg doubles

interface FakeClient {
  options: Record<string, unknown>;
  connect: jest.Mock;
  query: jest.Mock;
  end: jest.Mock;
}

let clients: FakeClient[] = [];
/** Per-connect hook: return an Error to fail that connection attempt. */
let onConnect: (options: Record<string, unknown>) => Error | undefined;
/** Per-query hook: return an Error to fail that statement. */
let onQuery: (
  sql: string,
  options: Record<string, unknown>,
) => Error | undefined;

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function queriesOn(database: string): string[] {
  return clients
    .filter((client) => client.options.database === database)
    .flatMap((client) =>
      client.query.mock.calls.map(([sql]) => String(sql as string)),
    );
}

beforeEach(() => {
  clients = [];
  onConnect = () => undefined;
  onQuery = () => undefined;
  const ClientMock = Client as unknown as jest.Mock;
  ClientMock.mockReset();
  ClientMock.mockImplementation((options: Record<string, unknown>) => {
    const client: FakeClient = {
      options,
      connect: jest.fn(() => {
        const err = onConnect(options);
        return err ? Promise.reject(err) : Promise.resolve();
      }),
      query: jest.fn((sql: string) => {
        const err = onQuery(sql, options);
        return err
          ? Promise.reject(err)
          : Promise.resolve({ rows: [], fields: [] });
      }),
      end: jest.fn(() => Promise.resolve()),
    };
    clients.push(client);
    return client;
  });
});

// ------------------------------------------------------------ service double

/** The fixture's inventory: one catalog (the database), one schema, every table. */
function inventory(
  tables: string[] = REQUIRED_TABLES,
  database = 'world_cup',
  schema = WORLD_CUP.schema,
): CatalogInfo[] {
  return [
    {
      name: database,
      schemas: [
        {
          name: schema,
          tables: tables.map((name) => ({
            name,
            columns: [
              { name: 'id', type: 'integer', nullable: false },
              { name: 'label', type: 'text', nullable: true },
            ],
          })),
        },
        // A same-named table in another schema must never satisfy a requirement.
        { name: 'public', tables: [{ name: 'teams', columns: [] }] },
      ],
    },
  ];
}

function build(overrides: {
  existing?: unknown[];
  catalogs?: CatalogInfo[];
  datasets?: DatasetDoc[];
  deletedDatasets?: number;
}) {
  const datasources = {
    list: jest.fn().mockResolvedValue(overrides.existing ?? []),
    save: jest.fn().mockResolvedValue(savedDatasource),
    delete: jest.fn().mockResolvedValue(savedDatasource),
    inventory: jest.fn().mockResolvedValue({
      catalogs: overrides.catalogs ?? inventory(),
      fetchedAt: '2024-01-01T00:00:00.000Z',
      cached: false,
    }),
  };
  const datasets = {
    list: jest.fn().mockResolvedValue(overrides.datasets ?? []),
    save: jest.fn().mockResolvedValue({ name: TESTING_DATASET_NAME }),
    delete: jest.fn().mockResolvedValue(overrides.deletedDatasets ?? 0),
  };
  const service = new TestingDataService(
    datasources as never,
    datasets as never,
  );
  return { service, datasources, datasets };
}

/** The single fixture entry of a status response. */
function viewOf(
  status: TestingDataStatus,
  id = 'world-cup',
): SampleFixtureView {
  const view = status.fixtures.find((fixture) => fixture.id === id);
  if (!view) throw new Error(`No fixture "${id}" in the status response`);
  return view;
}

describe('TestingDataService.load', () => {
  it('rejects an unknown fixture id before touching anything', async () => {
    const { service, datasources, datasets } = build({});

    expect(await service.load('not-a-sample', DEFAULT_INPUT)).toEqual({
      ok: false,
      message: 'Unknown sample fixture "not-a-sample"',
    });
    expect(clients).toHaveLength(0);
    expect(datasources.list).not.toHaveBeenCalled();
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('rejects a bad connection before touching the network', async () => {
    const { service, datasources, datasets } = build({});

    expect(
      await service.load('world-cup', { ...DEFAULT_INPUT, host: '  ' }),
    ).toEqual({
      ok: false,
      message: 'Host is required',
    });
    expect(
      await service.load('world-cup', { ...DEFAULT_INPUT, port: 0 }),
    ).toEqual({
      ok: false,
      message: 'Port must be a positive integer',
    });
    expect(clients).toHaveLength(0);
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('rejects a database name containing a double quote', async () => {
    const { service, datasources } = build({});

    const result = await service.load('world-cup', {
      ...DEFAULT_INPUT,
      database: 'world"cup',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('double quote');
    expect(clients).toHaveLength(0);
    expect(datasources.save).not.toHaveBeenCalled();
  });

  it('writes nothing when the connection is refused', async () => {
    const { service, datasources, datasets } = build({});
    onConnect = () =>
      pgError('connect ECONNREFUSED 127.0.0.1:55432', 'ECONNREFUSED');

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('127.0.0.1:55432');
    expect(result.message).toContain('docker compose up -d');
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
    // Even a failed connect must not leak a socket.
    expect(clients.every((client) => client.end.mock.calls.length > 0)).toBe(
      true,
    );
  });

  it('names the host and the user when authentication fails', async () => {
    const { service, datasources } = build({});
    onConnect = () =>
      pgError('password authentication failed for user "world_cup"', '28P01');

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('127.0.0.1:55432');
    expect(result.message).toContain('password authentication failed');
    expect(result.message).not.toContain('world_cup_dev');
    expect(datasources.save).not.toHaveBeenCalled();
  });

  it('creates the database when it does not exist, then seeds it', async () => {
    const { service, datasets } = build({});
    let exists = false;
    onConnect = (options) =>
      options.database === 'world_cup' && !exists
        ? pgError('database "world_cup" does not exist', '3D000')
        : undefined;
    onQuery = (sql) => {
      if (sql.startsWith('CREATE DATABASE')) exists = true;
      return undefined;
    };

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(true);
    expect(result.createdDatabase).toBe(true);
    expect(result.message).toContain('created the database');
    expect(queriesOn('postgres')).toEqual(['CREATE DATABASE "world_cup"']);
    const seeded = queriesOn('world_cup');
    expect(seeded[0]).toBe('DROP SCHEMA IF EXISTS "world_cup" CASCADE');
    expect(seeded.join('\n')).toContain('CREATE SCHEMA world_cup');
    expect(datasets.save).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the database is missing and cannot be created', async () => {
    const { service, datasources, datasets } = build({});
    onConnect = (options) =>
      options.database === 'world_cup'
        ? pgError('database "world_cup" does not exist', '3D000')
        : undefined;
    onQuery = (sql) =>
      sql.startsWith('CREATE DATABASE')
        ? pgError('permission denied to create database', '42501')
        : undefined;

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('does not exist');
    expect(result.message).toContain('could not create it');
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('seeds the fixture and saves the datasource and dataset', async () => {
    const { service, datasources, datasets } = build({});

    const result = await service.load('world-cup', DEFAULT_INPUT);

    const seeded = queriesOn('world_cup');
    expect(seeded[0]).toBe('DROP SCHEMA IF EXISTS "world_cup" CASCADE');
    // The script is replayed in bounded batches wrapped in one transaction:
    // a whole dump in a single query exhausts the server's shared memory.
    expect(seeded[1]).toBe('BEGIN');
    expect(seeded[seeded.length - 1]).toBe('COMMIT');
    expect(seeded.length).toBeGreaterThan(2);
    const body = seeded.slice(2, -1).join('\n');
    expect(body).toContain('CREATE TABLE match_team_statistics');
    // The dump's own BEGIN/COMMIT must not nest inside ours.
    expect(
      seeded.slice(2, -1).some((sql) => /^(BEGIN|COMMIT);?$/m.test(sql)),
    ).toBe(false);
    expect(clients.every((client) => client.end.mock.calls.length > 0)).toBe(
      true,
    );

    expect(datasources.save).toHaveBeenCalledWith({
      id: undefined,
      name: TESTING_DATASOURCE_NAME,
      kind: 'postgres',
      config: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        password: 'world_cup_dev',
        ssl: false,
      },
    });
    expect(datasources.inventory).toHaveBeenCalledWith('ds-1', true);

    const [saved] = datasets.save.mock.calls[0] as [
      {
        name: string;
        tables: string[];
        entities: { key: string; columns: unknown[] }[];
        datasourceId: string;
      },
    ];
    expect(saved.name).toBe(TESTING_DATASET_NAME);
    expect(saved.datasourceId).toBe('ds-1');
    expect(saved.tables).toEqual(REQUIRED_ENTITY_KEYS);
    expect(saved.entities).toHaveLength(9);
    expect(saved.entities[0]).toEqual({
      key: 'world_cup.world_cup.tournaments',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'label', type: 'text', nullable: true },
      ],
    });
    expect(result).toEqual({
      ok: true,
      message:
        'Seeded world_cup on 127.0.0.1:55432 and loaded 9 entities into dataset "World Cup"',
      datasourceId: 'ds-1',
      datasetName: TESTING_DATASET_NAME,
      entityCount: 9,
      createdDatabase: false,
      seeded: true,
    });
  });

  it('reuses the existing datasource instead of creating a duplicate', async () => {
    const { service, datasources, datasets } = build({
      existing: [
        { id: 'other', name: 'Some other datasource' },
        loadedDatasourceView,
      ],
    });

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(true);
    expect(datasources.save).toHaveBeenCalledTimes(1);
    expect(datasources.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ds-1', name: TESTING_DATASOURCE_NAME }),
    );
    // Upsert-by-name on the dataset side: one save, one dataset.
    expect(datasets.save).toHaveBeenCalledTimes(1);
  });

  it('reports the entity that is still missing after seeding', async () => {
    const { service, datasets } = build({
      catalogs: inventory(
        REQUIRED_TABLES.filter((table) => table !== 'v_player_goal_totals'),
      ),
    });

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      'Missing entities after seeding: world_cup.world_cup.v_player_goal_totals',
    );
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('derives the entity keys from the supplied database name', async () => {
    const { service, datasets } = build({
      catalogs: inventory(REQUIRED_TABLES, 'wc_demo'),
    });

    const result = await service.load('world-cup', {
      ...DEFAULT_INPUT,
      database: 'wc_demo',
    });

    expect(result.ok).toBe(true);
    const [saved] = datasets.save.mock.calls[0] as [{ tables: string[] }];
    expect(saved.tables[0]).toBe('wc_demo.world_cup.tournaments');
  });
});

/**
 * A sample too large to bundle: the registry entry carries no `seedFile`, so
 * the panel can point the app at a database that already holds the data.
 * Registered here only for the duration of these tests — the shipped registry
 * still has exactly one entry.
 */
describe('a register-only fixture (no bundled SQL)', () => {
  const REGISTER_ONLY: SampleFixture = {
    id: 'register-only',
    name: 'Register Only',
    description: 'A sample too large to bundle; the database already has it.',
    schema: 'huge',
    defaults: {
      host: 'db.internal',
      port: 5432,
      database: 'huge',
      user: 'reader',
      password: '',
      ssl: true,
    },
    datasourceName: 'Register Only PostgreSQL',
    datasetName: 'Register Only',
    requiredTables: ['alpha', 'beta'],
  };

  beforeEach(() => SAMPLE_FIXTURES.push(REGISTER_ONLY));
  afterEach(() => {
    const at = SAMPLE_FIXTURES.indexOf(REGISTER_ONLY);
    if (at >= 0) SAMPLE_FIXTURES.splice(at, 1);
  });

  const input = {
    host: 'db.internal',
    port: 5432,
    database: 'huge',
    user: 'reader',
    password: 'secret',
    ssl: true,
  };

  it('skips DROP SCHEMA and the seed, and still registers both records', async () => {
    const { service, datasources, datasets } = build({
      catalogs: inventory(REGISTER_ONLY.requiredTables, 'huge', 'huge'),
    });

    const result = await service.load('register-only', input);

    // No SQL at all: the connection is a preflight, nothing is written.
    expect(queriesOn('huge')).toEqual([]);
    expect(clients.every((client) => client.end.mock.calls.length > 0)).toBe(
      true,
    );
    expect(datasources.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Register Only PostgreSQL',
        kind: 'postgres',
      }),
    );
    const [saved] = datasets.save.mock.calls[0] as [
      { name: string; tables: string[] },
    ];
    expect(saved.name).toBe('Register Only');
    expect(saved.tables).toEqual(['huge.huge.alpha', 'huge.huge.beta']);
    expect(result.message).toContain('nothing was written to the database');
    // Exhaustive, so a stray field would fail: the message is asserted above.
    expect(result).toEqual({
      ok: true,
      message: result.message,
      datasourceId: 'ds-1',
      datasetName: 'Register Only',
      entityCount: 2,
      createdDatabase: false,
      seeded: false,
    });
  });

  it('does not create the database it cannot seed', async () => {
    const { service, datasources, datasets } = build({});
    onConnect = (options) =>
      options.database === 'huge'
        ? pgError('database "huge" does not exist', '3D000')
        : undefined;

    const result = await service.load('register-only', input);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ships no seed SQL');
    expect(queriesOn('postgres')).toEqual([]);
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('is reported as not seedable, alongside the seedable samples', async () => {
    const { service } = build({});

    const status = await service.status();

    expect(status.fixtures.map((fixture) => fixture.id)).toEqual([
      'world-cup',
      'formula-1',
      'register-only',
    ]);
    expect(viewOf(status, 'world-cup').seedable).toBe(true);
    const view = viewOf(status, 'register-only');
    expect(view.seedable).toBe(false);
    expect(view.defaults).toEqual(REGISTER_ONLY.defaults);
    expect(view.status).toEqual({ loaded: false, requiredCount: 2 });
  });
});

describe('TestingDataService.clear', () => {
  it('removes both records without running any SQL', async () => {
    const { service, datasources, datasets } = build({
      existing: [loadedDatasourceView],
      deletedDatasets: 1,
    });

    const result = await service.clear('world-cup');

    expect(result.ok).toBe(true);
    expect(datasets.delete).toHaveBeenCalledWith(TESTING_DATASET_NAME);
    expect(datasources.delete).toHaveBeenCalledWith('ds-1');
    expect(clients).toHaveLength(0);
    expect(result.message).toContain('left untouched');
  });

  it('is a no-op when nothing is loaded', async () => {
    const { service, datasources } = build({});

    const result = await service.clear('world-cup');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Nothing to remove');
    expect(datasources.delete).not.toHaveBeenCalled();
    expect(clients).toHaveLength(0);
  });

  it('refuses an unknown fixture id and deletes nothing', async () => {
    const { service, datasources, datasets } = build({
      existing: [loadedDatasourceView],
      deletedDatasets: 1,
    });

    expect(await service.clear('not-a-sample')).toEqual({
      ok: false,
      message: 'Unknown sample fixture "not-a-sample"',
    });
    expect(datasets.delete).not.toHaveBeenCalled();
    expect(datasources.delete).not.toHaveBeenCalled();
  });
});

describe('TestingDataService.status', () => {
  const defaults = {
    host: '127.0.0.1',
    port: 55432,
    database: 'world_cup',
    user: 'world_cup',
    password: 'world_cup_dev',
    ssl: false,
  };

  it('describes every registered fixture, loaded or not', async () => {
    const { service, datasets } = build({});

    const status = await service.status();

    expect(status.fixtures).toHaveLength(SAMPLE_FIXTURES.length);
    expect(viewOf(status)).toEqual({
      id: 'world-cup',
      name: 'World Cup',
      description: WORLD_CUP.description,
      seedable: true,
      schema: 'world_cup',
      defaults,
      status: { loaded: false, requiredCount: 9 },
    });
    // Nothing is registered, so the datasets never need reading.
    expect(datasets.list).not.toHaveBeenCalled();
  });

  it('is not loaded when the dataset is missing entities', async () => {
    const { service } = build({
      existing: [loadedDatasourceView],
      datasets: [
        {
          name: TESTING_DATASET_NAME,
          tables: REQUIRED_ENTITY_KEYS.slice(0, 8),
        },
      ],
    });

    expect(viewOf(await service.status()).status).toEqual({
      loaded: false,
      datasourceId: 'ds-1',
      datasourceName: TESTING_DATASOURCE_NAME,
      datasetName: TESTING_DATASET_NAME,
      entityCount: 8,
      requiredCount: 9,
      connection: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        ssl: false,
      },
    });
  });

  it('is not loaded when the datasource exists but the dataset does not', async () => {
    const { service } = build({
      existing: [loadedDatasourceView],
      datasets: [{ name: 'Unrelated', tables: [] }],
    });

    expect(viewOf(await service.status()).status).toEqual({
      loaded: false,
      datasourceId: 'ds-1',
      datasourceName: TESTING_DATASOURCE_NAME,
      requiredCount: 9,
      connection: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        ssl: false,
      },
    });
  });

  it('is loaded once the dataset covers all nine entities, and never echoes a password', async () => {
    const { service } = build({
      existing: [loadedDatasourceView],
      datasets: [
        { name: 'Unrelated', tables: [] },
        { name: TESTING_DATASET_NAME, tables: REQUIRED_ENTITY_KEYS },
      ],
    });

    const view = viewOf(await service.status());

    expect(view.status.loaded).toBe(true);
    expect(view.status.entityCount).toBe(9);
    expect(view.status.requiredCount).toBe(9);
    expect(view.defaults).toEqual(defaults);
    expect(view.status.connection).toEqual({
      host: '127.0.0.1',
      port: 55432,
      database: 'world_cup',
      user: 'world_cup',
      ssl: false,
    });
    expect(view.status.connection).not.toHaveProperty('password');
    expect(JSON.stringify(view.status.connection)).not.toContain('*');
  });
});

describe('TestingDataService.describe', () => {
  it('lists the registry without reading a single store', () => {
    const { service, datasources, datasets } = build({});

    expect(service.describe()).toEqual({
      fixtures: SAMPLE_FIXTURES.map((fixture) => ({
        id: fixture.id,
        name: fixture.name,
        description: fixture.description,
        seedable: Boolean(fixture.seedFile),
        schema: fixture.schema,
        defaults: fixture.defaults,
        status: {
          loaded: false,
          requiredCount: fixture.requiredTables.length,
        },
      })),
    });
    expect(datasources.list).not.toHaveBeenCalled();
    expect(datasets.list).not.toHaveBeenCalled();
  });
});
