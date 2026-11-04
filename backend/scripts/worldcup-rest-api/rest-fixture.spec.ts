import {
  buildIndex,
  buildOpenApi,
  checkEndpointNames,
  decodeCursor,
  encodeCursor,
  FIXTURE_SOURCES,
  handleApiRequest,
  loadRelations,
  PROFILES,
  readServerOptions,
  ServerOptionsError,
  servedRelations,
  type Row,
  type ServerOptions,
} from './rest-fixture';

/** 47 numbered rows: three pages of 20 (20, 20, 7). */
const GOALS: Row[] = Array.from({ length: 47 }, (_, i) => ({ id: i + 1 }));

function relations(): Map<string, Row[]> {
  return new Map<string, Row[]>([
    ['goals', GOALS],
    ['teams', [{ id: 1, common_name: 'Argentina' }]],
  ]);
}

function options(overrides: Partial<ServerOptions> = {}): ServerOptions {
  return {
    ...readServerOptions({}),
    ...overrides,
  };
}

/** The fields a page body may carry, under `result` when wrapped. */
interface PageBody {
  data?: Row[];
  items?: Row[];
  page?: number;
  per_page?: number;
  offset?: number;
  limit?: number;
  total?: number;
  next_cursor?: string | null;
  next?: string | null;
  error?: string;
  result?: PageBody;
}

function get(
  opts: ServerOptions,
  path: string,
  authorization?: string,
): { status: number; body: PageBody; headers?: Record<string, string> } {
  const answer = handleApiRequest(
    opts,
    relations(),
    new URL(`http://127.0.0.1:55090${path}`),
    authorization,
  );
  return { ...answer, body: answer.body as PageBody };
}

/** Follows a paging style to the end, the way a correct client would. */
function readAll(opts: ServerOptions, first: string): number[] {
  const ids: number[] = [];
  let path: string | undefined = first;
  for (let guard = 0; path && guard < 20; guard++) {
    const { status, body } = get(opts, path);
    expect(status).toBe(200);
    const meta: PageBody = body.result ?? body;
    const rows = meta.items ?? meta.data ?? [];
    ids.push(...rows.map((row) => row.id as number));
    if (opts.paging === 'page') {
      path = rows.length
        ? `/api/world_cup/goals?page=${(meta.page ?? 0) + 1}`
        : undefined;
    } else if (opts.paging === 'offset') {
      path = rows.length
        ? `/api/world_cup/goals?offset=${(meta.offset ?? 0) + rows.length}`
        : undefined;
    } else if (opts.paging === 'cursor') {
      path = meta.next_cursor
        ? `/api/world_cup/goals?cursor=${meta.next_cursor}`
        : undefined;
    } else {
      const next = meta.next ? new URL(meta.next) : undefined;
      path = next ? next.pathname + next.search : undefined;
    }
  }
  return ids;
}

