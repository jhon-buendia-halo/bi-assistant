import type { RestEndpointDef } from '../src/modules/datasources/entities/datasource.entity';
import {
  CONNECTOR_DEFAULT_MAX_ROWS,
  parseMaxRows,
  parseSetupArgs,
  planEndpoints,
  restFixtureFor,
  SetupError,
  snapshotEntities,
  variantNames,
} from './setup-fixture-rest';

describe('setup-fixture-rest (BA-187)', () => {
  describe('parseSetupArgs', () => {
    it('keeps the old defaults: World Cup API on 55080, backend on 3000', () => {
      expect(parseSetupArgs([], {})).toEqual({
        backendUrl: 'http://127.0.0.1:3000',
        apiUrl: 'http://127.0.0.1:55080',
        maxRows: {},
        allowUnavailable: false,
      });
      expect(
        parseSetupArgs([], { WORLD_CUP_API_URL: 'http://127.0.0.1:9000/' })
          .apiUrl,
      ).toBe('http://127.0.0.1:9000');
    });

    it("defaults the API URL to the fixture's port", () => {
      expect(parseSetupArgs(['--fixture', 'finance'], {})).toMatchObject({
        fixture: 'finance',
        apiUrl: 'http://127.0.0.1:55081',
      });
      expect(
        parseSetupArgs(['--fixture=marketing-analytics-rest'], {}).apiUrl,
      ).toBe('http://127.0.0.1:55082');
    });

    it('reads every flag and its variable, the flag winning', () => {
      expect(
        parseSetupArgs(
          [
            '--api-url',
            'http://127.0.0.1:55092',
            '--variant',
            'cursor',
            '--max-rows',
            'goals=10',
            '--max-rows=teams=3,players=7',
            '--allow-unavailable',
          ],
          {
            REST_API_URL: 'http://ignored',
            REST_API_TOKEN: 'api-tok',
            BACKEND_URL: 'http://127.0.0.1:55099/',
          },
        ),
      ).toEqual({
        backendUrl: 'http://127.0.0.1:55099',
        apiUrl: 'http://127.0.0.1:55092',
        apiToken: 'api-tok',
        variant: 'cursor',
        maxRows: { goals: 10, teams: 3, players: 7 },
        allowUnavailable: true,
      });
    });

    it.each([
      [
        ['--max-rows', 'goals'],
        /--max-rows takes <endpoint>=<positive number>/,
      ],
      [['--max-rows', 'goals=0'], /--max-rows takes/],
      [['--fixture', 'formula-1'], /Unknown fixture "formula-1"/],
      [['--variant'], /--variant needs a value/],
      [['--variant', 'a,b'], /--variant must not contain a comma/],
      [['--port', '1'], /Unexpected argument "--port"/],
    ])('refuses %j', (argv, message) => {
      expect(() => parseSetupArgs(argv, {})).toThrow(message);
    });

    it('parses caps on their own', () => {
      expect(parseMaxRows(['a=1, b=2', 'c=3'])).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('names', () => {
    it('keeps the registry names without a variant, and appends the variant otherwise', () => {
      const worldCup = restFixtureFor('world-cup');
      expect(variantNames(worldCup)).toEqual({
        datasourceName: 'World Cup REST API',
        datasetName: 'World Cup (REST)',
      });
      expect(variantNames(worldCup, 'cursor')).toEqual({
        datasourceName: 'World Cup REST API (cursor)',
        datasetName: 'World Cup (REST cursor)',
      });
      expect(variantNames(restFixtureFor('finance'))).toEqual({
        datasourceName: 'Finance REST API',
        datasetName: 'Finance (REST)',
      });
      expect(restFixtureFor('marketing-analytics').id).toBe(
        'marketing-analytics-rest',
      );
      expect(() => restFixtureFor('genomics')).toThrow(SetupError);
    });
  });

  describe('planEndpoints', () => {
    const page = (name: string, pageSize = 200): RestEndpointDef => ({
      name,
      group: 'g',
      path: `/api/g/${name}`,
      rowsPointer: '/data',
      pagination: {
        style: 'page',
        pageParam: 'page',
        sizeParam: 'per_page',
        pageSize,
      },
    });

    it('leaves an endpoint the connector reads whole as discovery proposed it', () => {
      const { endpoints, notes } = planEndpoints(
        [page('teams')],
        { rows: { teams: 12 }, switches: { maxPageSize: 500 } },
        {},
      );
      expect(endpoints).toEqual([page('teams')]);
      expect(notes).toEqual([]);
    });

    it('lifts the default cap and the page size for an endpoint over 10 000 rows (policy_sales)', () => {
      const { endpoints, notes } = planEndpoints(
        [page('policy_sales')],
        { rows: { policy_sales: 10_822 }, switches: { maxPageSize: 500 } },
        {},
      );
      expect(endpoints[0].maxRows).toBe(10_822);
      expect(endpoints[0].pagination?.pageSize).toBe(217);
      expect(notes.join('\n')).toMatch(
        /more than the connector's default cap of 10000/,
      );
      expect(notes.join('\n')).not.toMatch(/WARNING/);
    });

    it('raises the page size for 5 400 rows at the connector default page of 100', () => {
      const { endpoints } = planEndpoints(
        [{ ...page('transactions'), pagination: { style: 'offset' } }],
        { rows: { transactions: 5_400 }, switches: { maxPageSize: 500 } },
        {},
      );
      expect(endpoints[0].pagination?.pageSize).toBe(108);
      expect(endpoints[0].maxRows).toBeUndefined();
    });

    it("warns when 50 pages of the server's largest page cannot hold the rows", () => {
      const { endpoints, notes } = planEndpoints(
        [page('transactions', 20)],
        { rows: { transactions: 5_400 }, switches: { maxPageSize: 20 } },
        {},
      );
      expect(endpoints[0].pagination?.pageSize).toBe(20);
      expect(notes).toEqual([
        'transactions: WARNING 5400 rows need more than 50 pages of 20; the connector stops at 1000 rows without saying so',
      ]);
    });

    it("warns for a cursor endpoint by the server's own page size (the connector sends none)", () => {
      const { notes } = planEndpoints(
        [
          {
            ...page('transactions'),
            pagination: { style: 'cursor', cursorPointer: '/next_cursor' },
          },
        ],
        { rows: { transactions: 5_400 }, switches: { defaultPageSize: 20 } },
        {},
      );
      expect(notes[0]).toMatch(
        /50 cursor pages of 20; the connector stops at 1000 rows/,
      );
    });

    it('applies a cap, which wins over the row count', () => {
      const { endpoints, notes } = planEndpoints(
        [page('match_team_statistics', 20)],
        { rows: { match_team_statistics: 32 }, switches: { maxPageSize: 20 } },
        { match_team_statistics: 20 },
      );
      expect(endpoints[0].maxRows).toBe(20);
      expect(notes).toEqual([
        'match_team_statistics: capped at 20 rows on the datasource (the API serves 32)',
      ]);
      expect(CONNECTOR_DEFAULT_MAX_ROWS).toBe(10_000);
    });
  });

  describe('snapshotEntities', () => {
    const catalogs = [
      {
        name: 'api',
        schemas: [
          {
            name: 'world_cup',
            tables: [
              {
                name: 'teams',
                columns: [{ name: 'id', type: 'number', nullable: false }],
              },
              { name: 'squad_members', columns: [], selectable: false },
              { name: 'players', columns: [], selectable: false },
            ],
          },
        ],
      },
    ];
    const keys = ['teams', 'squad_members', 'players'].map((name) => ({
      key: `api.world_cup.${name}`,
      name,
    }));

    it('keeps a refused endpoint with no columns, and fails on any other unreadable one', () => {
      const result = snapshotEntities(
        catalogs,
        keys,
        new Set(['squad_members']),
        false,
      );
      expect(result.entities.map((e) => e.key)).toEqual(keys.map((k) => k.key));
      expect(result.problems).toEqual([
        'api.world_cup.players: not selectable (endpoint fetch failed)',
      ]);
    });

    it('keeps every unreadable endpoint with --allow-unavailable', () => {
      expect(
        snapshotEntities(catalogs, keys, new Set(['squad_members']), true)
          .problems,
      ).toEqual([]);
    });

    it('fails when a refused endpoint was read: the switch is off', () => {
      expect(
        snapshotEntities(
          catalogs,
          keys,
          new Set(['teams', 'squad_members']),
          true,
        ).problems,
      ).toEqual([
        'api.world_cup.teams: the API refuses it, yet the inventory read it (is the switch on?)',
      ]);
    });
  });
});
