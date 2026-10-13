import { findFixture, type SampleFixture } from '../fixtures/registry';
import {
  connectionFromEnv,
  datasetEntities,
  registerDatabricksFixture,
  RegisterError,
} from './register';

const WORLD_CUP = findFixture('world-cup-databricks') as SampleFixture;
const TARGET = { catalog: 'evals', schema: 'world_cup' };
const CONNECTION = {
  host: 'adb-1.azuredatabricks.net',
  warehouseId: 'abc123',
  token: 'dapi-secret',
};

/** The inventory a loaded World Cup sample returns: other catalogs too. */
function inventory(
  tables: string[] = [...WORLD_CUP.requiredTables, 'countries'],
) {
  return [
    { name: 'main', schemas: [{ name: 'default', tables: [] }] },
    {
      name: 'evals',
      schemas: [
        {
          name: 'world_cup',
          tables: tables.map((name) => ({
            name,
            columns: [{ name: 'id', type: 'bigint', nullable: false }],
          })),
        },
        // A same-named table in another schema never counts.
        { name: 'other', tables: [{ name: 'matches', columns: [] }] },
      ],
    },
  ];
}

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  authorization?: string;
}

/** A backend in local mode: answers by route, records every call. */
function fakeBackend(
  options: {
    existing?: { id: string; name: string }[];
    catalogs?: unknown[];
    signIn?: { status: number; body: unknown };
  } = {},
) {
  const calls: Call[] = [];
  const answer = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const path = url.replace('http://127.0.0.1:3000', '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method: init?.method ?? 'GET',
      path,
      // The module always sends a JSON string body.
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
      authorization: headers['authorization'],
    });
    if (path === '/auth/local/sign-in') {
      const signIn = options.signIn ?? {
        status: 200,
        body: { ok: true, message: 'Signed in', token: 'session-token' },
      };
      return answer(signIn.status, signIn.body);
    }
    if (path === '/datasources' && init?.method === 'GET') {
      return answer(200, { datasources: options.existing ?? [] });
    }
    if (path === '/datasources') {
      return answer(201, {
        ok: true,
        message: 'Datasource saved',
        datasource: {
          id: (calls[calls.length - 1].body?.id as string) ?? 'new-id',
        },
      });
    }
    if (path.startsWith('/datasources/')) {
      return answer(200, {
        ok: true,
        catalogs: options.catalogs ?? inventory(),
        cached: false,
      });
    }
    if (path === '/datasets') {
      return answer(201, {
        ok: true,
        message: 'Dataset "World Cup (Databricks)" saved — 10 entities',
      });
    }
    return answer(404, { message: 'no route' });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function register(backend: ReturnType<typeof fakeBackend>, log?: string[]) {
  return registerDatabricksFixture({
    backendUrl: 'http://127.0.0.1:3000/',
    fixture: WORLD_CUP,
    connection: CONNECTION,
    target: TARGET,
    fetch: backend.fetchImpl,
    log: log ? (line) => log.push(line) : undefined,
  });
}

describe('registering a loaded Databricks sample', () => {
  it('signs in, creates the datasource, reads the inventory and saves the required entities', async () => {
    const backend = fakeBackend();
    const log: string[] = [];

    const result = await register(backend, log);

    expect(backend.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /auth/local/sign-in',
      'GET /datasources',
      'POST /datasources',
      'GET /datasources/new-id/inventory?refresh=true',
      'POST /datasets',
    ]);
    expect(backend.calls[0]).toMatchObject({
      body: { userId: 'local' },
      authorization: undefined,
    });
    for (const call of backend.calls.slice(1)) {
      expect(call.authorization).toBe('Bearer session-token');
    }
    expect(backend.calls[2].body).toEqual({
      name: 'World Cup Databricks',
      kind: 'databricks',
      config: CONNECTION,
    });
    const keys = WORLD_CUP.requiredTables.map((t) => `evals.world_cup.${t}`);
    expect(backend.calls[4].body).toMatchObject({
      name: 'World Cup (Databricks)',
      tables: keys,
      datasourceId: 'new-id',
      datasourceKind: 'databricks',
    });
    expect(result).toEqual({
      datasourceId: 'new-id',
      created: true,
      entities: keys,
    });
    expect(log[log.length - 1]).toBe(
      '✔ Dataset "World Cup (Databricks)" saved — 10 entities',
    );
  });

  it('updates the datasource of the same name on a second run (idempotent)', async () => {
    const backend = fakeBackend({
      existing: [{ id: 'dbx-1', name: 'World Cup Databricks' }],
    });

    const result = await register(backend);

    expect(backend.calls[2].body).toMatchObject({
      id: 'dbx-1',
      name: 'World Cup Databricks',
    });
    expect(backend.calls[3].path).toBe(
      '/datasources/dbx-1/inventory?refresh=true',
    );
    expect(result.created).toBe(false);
  });

  it('refuses an org server backend, where it cannot sign in', async () => {
    const backend = fakeBackend({
      signIn: {
        status: 404,
        body: {
          statusCode: 404,
          message: 'Not available in org server mode',
          error: 'Not Found',
        },
      },
    });
    await expect(register(backend)).rejects.toThrow('runs in org server mode');
    expect(backend.calls).toHaveLength(1);
  });

  it('reports an unreachable backend with how to start it', async () => {
    const down = (() =>
      Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    await expect(
      registerDatabricksFixture({
        backendUrl: 'http://127.0.0.1:3000',
        fixture: WORLD_CUP,
        connection: CONNECTION,
        target: TARGET,
        fetch: down,
      }),
    ).rejects.toThrow(
      'the backend at http://127.0.0.1:3000 did not answer POST /auth/local/sign-in (fetch failed)',
    );
  });

  it('saves no dataset when a required table is missing from the inventory', async () => {
    const backend = fakeBackend({
      catalogs: inventory(
        WORLD_CUP.requiredTables.filter((t) => t !== 'goals'),
      ),
    });
    await expect(register(backend)).rejects.toThrow(
      'evals.world_cup.goals: missing from the inventory',
    );
    expect(backend.calls.map((c) => c.path)).not.toContain('/datasets');
  });
});

