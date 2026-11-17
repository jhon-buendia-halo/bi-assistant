const clients: FakeClient[] = [];

jest.mock('pg', () => ({
  // The real `Query`: the fake feeds it wire messages, so row parsing and
  // whether rows are accumulated are pg's own.
  Query: jest.requireActual<typeof import('pg')>('pg').Query,
  Client: jest.fn().mockImplementation(() => {
    const client = new FakeClient();
    clients.push(client);
    return client;
  }),
}));

import { Logger } from '@nestjs/common';
import type { Query } from 'pg';
import { PostgresConnector } from './postgres.connector';

/** Rows the fake database answers with, keyed by a fragment of the SQL. */
type Responder = (sql: string) => Record<string, unknown>[] | typeof HANG;

/** A statement that runs until it is cancelled (`pg_sleep(20)`). */
const HANG = Symbol('hang');

let respond: Responder = () => [];

/** pg's `Query` with the protocol handlers the connection calls. */
type WireQuery = Query & {
  text: string;
  _result: { rows: unknown[] };
  handleRowDescription(msg: unknown): void;
  handleDataRow(msg: unknown): void;
  handleCommandComplete(msg: unknown, con: unknown): void;
  handleReadyForQuery(con: unknown): void;
  handleError(err: Error, con: unknown): void;
};

/** A text-format field per column: int4, float8, bool or text by value. */
function fieldsOf(rows: Record<string, unknown>[]) {
  return Object.entries(rows[0] ?? {}).map(([name, value]) => ({
    name,
    format: 'text',
    dataTypeID:
      typeof value === 'number'
        ? Number.isInteger(value)
          ? 23
          : 701
        : typeof value === 'boolean'
          ? 16
          : 25,
  }));
}

/** A value as Postgres sends it in text format. */
function wire(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 't' : 'f';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

let nextPid = 1000;

class FakeClient {
  readonly queries: { sql: string; params?: unknown[] }[] = [];
  /** The `Submittable` statements, as pg left them. */
  readonly submitted: WireQuery[] = [];
  readonly processID = nextPid++;
  ended = false;
  /** The submitted statement that is still running. */
  running?: WireQuery;
  /** The live `processID`s, as `pg_cancel_backend` finds them. */
  static readonly live = new Map<number, FakeClient>();

  connect() {
    FakeClient.live.set(this.processID, this);
    return Promise.resolve();
  }

  query(sql: string | WireQuery, params?: unknown[]) {
    if (typeof sql !== 'string') return this.submit(sql);
    this.queries.push({ sql, params });
    if (sql.includes('pg_cancel_backend')) {
      FakeClient.live.get(Number(params?.[0]))?.cancelRunning();
    }
    const rows = respond(sql);
    if (rows === HANG) return new Promise(() => undefined);
    return Promise.resolve({
      rows,
      fields: Object.keys(rows[0] ?? {}).map((name) => ({ name })),
    });
  }

  /** A `Submittable` statement, answered message by message as the wire does. */
  private submit(query: WireQuery) {
    this.queries.push({ sql: query.text });
    this.submitted.push(query);
    let rows: Record<string, unknown>[] | typeof HANG;
    try {
      rows = respond(query.text);
    } catch (err) {
      setImmediate(() => query.handleError(err as Error, undefined));
      return query;
    }
    if (rows === HANG) {
      this.running = query;
      return query;
    }
    const answer = rows;
    setImmediate(() => {
      const fields = fieldsOf(answer);
      query.handleRowDescription({ fields });
      for (const row of answer) {
        query.handleDataRow({ fields: fields.map((f) => wire(row[f.name])) });
      }
      query.handleCommandComplete({ text: `SELECT ${answer.length}` }, {});
      query.handleReadyForQuery({});
    });
    return query;
  }

  /** What the server does on a cancel request: fail the running statement. */
  cancelRunning() {
    const query = this.running;
    this.running = undefined;
    query?.handleError(
      Object.assign(new Error('canceling statement due to user request'), {
        code: '57014',
      }),
      {},
    );
  }

  end() {
    this.ended = true;
    FakeClient.live.delete(this.processID);
    this.running?.handleError(new Error('Connection terminated'), {});
    this.running = undefined;
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
        from: {
          entity: 'world_cup.world_cup.goals',
          column: 'scoring_team_id',
        },
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

  it('drops edges whose other end is not in the dataset', async () => {
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
      const err = Object.assign(new Error('column "team_id" does not exist'), {
        code: '42703',
        detail: 'referenced in the query',
        hint: 'Perhaps you meant to reference the column "g.scoring_team_id".',
      });
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
    ).rejects.toThrow(new Error('Postgres — syntax error at or near "FROM"'));
  });
});

