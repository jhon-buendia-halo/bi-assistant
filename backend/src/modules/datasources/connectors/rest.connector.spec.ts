import { BadRequestException, Logger } from '@nestjs/common';
import type {
  RestApiConfig,
  RestEndpointDef,
} from '../entities/datasource.entity';
import { MASKED } from './connector';
import { RestConnector } from './rest.connector';

type Responder = (url: URL, init: RequestInit) => unknown;

let respond: Responder = () => [];
let fetchMock: jest.SpyInstance;

function calls(): { url: URL; init: RequestInit }[] {
  return fetchMock.mock.calls.map(([url, init]: [string, RequestInit]) => ({
    url: new URL(url),
    init,
  }));
}

function headersOf(call: number): Record<string, string> {
  return calls()[call].init.headers as Record<string, string>;
}

function build(
  endpoints: RestEndpointDef[],
  overrides: Partial<RestApiConfig> = {},
): RestApiConfig {
  return {
    baseUrl: 'https://api.example.com/v1',
    auth: { type: 'none' },
    endpoints,
    ...overrides,
  };
}

const customers: RestEndpointDef = { name: 'customers', path: '/customers' };
const orders: RestEndpointDef = { name: 'orders', path: '/orders' };

beforeEach(() => {
  respond = () => [];
  fetchMock = jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const result = respond(new URL(input as string), init ?? {});
    if (result instanceof Response) return Promise.resolve(result);
    return Promise.resolve(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RestConnector row extraction', () => {
  it('follows a nested rowsPointer', async () => {
    respond = () => ({ data: { items: [{ id: 1 }, { id: 2 }] } });

    const result = await new RestConnector().sampleRows(
      build([{ ...customers, rowsPointer: '/data/items' }]),
      'api.default.customers',
      10,
    );

    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('reads a root array when no pointer is set', async () => {
    respond = () => [{ id: 1 }, { id: 2 }, { id: 3 }];

    const result = await new RestConnector().sampleRows(
      build([customers]),
      'api.default.customers',
      10,
    );

    expect(result.columns).toEqual(['id']);
    expect(result.rows).toHaveLength(3);
  });

  it('treats a single object as one row', async () => {
    respond = () => ({ id: 7, name: 'Ada' });

    const result = await new RestConnector().sampleRows(
      build([customers]),
      'api.default.customers',
      10,
    );

    expect(result.rows).toEqual([{ id: 7, name: 'Ada' }]);
  });

  it('rejects a pointer that resolves to something else', async () => {
    respond = () => ({ data: 'nope' });

    await expect(
      new RestConnector().sampleRows(
        build([{ ...customers, rowsPointer: '/data' }]),
        'api.default.customers',
        10,
      ),
    ).rejects.toThrow('expected an array or object');
  });
});

describe('RestConnector flattening and inference', () => {
  it('dot-flattens nested objects and serialises arrays', async () => {
    respond = () => [
      {
        id: 1,
        address: { city: 'Lima', geo: { lat: 1.5 } },
        tags: ['a', 'b'],
        deep: { a: { b: { c: { d: 1 } } } },
      },
    ];

    const result = await new RestConnector().sampleRows(
      build([customers]),
      'api.default.customers',
      10,
    );

    expect(result.rows[0]).toEqual({
      id: 1,
      'address.city': 'Lima',
      'address.geo.lat': 1.5,
      tags: '["a","b"]',
      'deep.a.b.c': '{"d":1}',
    });
  });

  it('infers column types and nullability across rows', async () => {
    respond = () => [
      { id: 1, name: null, active: true, tags: ['x'] },
      { id: 2, name: 'Ada', active: false, tags: ['y'], extra: 'z' },
    ];

    const catalogs = await new RestConnector().inventory(build([customers]));

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].name).toBe('api');
    expect(catalogs[0].schemas[0].name).toBe('default');
    const columns = catalogs[0].schemas[0].tables[0].columns;
    expect(columns).toEqual([
      { name: 'id', type: 'number', nullable: false },
      { name: 'name', type: 'string', nullable: true },
      { name: 'active', type: 'boolean', nullable: false },
      { name: 'tags', type: 'json', nullable: false },
      { name: 'extra', type: 'string', nullable: true },
    ]);
  });

  it('sanitises group and endpoint names and marks failures unselectable', async () => {
    respond = (url) =>
      url.pathname.endsWith('/broken')
        ? new Response('boom', { status: 500 })
        : [{ id: 1 }];

    const catalogs = await new RestConnector().inventory(
      build([
        { name: 'Order Items', group: 'Sales-EU', path: '/items' },
        { name: 'broken', group: 'Sales-EU', path: '/broken' },
      ]),
    );

    const schema = catalogs[0].schemas[0];
    expect(schema.name).toBe('sales_eu');
    expect(schema.tables).toEqual([
      {
        name: 'order_items',
        columns: [{ name: 'id', type: 'number', nullable: false }],
      },
      { name: 'broken', columns: [], selectable: false },
    ]);
  });
});

describe('RestConnector requests', () => {
  it('merges params into a path that already has a query string', async () => {
    respond = () => [];

    await new RestConnector().sampleRows(
      build([
        {
          name: 'customers',
          path: '/customers?status=active',
          pagination: { style: 'page', pageSize: 25 },
        },
      ]),
      'api.default.customers',
      10,
    );

    const url = calls()[0].url;
    expect(url.origin + url.pathname).toBe(
      'https://api.example.com/v1/customers',
    );
    expect(url.searchParams.get('status')).toBe('active');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('per_page')).toBe('25');
  });

  it('builds headers per auth type and merges static headers', async () => {
    const connector = new RestConnector();
    const run = (auth: RestApiConfig['auth']) =>
      connector.testConnection(
        build([customers], { auth, headers: { 'X-Tenant': 't1' } }),
      );

    await run({ type: 'none' });
    await run({ type: 'bearer', token: 'tok' });
    await run({ type: 'api-key-header', token: 'key' });
    await run({ type: 'api-key-header', token: 'key', headerName: 'X-Auth' });
    await run({ type: 'basic', username: 'ada', password: 'pw' });

    expect(headersOf(0).Authorization).toBeUndefined();
    expect(headersOf(0)['X-Tenant']).toBe('t1');
    expect(headersOf(1).Authorization).toBe('Bearer tok');
    expect(headersOf(2)['X-API-Key']).toBe('key');
    expect(headersOf(3)['X-Auth']).toBe('key');
    expect(headersOf(4).Authorization).toBe(
      `Basic ${Buffer.from('ada:pw').toString('base64')}`,
    );
  });

  it('reports the status and a truncated body on non-2xx', async () => {
    respond = () => new Response('x'.repeat(500), { status: 503 });

    const error = await new RestConnector()
      .sampleRows(build([customers]), 'api.default.customers', 10)
      .catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 503');
    expect((error as Error).message.length).toBeLessThan(300);
  });

  it('testConnection needs a base URL and an endpoint', async () => {
    const connector = new RestConnector();
    await expect(
      connector.testConnection(build([customers], { baseUrl: ' ' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(connector.testConnection(build([]))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('testConnection asks style-aware for a single row', async () => {
    await new RestConnector().testConnection(
      build([
        {
          ...customers,
          pagination: { style: 'offset', sizeParam: 'count', pageSize: 500 },
        },
      ]),
    );

    const params = calls()[0].url.searchParams;
    expect(params.get('count')).toBe('1');
    expect(params.get('offset')).toBe('0');
  });

  it('rejects entities that are not declared endpoints', async () => {
    await expect(
      new RestConnector().sampleRows(
        build([customers]),
        'api.default.missing',
        10,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RestConnector pagination', () => {
  it('page style stops on an empty page', async () => {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }], []];
    respond = (url) => pages[Number(url.searchParams.get('page')) - 1];

    const result = await new RestConnector().sampleRows(
      build([{ ...customers, pagination: { style: 'page', pageSize: 2 } }]),
      'api.default.customers',
      100,
    );

    expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(calls()).toHaveLength(3);
  });

  it('offset style advances by the rows received', async () => {
    const all = [1, 2, 3, 4, 5].map((id) => ({ id }));
    respond = (url) => {
      const offset = Number(url.searchParams.get('offset'));
      return all.slice(offset, offset + 2);
    };

    const result = await new RestConnector().sampleRows(
      build([{ ...customers, pagination: { style: 'offset', pageSize: 2 } }]),
      'api.default.customers',
      100,
    );

    expect(result.rows).toHaveLength(5);
  });

  it('cursor style follows cursorPointer and stops when it is absent', async () => {
    respond = (url) => {
      const cursor = url.searchParams.get('after');
      if (!cursor) return { items: [{ id: 1 }], meta: { next: 'c2' } };
      if (cursor === 'c2') return { items: [{ id: 2 }], meta: { next: 'c3' } };
      return { items: [{ id: 3 }], meta: {} };
    };

    const result = await new RestConnector().sampleRows(
      build([
        {
          ...customers,
          rowsPointer: '/items',
          pagination: {
            style: 'cursor',
            cursorParam: 'after',
            cursorPointer: '/meta/next',
          },
        },
      ]),
      'api.default.customers',
      100,
    );

    expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(calls()).toHaveLength(3);
  });

  it('stops once the limit is reached and trims to it', async () => {
    respond = () => [{ id: 1 }, { id: 2 }, { id: 3 }];

    const result = await new RestConnector().sampleRows(
      build([{ ...customers, pagination: { style: 'page', pageSize: 3 } }]),
      'api.default.customers',
      2,
    );

    expect(result.rows).toHaveLength(2);
    expect(calls()).toHaveLength(1);
  });

  it('caps runaway pagination at 50 pages', async () => {
    respond = () => [{ id: 1 }];

    await new RestConnector().runReadOnlySql(
      build([
        {
          ...customers,
          maxRows: 1000,
          pagination: { style: 'page', pageSize: 1 },
        },
      ]),
      'SELECT COUNT(*) AS n FROM api.default.customers',
      10,
    );

    expect(calls()).toHaveLength(50);
  });
});

describe('RestConnector runReadOnlySql', () => {
  const config = build([customers, orders]);

  beforeEach(() => {
    respond = (url) =>
      url.pathname.endsWith('/customers')
        ? [
            { id: 1, name: 'Ada', vip: true },
            { id: 2, name: 'Bo', vip: false },
          ]
        : [
            { id: 10, customer_id: 1, total: 5.5, lines: [1] },
            { id: 11, customer_id: 1, total: 4.5, lines: [] },
            { id: 12, customer_id: 2, total: 1, lines: [] },
          ];
  });

  it('queries an endpoint by its api.schema.table name', async () => {
    const result = await new RestConnector().runReadOnlySql(
      config,
      'SELECT name, vip FROM api.default.customers ORDER BY id',
      100,
    );

    expect(result.columns).toEqual(['name', 'vip']);
    expect(result.rows).toEqual([
      { name: 'Ada', vip: 1 },
      { name: 'Bo', vip: 0 },
    ]);
  });

  it('joins across endpoints and only fetches the referenced ones', async () => {
    const result = await new RestConnector().runReadOnlySql(
      config,
      `SELECT c.name, SUM(o.total) AS spend
       FROM API.default.customers c
       JOIN "api.default.orders" o ON o.customer_id = c.id
       GROUP BY c.name ORDER BY c.name`,
      100,
    );

    expect(result.rows).toEqual([
      { name: 'Ada', spend: 10 },
      { name: 'Bo', spend: 1 },
    ]);
    expect(calls()).toHaveLength(2);
  });

  it('loads only the referenced endpoint', async () => {
    await new RestConnector().runReadOnlySql(
      config,
      'SELECT * FROM api.default.orders',
      100,
    );

    expect(calls().map((c) => c.url.pathname)).toEqual(['/v1/orders']);
  });

  it('loads every endpoint when nothing references one', async () => {
    const result = await new RestConnector().runReadOnlySql(
      config,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      100,
    );

    expect(calls()).toHaveLength(2);
    expect(result.rows).toEqual([
      { name: 'api.default.customers' },
      { name: 'api.default.orders' },
    ]);
  });

  it('stores nested arrays as JSON text', async () => {
    const result = await new RestConnector().runReadOnlySql(
      config,
      'SELECT lines FROM api.default.orders WHERE id = 10',
      100,
    );

    expect(result.rows).toEqual([{ lines: '[1]' }]);
  });

  it('leaves api.x.y inside string literals alone', async () => {
    const result = await new RestConnector().runReadOnlySql(
      config,
      "SELECT 'api.default.customers' AS s FROM api.default.orders LIMIT 1",
      100,
    );

    expect(result.rows).toEqual([{ s: 'api.default.customers' }]);
  });

  it('clamps rows to the limit and caps endpoint rows at maxRows', async () => {
    respond = () => Array.from({ length: 20 }, (_, i) => ({ id: i }));

    const clamped = await new RestConnector().runReadOnlySql(
      config,
      'SELECT id FROM api.default.customers',
      5,
    );
    expect(clamped.rows).toHaveLength(5);

    const capped = await new RestConnector().runReadOnlySql(
      build([{ ...customers, maxRows: 8 }]),
      'SELECT COUNT(*) AS n FROM api.default.customers',
      100,
    );
    expect(capped.rows).toEqual([{ n: 8 }]);
  });

  it('rejects write SQL before fetching anything', async () => {
    await expect(
      new RestConnector().runReadOnlySql(
        config,
        'DELETE FROM api.default.customers',
        10,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces SQLite errors untouched', async () => {
    await expect(
      new RestConnector().runReadOnlySql(
        config,
        'SELECT nope FROM api.default.customers',
        10,
      ),
    ).rejects.toThrow('no such column: nope');
  });
});

describe('RestConnector mask and summary', () => {
  it('masks token and password without mutating the input', () => {
    const config = build([customers], {
      auth: { type: 'basic', token: 'tok', password: 'pw', username: 'ada' },
    });

    const masked = new RestConnector().mask(config);

    expect(masked.auth).toEqual({
      type: 'basic',
      token: MASKED,
      password: MASKED,
      username: 'ada',
    });
    expect(config.auth.token).toBe('tok');
    expect(config.auth.password).toBe('pw');
  });

  it('leaves absent secrets absent', () => {
    const masked = new RestConnector().mask(build([customers]));

    expect(masked.auth).toEqual({ type: 'none' });
  });

  it('summarises without secrets', () => {
    const summary = new RestConnector().summary(
      build([customers, orders], { auth: { type: 'bearer', token: 'tok' } }),
    );

    expect(summary).toBe('REST API · https://api.example.com/v1 · 2 endpoints');
  });
});

describe('RestConnector discover', () => {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Shop' },
    servers: [{ url: '/v1' }],
    paths: {
      '/customers': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    },
  };
  const notFound = () => new Response('nope', { status: 404 });

  it('tries the usual spec locations under the base URL, then its origin', async () => {
    respond = (url) => (url.pathname === '/swagger.json' ? spec : notFound());

    const result = await new RestConnector().discover(build([]));

    expect(calls().map((c) => c.url.toString())).toEqual([
      'https://api.example.com/v1/openapi.json',
      'https://api.example.com/v1/swagger.json',
      'https://api.example.com/v1/v3/api-docs',
      'https://api.example.com/v1/api-docs',
      'https://api.example.com/v1/swagger/v1/swagger.json',
      'https://api.example.com/openapi.json',
      'https://api.example.com/swagger.json',
    ]);
    expect(result.specUrl).toBe('https://api.example.com/swagger.json');
    expect(result.title).toBe('Shop');
    expect(result.baseUrl).toBe('https://api.example.com/v1');
    expect(result.endpoints.map((e) => e.endpoint.path)).toEqual([
      '/customers',
    ]);
  });

  it('skips JSON that is not a spec during auto-detection', async () => {
    respond = (url) =>
      url.pathname === '/v1/openapi.json' ? { hello: 'world' } : spec;

    const result = await new RestConnector().discover(build([]));

    expect(result.specUrl).toBe('https://api.example.com/v1/swagger.json');
  });

  it('uses an explicit spec URL and sends the datasource auth', async () => {
    respond = () => spec;

    const result = await new RestConnector().discover(
      build([], {
        baseUrl: '',
        auth: { type: 'bearer', token: 'tok' },
      }),
      'https://docs.example.com/shop/openapi.json',
    );

    expect(calls()).toHaveLength(1);
    expect(headersOf(0)['Authorization']).toBe('Bearer tok');
    // No base URL given: paths stay relative to the spec's server URL.
    expect(result.baseUrl).toBe('https://docs.example.com/v1');
    expect(result.endpoints[0].endpoint.path).toBe('/customers');
  });

  it('resolves a relative spec URL against the base URL', async () => {
    respond = () => spec;

    const result = await new RestConnector().discover(build([]), 'docs.json');

    expect(result.specUrl).toBe('https://api.example.com/v1/docs.json');
  });

  it('explains what it tried when no spec is found', async () => {
    respond = notFound;

    await expect(new RestConnector().discover(build([]))).rejects.toThrow(
      /^No OpenAPI spec found \(tried https:\/\/api\.example\.com\/v1\/openapi\.json, .*\)\. Enter the spec URL\.$/,
    );
  });

  it('reports why an explicit spec URL failed', async () => {
    respond = () => new Response('openapi: 3.0.0', { status: 200 });

    await expect(
      new RestConnector().discover(
        build([]),
        'https://api.example.com/openapi.yaml',
      ),
    ).rejects.toThrow('YAML specs are not supported');
  });

  it('stops at the first unreachable host', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }),
    );

    await expect(new RestConnector().discover(build([]))).rejects.toThrow(
      'OpenAPI spec — https://api.example.com/v1/openapi.json: fetch failed — ECONNREFUSED',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('needs a base URL or a spec URL', async () => {
    await expect(
      new RestConnector().discover(build([], { baseUrl: '' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