describe('the fixture REST API switches (BA-187)', () => {
  describe('readServerOptions', () => {
    it('defaults to the plain World Cup API on 55080, paged as before', () => {
      const opts = readServerOptions({});
      expect(opts).toMatchObject({
        port: 55080,
        paging: 'page',
        nested: false,
        wrapped: [],
        refused: [],
      });
      expect(opts.fixture.id).toBe('world-cup');
      expect(opts.pageSize).toBeUndefined();
      expect(opts.token).toBeUndefined();
    });

    it('keeps WORLD_CUP_API_PORT, and gives each fixture its own default port', () => {
      expect(readServerOptions({ WORLD_CUP_API_PORT: '8080' }).port).toBe(8080);
      expect(readServerOptions({ REST_API_FIXTURE: 'finance' }).port).toBe(
        55081,
      );
      expect(
        readServerOptions({}, ['--fixture', 'marketing-analytics']).port,
      ).toBe(55082);
    });

    it('reads every switch from the environment, a flag winning over its variable', () => {
      const opts = readServerOptions(
        {
          REST_API_PAGING: 'offset',
          REST_API_PAGE_SIZE: '25',
          REST_API_NESTED: '1',
          REST_API_WRAPPED: 'teams, goals',
          REST_API_REFUSE: 'goals',
          REST_API_TOKEN: 'secret',
          REST_API_PORT: '55091',
        },
        ['--paging=cursor', '--port', '55092'],
      );
      expect(opts).toMatchObject({
        paging: 'cursor',
        pageSize: 25,
        nested: true,
        wrapped: ['teams', 'goals'],
        refused: ['goals'],
        token: 'secret',
        port: 55092,
      });
    });

    it('takes the connector profile, and lets a variable override one of its switches', () => {
      const opts = readServerOptions({
        REST_API_PROFILE: 'connector',
        REST_API_PAGING: 'cursor',
        REST_API_REFUSE: '',
      });
      expect(opts).toMatchObject({
        profile: 'connector',
        paging: 'cursor',
        pageSize: 20,
        nested: true,
        wrapped: ['tournament_teams'],
        refused: ['squad_members'],
        token: PROFILES.connector.server.token,
      });
      expect(
        readServerOptions({
          REST_API_PROFILE: 'connector',
          REST_API_TOKEN: 't',
        }).token,
      ).toBe('t');
    });

    it.each([
      [{ REST_API_FIXTURE: 'formula-1' }, /Unknown fixture "formula-1"/],
      [
        { REST_API_PAGING: 'link' },
        /REST_API_PAGING must be one of page, offset, cursor, next-url/,
      ],
      [
        { REST_API_PAGE_SIZE: '0' },
        /REST_API_PAGE_SIZE must be a positive integer/,
      ],
      [{ REST_API_PAGE_SIZE: '501' }, /at most 500/],
      [{ REST_API_NESTED: 'maybe' }, /REST_API_NESTED must be 1 or 0/],
      [{ REST_API_PROFILE: 'chaos' }, /Unknown profile "chaos"/],
      [
        { REST_API_PROFILE: 'connector', REST_API_FIXTURE: 'finance' },
        /Profile "connector" is for world-cup, not finance/,
      ],
    ])('refuses %j', (env, message) => {
      expect(() => readServerOptions(env)).toThrow(message);
    });

    it('refuses an unknown flag', () => {
      expect(() => readServerOptions({}, ['--pages', '3'])).toThrow(
        ServerOptionsError,
      );
    });
  });

  describe('handleApiRequest', () => {
    it('answers as it always did with no switch: page and per_page, rows under data', () => {
      const { status, body } = get(
        options(),
        '/api/world_cup/goals?page=2&per_page=10',
      );
      expect(status).toBe(200);
      expect(body).toEqual({
        data: GOALS.slice(10, 20),
        page: 2,
        per_page: 10,
        total: 47,
      });
      // Junk falls back to the defaults; a page is at most 500 rows.
      expect(
        get(options(), '/api/world_cup/goals?page=x&per_page=9999').body,
      ).toMatchObject({
        page: 1,
        per_page: 500,
      });
    });

    it('caps a page at the page-size switch, whatever the client asks for', () => {
      const { body } = get(
        options({ pageSize: 20 }),
        '/api/world_cup/goals?page=1&per_page=200',
      );
      expect(body.per_page).toBe(20);
      expect(body.data).toHaveLength(20);
    });

    it.each(['page', 'offset', 'cursor', 'next-url'] as const)(
      'serves every row exactly once under %s paging, in pages of 20',
      (paging) => {
        const opts = options({ paging, pageSize: 20 });
        expect(readAll(opts, '/api/world_cup/goals')).toEqual(
          GOALS.map((row) => row.id),
        );
      },
    );

    it('gives offset paging its offset, limit and total', () => {
      const { body } = get(
        options({ paging: 'offset', pageSize: 20 }),
        '/api/world_cup/goals?offset=40&limit=50',
      );
      expect(body).toEqual({
        data: GOALS.slice(40),
        offset: 40,
        limit: 20,
        total: 47,
      });
    });

    it('ends cursor paging with a null cursor, and refuses a cursor it did not issue', () => {
      const opts = options({ paging: 'cursor', pageSize: 20 });
      const last = get(opts, `/api/world_cup/goals?cursor=${encodeCursor(40)}`);
      expect(last.body).toEqual({ data: GOALS.slice(40), next_cursor: null });
      const bad = get(opts, '/api/world_cup/goals?cursor=page-2');
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/Invalid cursor/);
    });

    it('gives next-url paging an absolute next URL, and refuses that URL passed back as a parameter', () => {
      const opts = options({ paging: 'next-url', pageSize: 20 });
      const first = get(opts, '/api/world_cup/goals');
      expect(first.body.next).toBe(
        `http://127.0.0.1:55090/api/world_cup/goals?page_token=${encodeCursor(20)}&limit=20`,
      );
      // What the connector's cursor style does with it (a BA-11 candidate).
      const echoed = get(
        opts,
        `/api/world_cup/goals?page_token=${encodeURIComponent(String(first.body.next))}`,
      );
      expect(echoed.status).toBe(400);
    });

    it("puts a wrapped endpoint's rows and page fields under result", () => {
      const { body } = get(
        options({ wrapped: ['goals'], pageSize: 20 }),
        '/api/world_cup/goals',
      );
      expect(Object.keys(body)).toEqual(['result']);
      expect(body.result).toMatchObject({ page: 1, per_page: 20, total: 47 });
      expect(body.result?.items).toHaveLength(20);
      // Other endpoints are not wrapped.
      expect(
        get(options({ wrapped: ['goals'] }), '/api/world_cup/teams').body.data,
      ).toHaveLength(1);
    });

    it('refuses a refused endpoint with 503, and only that one', () => {
      const opts = options({ refused: ['goals'] });
      const refused = get(opts, '/api/world_cup/goals');
      expect(refused.status).toBe(503);
      expect(refused.headers).toBeUndefined();
      expect(refused.body.error).toMatch(
        /goals endpoint is temporarily unavailable/,
      );
      expect(get(opts, '/api/world_cup/teams').status).toBe(200);
    });

    it('sends Retry-After with the refusal only when the switch asks for it', () => {
      const opts = readServerOptions({
        REST_API_REFUSE: 'goals',
        REST_API_RETRY_AFTER: '120',
      });
      expect(opts.retryAfter).toBe(120);
      expect(get(opts, '/api/world_cup/goals').headers).toEqual({
        'Retry-After': '120',
      });
    });

    it('asks for the bearer token before anything else, refused endpoints included', () => {
      const opts = options({ token: 'secret', refused: ['goals'] });
      for (const auth of [undefined, 'Bearer wrong', 'secret']) {
        const answer = get(opts, '/api/world_cup/goals', auth);
        expect(answer.status).toBe(401);
        expect(answer.headers?.['WWW-Authenticate']).toMatch(/^Bearer /);
      }
      expect(get(opts, '/api/world_cup/teams', 'Bearer secret').status).toBe(
        200,
      );
      expect(get(opts, '/api/world_cup/goals', 'Bearer secret').status).toBe(
        503,
      );
    });

    it('answers 404 for a relation it does not serve', () => {
      expect(get(options(), '/api/world_cup/referees').status).toBe(404);
    });
  });

  describe('the cursor token', () => {
    it('round-trips an offset and refuses anything else', () => {
      expect(decodeCursor(encodeCursor(40))).toBe(40);
      expect(decodeCursor('not-a-cursor')).toBeUndefined();
      expect(decodeCursor('http://x/?page_token=abc')).toBeUndefined();
    });
  });

  describe('the dumps and the nested endpoints', () => {
    it.each(
      Object.values(FIXTURE_SOURCES).map((source) => [source.id, source]),
    )(
      '%s: reads its dump and builds its nested endpoint with objects for the related rows',
      (_id, source) => {
        const dump = loadRelations(source.dataDir);
        expect(dump.size).toBeGreaterThan(10);
        const served = servedRelations(
          options({ fixture: source, nested: true }),
          dump,
        );
        const nested = served.get(source.nested.name) ?? [];
        expect(nested.length).toBeGreaterThan(0);
        const objects = Object.values(nested[0]).filter(
          (value) => value !== null && typeof value === 'object',
        );
        expect(objects.length).toBeGreaterThanOrEqual(2);
        // Without the switch the endpoint is not served.
        expect(
          servedRelations(options({ fixture: source }), dump).has(
            source.nested.name,
          ),
        ).toBe(false);
      },
    );

    it('nests a World Cup match two levels deep, from the same rows as matches', () => {
      const dump = loadRelations(FIXTURE_SOURCES['world-cup'].dataDir);
      const nested = servedRelations(options({ nested: true }), dump).get(
        'matches_nested',
      ) as Row[];
      expect(nested).toHaveLength(dump.get('matches')!.length);
      const final2022 = nested.find(
        (match) => match.tournament_year === 2022 && match.stage === 'final',
      );
      expect(final2022).toMatchObject({
        venue: { name: 'Lusail Stadium', city: 'Lusail' },
        home: {
          team: { name: 'Argentina', fifa_code: 'ARG' },
          goals: 3,
          penalties: 4,
        },
        away: {
          team: { name: 'France', fifa_code: 'FRA' },
          goals: 3,
          penalties: 2,
        },
        winner: { name: 'Argentina' },
      });
    });

    it('refuses a wrapped or refused endpoint the fixture does not serve', () => {
      expect(() =>
        checkEndpointNames(options({ refused: ['referees'] }), relations()),
      ).toThrow(/REST_API_REFUSE names referees/);
      expect(() =>
        checkEndpointNames(options({ wrapped: ['goals'] }), relations()),
      ).not.toThrow();
    });
  });

  describe('the OpenAPI document and the index', () => {
    it('describes each paging style the way discovery reads it', () => {
      const params = (paging: ServerOptions['paging']) => {
        const doc = buildOpenApi(
          options({ paging, pageSize: 20 }),
          relations(),
        );
        const paths = doc.paths as Record<
          string,
          { get: { parameters: Row[] } }
        >;
        return paths['/api/world_cup/goals'].get.parameters.map((p) => p.name);
      };
      expect(params('page')).toEqual(['page', 'per_page']);
      expect(params('offset')).toEqual(['offset', 'limit']);
      expect(params('cursor')).toEqual(['cursor', 'limit']);
      expect(params('next-url')).toEqual(['page_token', 'limit']);
    });

    it("declares a wrapped endpoint's rows under result.items, nested rows as objects, and the bearer scheme", () => {
      const doc = buildOpenApi(
        options({ wrapped: ['goals'], token: 'secret', paging: 'cursor' }),
        new Map<string, Row[]>([
          ['goals', GOALS],
          ['nested', [{ id: 1, home: { team: { name: 'A' }, goals: 1 } }]],
        ]),
      );
      interface Schema {
        properties: Record<string, Schema>;
      }
      const { schemas } = doc.components as { schemas: Record<string, Schema> };
      const page = schemas.goals_page;
      expect(Object.keys(page.properties)).toEqual(['result']);
      expect(Object.keys(page.properties.result.properties)).toEqual([
        'items',
        'next_cursor',
      ]);
      expect(schemas.nested.properties.home).toMatchObject({
        type: 'object',
        properties: { team: { type: 'object' }, goals: { type: 'integer' } },
      });
      expect(doc).toMatchObject({
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
        },
        security: [{ bearerAuth: [] }],
      });
    });

    it('lists the endpoints, row counts and switches at /, never the token', () => {
      const index = buildIndex(
        options({ token: 'secret', refused: ['goals'], pageSize: 20 }),
        relations(),
      );
      expect(index).toMatchObject({
        fixture: 'world-cup',
        schema: 'world_cup',
        endpoints: ['/api/world_cup/goals', '/api/world_cup/teams'],
        rows: { goals: 47, teams: 1 },
        switches: {
          paging: 'page',
          defaultPageSize: 20,
          maxPageSize: 20,
          refused: ['goals'],
          tokenRequired: true,
        },
      });
      expect(JSON.stringify(index)).not.toContain('secret');
    });
  });
});