describe('PostgresConnector runPagedSql (datasources R52)', () => {
  const stmt = {
    sql: 'SELECT country, goals FROM world_cup.scorers;',
    columns: ['country', 'goals'],
    filters: [{ column: 'country', op: 'eq' as const, value: 'Brazil' }],
    sort: [{ column: 'goals', direction: 'desc' as const }],
    limit: 2,
    offset: 0,
    kinds: { country: 'text' as const, goals: 'number' as const },
  };

  it('runs the wrapper with $n parameters inside a READ ONLY transaction', async () => {
    respond = (sql) =>
      sql.includes('_qti')
        ? [
            { country: 'Brazil', goals: 8, __qti_total: '3' },
            { country: 'Brazil', goals: 5, __qti_total: '3' },
          ]
        : [];

    const page = await new PostgresConnector().runPagedSql(config, stmt);

    expect(page).toEqual({
      columns: ['country', 'goals'],
      rows: [
        { country: 'Brazil', goals: 8 },
        { country: 'Brazil', goals: 5 },
      ],
      matchedRows: 3,
    });
    const sent = queries();
    expect(sent.map((q) => q.sql.split('\n')[0])).toEqual([
      'BEGIN READ ONLY',
      'SELECT _qti.*, COUNT(*) OVER () AS "__qti_total"',
      'ROLLBACK',
    ]);
    expect(sent[1].sql).toContain(
      'WHERE LOWER(CAST("country" AS TEXT)) = LOWER(CAST($1 AS TEXT))',
    );
    expect(sent[1].params).toEqual(['Brazil']);
    expect(clients[0].ended).toBe(true);
  });

  it('counts once more for an empty page past the end', async () => {
    respond = (sql) =>
      sql.startsWith('SELECT COUNT(*)') ? [{ __qti_total: '3' }] : [];

    const page = await new PostgresConnector().runPagedSql(config, {
      ...stmt,
      offset: 10,
    });

    expect(page.rows).toEqual([]);
    expect(page.matchedRows).toBe(3);
    expect(queries()[2]).toMatchObject({ params: ['Brazil'] });
  });

  it('refuses a bad filter before connecting', async () => {
    await expect(
      new PostgresConnector().runPagedSql(config, {
        ...stmt,
        filters: [{ column: 'team', op: 'is_null' }],
      }),
    ).rejects.toThrow('Unknown column "team"');
    expect(clients).toHaveLength(0);
  });
});

describe('PostgresConnector runReadOnlySql rows past the cap', () => {
  afterEach(() => jest.restoreAllMocks());

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `row ${i + 1}`,
      ratio: i + 0.5,
      even: i % 2 === 1,
    }));

  it('keeps the first rows in order, counts the rest and never holds them', async () => {
    respond = (sql) => (sql.startsWith('SELECT') ? many(5_000) : []);

    const result = await new PostgresConnector().runReadOnlySql(
      config,
      'SELECT id, name, ratio, even FROM big',
      3,
    );

    expect(result).toEqual({
      columns: ['id', 'name', 'ratio', 'even'],
      rows: [
        { id: 1, name: 'row 1', ratio: 0.5, even: false },
        { id: 2, name: 'row 2', ratio: 1.5, even: true },
        { id: 3, name: 'row 3', ratio: 2.5, even: false },
      ],
      totalRows: 5_000,
    });
    // pg accumulates a statement's rows unless they are consumed one by one.
    const { submitted } = clients[0];
    expect(submitted).toHaveLength(1);
    expect(submitted[0]._result.rows).toHaveLength(0);
    expect(queries().map((q) => q.sql)).toEqual([
      'BEGIN READ ONLY',
      'SELECT id, name, ratio, even FROM big',
      'ROLLBACK',
    ]);
    expect(clients[0].ended).toBe(true);
  });

  it('keeps the column names of an empty result', async () => {
    jest
      .spyOn(FakeClient.prototype as never, 'submit')
      .mockImplementation(function (this: FakeClient, query: WireQuery) {
        this.queries.push({ sql: query.text });
        setImmediate(() => {
          query.handleRowDescription({
            fields: [{ name: 'id', dataTypeID: 23, format: 'text' }],
          });
          query.handleCommandComplete({ text: 'SELECT 0' }, {});
          query.handleReadyForQuery({});
        });
        return query;
      } as never);

    const result = await new PostgresConnector().runReadOnlySql(
      config,
      'SELECT id FROM big WHERE false',
      10,
    );

    expect(result).toEqual({ columns: ['id'], rows: [], totalRows: 0 });
  });
});

describe('PostgresConnector runReadOnlySql cancellation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cancels the running backend query and rejects with the reason', async () => {
    respond = (sql) => (sql.includes('pg_sleep') ? HANG : []);
    const controller = new AbortController();
    const reason = new Error('Stopped by the user');

    const run = new PostgresConnector().runReadOnlySql(
      config,
      'SELECT pg_sleep(20)',
      10,
      undefined,
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(reason);

    await expect(run).rejects.toBe(reason);
    const [worker, canceller] = clients;
    expect(canceller.queries).toEqual([
      { sql: 'SELECT pg_cancel_backend($1)', params: [worker.processID] },
    ]);
    expect(canceller.ended).toBe(true);
    // Released as on a normal end: rolled back, then closed.
    expect(worker.queries.map((q) => q.sql)).toEqual([
      'BEGIN READ ONLY',
      'SELECT pg_sleep(20)',
      'ROLLBACK',
    ]);
    expect(worker.ended).toBe(true);
  });

  it('closes the connection when the cancel request cannot be sent', async () => {
    respond = (sql) => (sql.includes('pg_sleep') ? HANG : []);
    const connect = jest.spyOn(FakeClient.prototype, 'connect');
    connect.mockImplementation(function (this: FakeClient) {
      if (clients.indexOf(this) > 0) {
        return Promise.reject(new Error('too many connections'));
      }
      FakeClient.live.set(this.processID, this);
      return Promise.resolve();
    });
    const controller = new AbortController();

    const run = new PostgresConnector().runReadOnlySql(
      config,
      'SELECT pg_sleep(20)',
      10,
      undefined,
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(clients[0].ended).toBe(true);
  });

  it('rejects before connecting when the signal is already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('Stopped by the user');
    controller.abort(reason);

    await expect(
      new PostgresConnector().runReadOnlySql(config, 'SELECT 1', 10, 500, {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(clients).toHaveLength(0);
  });

  it('answers as before when the signal never aborts', async () => {
    respond = (sql) => (sql.startsWith('SELECT') ? [{ n: 1 }] : []);

    const result = await new PostgresConnector().runReadOnlySql(
      config,
      'SELECT 1 AS n',
      10,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ columns: ['n'], rows: [{ n: 1 }], totalRows: 1 });
    expect(clients).toHaveLength(1);
  });
});