describe('the dataset entities', () => {
  it('match the catalog and schema ignoring case and keep the inventory spelling', () => {
    const entities = datasetEntities(inventory(), WORLD_CUP, {
      catalog: 'EVALS',
      schema: 'World_Cup',
    });
    expect(entities.map((e) => e.key)).toEqual(
      WORLD_CUP.requiredTables.map((t) => `evals.world_cup.${t}`),
    );
  });

  it('report every browse-only or empty table, and a schema the inventory lacks', () => {
    const catalogs = inventory();
    const tables = catalogs[1].schemas[0].tables as {
      name: string;
      selectable?: boolean;
      columns: unknown[];
    }[];
    tables[0].selectable = false;
    tables[1].columns = [];
    expect(() => datasetEntities(catalogs as never, WORLD_CUP, TARGET)).toThrow(
      `evals.world_cup.${tables[0].name}: browse-only, the token cannot query it\n` +
        `  - evals.world_cup.${tables[1].name}: no columns`,
    );
    expect(() =>
      datasetEntities(catalogs as never, WORLD_CUP, {
        catalog: 'evals',
        schema: 'finance',
      }),
    ).toThrow(RegisterError);
  });
});

describe('the connection from the environment', () => {
  it('takes the warehouse from the HTTP path or the id, and strips the scheme from the host', () => {
    expect(
      connectionFromEnv({
        DATABRICKS_HOST: 'https://adb-1.azuredatabricks.net/',
        DATABRICKS_TOKEN: ' dapi-secret ',
        DATABRICKS_HTTP_PATH: '/sql/1.0/warehouses/abc123',
      }),
    ).toEqual({
      host: 'adb-1.azuredatabricks.net',
      token: 'dapi-secret',
      warehouseId: 'abc123',
      httpPath: '/sql/1.0/warehouses/abc123',
    });
    expect(
      connectionFromEnv({
        DATABRICKS_HOST: 'adb-1.azuredatabricks.net',
        DATABRICKS_TOKEN: 't',
        DATABRICKS_WAREHOUSE_ID: 'abc123',
      }).httpPath,
    ).toBe('/sql/1.0/warehouses/abc123');
  });

  it('reports every missing or wrong variable at once, never the token', () => {
    let message = '';
    try {
      connectionFromEnv({
        DATABRICKS_HOST: 'not a host',
        DATABRICKS_HTTP_PATH: 'sql/protocolv1/o/123/0123-456789-abc',
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('DATABRICKS_HOST "not a host" is not a hostname');
    expect(message).toContain('DATABRICKS_TOKEN is not set');
    expect(message).toContain('is not a SQL warehouse path');
    expect(() =>
      connectionFromEnv({
        DATABRICKS_HOST: 'h',
        DATABRICKS_TOKEN: 'dapi-secret',
        DATABRICKS_HTTP_PATH: '/sql/1.0/warehouses/one',
        DATABRICKS_WAREHOUSE_ID: 'two',
      }),
    ).toThrow('names warehouse one but DATABRICKS_WAREHOUSE_ID is two');
    expect(() =>
      connectionFromEnv({
        DATABRICKS_HOST: 'h',
        DATABRICKS_TOKEN: 'dapi-secret',
      }),
    ).toThrow(/set DATABRICKS_HTTP_PATH .* or DATABRICKS_WAREHOUSE_ID/);
  });
});
