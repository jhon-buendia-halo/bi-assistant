const clients: FakeClient[] = [];

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => {
    const client = new FakeClient();
    clients.push(client);
    return client;
  }),
}));

import { Logger } from '@nestjs/common';
import { PostgresConnector } from './postgres.connector';

/** Rows the fake database answers with, keyed by a fragment of the SQL. */
type Responder = (sql: string) => Record<string, unknown>[];

let respond: Responder = () => [];

class FakeClient {
  readonly queries: { sql: string; params?: unknown[] }[] = [];
  ended = false;

  connect() {
    return Promise.resolve();
  }

  query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    const rows = respond(sql);
    return Promise.resolve({
      rows,
      fields: Object.keys(rows[0] ?? {}).map((name) => ({ name })),
    });
  }

  end() {
    this.ended = true;
    return Promise.resolve();
  }
}

const config = {
  host: 'localhost',
  port: 55432,
  database: 'world_cup',
  user: 'world_cup',
  password: 'world_cup_dev',
  ssl: false,
};

function queries(): { sql: string; params?: unknown[] }[] {
  return clients.flatMap((c) => c.queries);
}

/** One `pg_constraint` row as the FK query shapes it. */
function fkRow(
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn = 'id',
  schema = 'world_cup',
): Record<string, unknown> {
  return {
    from_schema: schema,
    from_table: fromTable,
    from_column: fromColumn,
    to_schema: schema,
    to_table: toTable,
    to_column: toColumn,
  };
}

beforeEach(() => {
  clients.length = 0;
  respond = () => [];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

describe('PostgresConnector foreignKeys', () => {
  it('scopes the pg_constraint query to the schemas in the entities', async () => {
    respond = () => [fkRow('goals', 'scoring_team_id', 'teams')];

    const edges = await new PostgresConnector().foreignKeys(config, [
      'world_cup.world_cup.goals',
      'world_cup.world_cup.teams',
      'world_cup.staging.raw_goals',
    ]);

    expect(queries()).toHaveLength(1);
    const { sql, params } = queries()[0];
    expect(sql).toContain("con.contype = 'f'");
    expect(sql).toContain('unnest(con.conkey) WITH ORDINALITY');
    expect(sql).toContain('unnest(con.confkey) WITH ORDINALITY');
    expect(sql).toContain('ANY($1::text[])');
    // Deduplicated, in entity order, and never interpolated into the SQL.
    expect(params).toEqual([['world_cup', 'staging']]);
    expect(edges).toEqual([
      {
        from: { entity: 'world_cup.world_cup.goals', column: 'scoring_team_id' },
        to: { entity: 'world_cup.world_cup.teams', column: 'id' },
      },
    ]);
    expect(clients[0].ended).toBe(true);
  });

  it('keys edges as catalog.schema.table with the database as catalog', async () => {
    respond = () => [fkRow('teams', 'country_code', 'countries', 'code')];

    const edges = await new PostgresConnector().foreignKeys(config, [
      'world_cup.world_cup.teams',
      'world_cup.world_cup.countries',
    ]);

    expect(edges[0].from.entity).toBe('world_cup.world_cup.teams');
    expect(edges[0].to.entity).toBe('world_cup.world_cup.countries');
  });

  it('emits one edge per column pair of a composite key', async () => {
    respond = () => [
      fkRow('squad_members', 'tournament_id', 'tournament_teams'),
      fkRow('squad_members', 'team_id', 'tournament_teams'),
    ];

    const edges = await new PostgresConnector().foreignKeys(config, [
      'world_cup.world_cup.squad_members',
      'world_cup.world_cup.tournament_teams',
    ]);

    expect(edges.map((e) => e.from.column)).toEqual([
      'tournament_id',
      'team_id',
    ]);
  });

  it('drops edges whose other end is not in the sandbox', async () => {
    respond = () => [
      fkRow('goals', 'match_id', 'matches'),
      fkRow('goals', 'scorer_player_id', 'players'),
    ];

    const edges = await new PostgresConnector().foreignKeys(config, [
      'world_cup.world_cup.goals',
      'world_cup.world_cup.matches',
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0].from.column).toBe('match_id');
  });

  it('ignores entities from another database and malformed keys', async () => {
    respond = () => [fkRow('goals', 'match_id', 'matches')];

    const edges = await new PostgresConnector().foreignKeys(config, [
      'other_db.public.goals',
      'not-an-entity',
      '',
    ]);

    // Nothing in scope means no connection is opened at all.
    expect(clients).toHaveLength(0);
    expect(edges).toEqual([]);
  });

  it('returns no edges instead of throwing when the query fails', async () => {
    respond = () => {
      throw new Error('permission denied for table pg_constraint');
    };

    const edges = await new PostgresConnector().foreignKeys(config, [
      'world_cup.world_cup.goals',
    ]);

    expect(edges).toEqual([]);
    expect(clients[0].ended).toBe(true);
  });
});

describe('PostgresConnector error reporting', () => {
  it("appends Postgres' own HINT and DETAIL so the repair loop sees them", async () => {
    respond = (sql) => {
      if (!sql.startsWith('SELECT')) return [];
      const err = Object.assign(
        new Error('column "team_id" does not exist'),
        {
          code: '42703',
          detail: 'referenced in the query',
          hint: 'Perhaps you meant to reference the column "g.scoring_team_id".',
        },
      );
      throw err;
    };

    await expect(
      new PostgresConnector().runReadOnlySql(
        config,
        'SELECT team_id FROM world_cup.goals g',
        10,
      ),
    ).rejects.toThrow(
      'Postgres — column "team_id" does not exist — DETAIL: referenced in the query — HINT: Perhaps you meant to reference the column "g.scoring_team_id".',
    );
  });

  it('leaves errors without a hint untouched', async () => {
    respond = (sql) => {
      if (!sql.startsWith('SELECT')) return [];
      throw new Error('syntax error at or near "FROM"');
    };

    await expect(
      new PostgresConnector().runReadOnlySql(config, 'SELECT FROM', 10),
      // Exact message: nothing is appended when there is no hint or detail.
    ).rejects.toThrow(
      new Error('Postgres — syntax error at or near "FROM"'),
    );
  });
});
