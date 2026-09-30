import { discoverFromOpenApi } from './openapi-discovery';

const SPEC_URL = 'http://127.0.0.1:55080/openapi.json';

/** Same shape as the World Cup test API's generated spec. */
function worldCupSpec(names: string[]) {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};
  for (const name of names) {
    schemas[name] = {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    };
    schemas[`${name}_page`] = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: `#/components/schemas/${name}` },
        },
        page: { type: 'integer' },
        per_page: { type: 'integer' },
        total: { type: 'integer' },
      },
    };
    paths[`/api/world_cup/${name}`] = {
      get: {
        operationId: `list_${name}`,
        summary: `List ${name}`,
        tags: ['world_cup'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
          },
          {
            name: 'per_page',
            in: 'query',
            schema: { type: 'integer', default: 100, maximum: 500 },
          },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${name}_page` },
              },
            },
          },
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'World Cup Test API', version: '1' },
    servers: [{ url: '/' }],
    paths,
    components: { schemas },
  };
}

function v3(
  paths: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return { openapi: '3.1.0', info: { title: 'T' }, paths, ...extra };
}

function listOp(schema: unknown, parameters: unknown[] = []) {
  return {
    get: {
      parameters,
      responses: {
        '200': { content: { 'application/json': { schema } } },
      },
    },
  };
}

const row = {
  type: 'object',
  properties: { id: { type: 'integer' }, label: { type: 'string' } },
};

describe('discoverFromOpenApi', () => {
  it('maps the World Cup spec to the endpoints the setup script registers', () => {
    const result = discoverFromOpenApi(
      worldCupSpec(['matches', 'goals']),
      SPEC_URL,
      'http://127.0.0.1:55080',
    );

    expect(result.title).toBe('World Cup Test API');
    expect(result.serverUrl).toBe('http://127.0.0.1:55080');
    expect(result.skipped).toEqual([]);
    expect(result.endpoints).toEqual([
      {
        endpoint: {
          name: 'matches',
          group: 'world_cup',
          path: '/api/world_cup/matches',
          rowsPointer: '/data',
          pagination: {
            style: 'page',
            pageParam: 'page',
            sizeParam: 'per_page',
            pageSize: 200,
          },
        },
        method: 'GET',
        summary: 'List matches',
        listResponse: true,
        fields: 2,
      },
      {
        endpoint: {
          name: 'goals',
          group: 'world_cup',
          path: '/api/world_cup/goals',
          rowsPointer: '/data',
          pagination: {
            style: 'page',
            pageParam: 'page',
            sizeParam: 'per_page',
            pageSize: 200,
          },
        },
        method: 'GET',
        summary: 'List goals',
        listResponse: true,
        fields: 2,
      },
    ]);
  });

  it('keeps the root pointer empty for bare array responses', () => {
    const result = discoverFromOpenApi(
      v3({ '/customers': listOp({ type: 'array', items: row }) }),
      SPEC_URL,
      '',
    );

    const [found] = result.endpoints;
    expect(found.endpoint).toEqual({ name: 'customers', path: '/customers' });
    expect(found.listResponse).toBe(true);
  });

  it('finds rows inside nested envelopes and prefers well-known names', () => {
    const schema = {
      type: 'object',
      properties: {
        meta: { type: 'object', properties: { tags: { type: 'array' } } },
        result: {
          type: 'object',
          properties: {
            warnings: { type: 'array', items: { type: 'string' } },
            items: { type: 'array', items: row },
          },
        },
      },
    };

    const result = discoverFromOpenApi(
      v3({ '/orders': listOp(schema) }),
      SPEC_URL,
      '',
    );

    expect(result.endpoints[0].endpoint.rowsPointer).toBe('/result/items');
  });

  it('merges allOf envelopes', () => {
    const schema = {
      allOf: [
        { $ref: '#/components/schemas/Envelope' },
        {
          type: 'object',
          properties: { results: { type: 'array', items: row } },
        },
      ],
    };

    const result = discoverFromOpenApi(
      v3(
        { '/things': listOp(schema) },
        {
          components: {
            schemas: {
              Envelope: {
                type: 'object',
                properties: { total: { type: 'integer' } },
              },
            },
          },
        },
      ),
      SPEC_URL,
      '',
    );

    expect(result.endpoints[0].endpoint.rowsPointer).toBe('/results');
    expect(result.endpoints[0].fields).toBe(2);
  });

  it('marks single-object and schema-less responses as not a list', () => {
    const result = discoverFromOpenApi(
      v3({
        '/status': listOp(row),
        '/export': { get: { responses: { '200': { description: 'ok' } } } },
      }),
      SPEC_URL,
      '',
    );

    expect(
      result.endpoints.map((e) => [e.endpoint.name, e.listResponse]),
    ).toEqual([
      ['status', false],
      ['export', false],
    ]);
    expect(result.endpoints[0].endpoint.rowsPointer).toBeUndefined();
  });

  it('skips non-GET paths, path parameters and required query parameters', () => {
    const result = discoverFromOpenApi(
      v3({
        '/customers/{id}': listOp(row),
        '/uploads': { post: { responses: {} } },
        '/search': listOp({ type: 'array', items: row }, [
          { name: 'q', in: 'query', required: true },
        ]),
        '/customers': listOp({ type: 'array', items: row }, [
          { name: 'limit', in: 'query', required: true },
        ]),
      }),
      SPEC_URL,
      '',
    );

    expect(result.endpoints.map((e) => e.endpoint.name)).toEqual(['customers']);
    expect(result.skipped).toEqual([
      { path: '/customers/{id}', reason: 'needs path parameters' },
      { path: '/uploads', reason: 'no GET operation' },
      { path: '/search', reason: 'needs query parameter q' },
    ]);
  });

  it('detects offset and cursor pagination', () => {
    const list = { type: 'array', items: row };
    const cursorEnvelope = {
      type: 'object',
      properties: {
        data: list,
        meta: {
          type: 'object',
          properties: { next_cursor: { type: 'string', nullable: true } },
        },
      },
    };

    const result = discoverFromOpenApi(
      v3(
        {
          '/a': listOp(list, [
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
          ]),
          '/b': listOp(cursorEnvelope, [
            { $ref: '#/components/parameters/Cursor' },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', maximum: 1000 },
            },
          ]),
        },
        {
          components: {
            parameters: {
              Cursor: {
                name: 'cursor',
                in: 'query',
                schema: { type: 'string' },
              },
            },
          },
        },
      ),
      SPEC_URL,
      '',
    );

    expect(result.endpoints.map((e) => e.endpoint.pagination)).toEqual([
      {
        style: 'offset',
        offsetParam: 'offset',
        sizeParam: 'limit',
        pageSize: 50,
      },
      {
        style: 'cursor',
        cursorParam: 'cursor',
        cursorPointer: '/meta/next_cursor',
        pageSize: 200,
      },
    ]);
  });

  it('resolves paths against the server URL relative to the base URL', () => {
    const spec = v3(
      { '/customers': listOp({ type: 'array', items: row }) },
      {
        servers: [
          {
            url: 'https://{env}.example.com/{version}',
            variables: { env: { default: 'api' }, version: { default: 'v2' } },
          },
        ],
      },
    );

    expect(
      discoverFromOpenApi(spec, SPEC_URL, 'https://api.example.com')
        .endpoints[0].endpoint.path,
    ).toBe('/v2/customers');
    expect(
      discoverFromOpenApi(spec, SPEC_URL, 'https://api.example.com/v2/')
        .endpoints[0].endpoint.path,
    ).toBe('/customers');
    expect(
      discoverFromOpenApi(spec, SPEC_URL, 'https://other.example.com')
        .endpoints[0].endpoint.path,
    ).toBe('https://api.example.com/v2/customers');
  });

  it('reads Swagger 2.0 documents', () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Legacy' },
      host: 'legacy.example.com',
      basePath: '/api',
      schemes: ['https'],
      paths: {
        '/users': {
          get: {
            tags: ['people'],
            parameters: [
              { name: 'page', in: 'query', type: 'integer' },
              { name: 'pageSize', in: 'query', type: 'integer', default: 25 },
            ],
            responses: {
              '200': {
                schema: {
                  type: 'object',
                  properties: {
                    users: {
                      type: 'array',
                      items: { $ref: '#/definitions/User' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      definitions: { User: row },
    };

    const result = discoverFromOpenApi(
      spec,
      'https://legacy.example.com/swagger.json',
      '',
    );

    expect(result.serverUrl).toBe('https://legacy.example.com/api');
    expect(result.endpoints[0].endpoint).toEqual({
      name: 'users',
      group: 'people',
      path: '/users',
      rowsPointer: '/users',
      pagination: {
        style: 'page',
        pageParam: 'page',
        sizeParam: 'pageSize',
        pageSize: 25,
      },
    });
  });

  it('keeps names unique within a group', () => {
    const list = listOp({ type: 'array', items: row });
    const result = discoverFromOpenApi(
      v3({ '/v1/items': list, '/v2/items': list, '/v2/Items': list }),
      SPEC_URL,
      '',
    );

    expect(result.endpoints.map((e) => e.endpoint.name)).toEqual([
      'items',
      'v2_items',
      'items_2',
    ]);
  });

  it('survives reference cycles', () => {
    const spec = v3(
      { '/nodes': listOp({ $ref: '#/components/schemas/A' }) },
      {
        components: {
          schemas: {
            A: { $ref: '#/components/schemas/B' },
            B: { $ref: '#/components/schemas/A' },
          },
        },
      },
    );

    expect(
      discoverFromOpenApi(spec, SPEC_URL, '').endpoints[0].listResponse,
    ).toBe(false);
  });

  it('rejects documents that are not OpenAPI', () => {
    expect(() => discoverFromOpenApi({ hello: 'world' }, SPEC_URL, '')).toThrow(
      'Not an OpenAPI 3.x or Swagger 2.0 document',
    );
    expect(() => discoverFromOpenApi([], SPEC_URL, '')).toThrow(
      'not a JSON object',
    );
  });
});
