import { Client } from 'pg';
import { PostgresProfiler } from './postgres-profiling';

jest.mock('pg');

const config = {
  host: 'h',
  port: 5432,
  database: 'd',
  user: 'u',
  password: 'sekret',
} as never;

describe('PostgresProfiler', () => {
  const query = jest.fn();
  let profiler: PostgresProfiler;

  const answer = (rows: unknown[]) =>
    query.mockImplementation((sql: string) =>
      Promise.resolve(/^(BEGIN|ROLLBACK)/.test(sql) ? { rows: [] } : { rows }),
    );
  const stmt = () => query.mock.calls[1] as [string, unknown[]];

  beforeEach(() => {
    query.mockReset();
    (Client as unknown as jest.Mock).mockReset();
    (Client as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query,
      end: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    }));
    profiler = new PostgresProfiler();
  });

  it('runs inside a read-only transaction with timeouts', async () => {
    answer([]);
    await profiler.keys(config);
    const calls = query.mock.calls as string[][];
    expect(calls[0][0]).toBe('BEGIN READ ONLY');
    expect(calls[2][0]).toBe('ROLLBACK');
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000,
      }),
    );
  });

  it('maps keys and tables', async () => {
    answer([{ schema: 's', table: 't', contype: 'p', columns: ['id'] }]);
    expect(await profiler.keys(config)).toEqual([
      { schema: 's', table: 't', kind: 'primary', columns: ['id'] },
    ]);
    query.mockClear();
    answer([
      { schema: 's', table: 't', column: 'a', type: 'text', nullable: true },
      {
        schema: 's',
        table: 't',
        column: 'b',
        type: 'integer[]',
        nullable: false,
      },
    ]);
    expect(await profiler.tables(config, 's')).toEqual([
      {
        schema: 's',
        table: 't',
        columns: [
          { name: 'a', type: 'text', nullable: true },
          { name: 'b', type: 'integer[]', nullable: false },
        ],
      },
    ]);
    expect(stmt()[1]).toEqual(['s']);
  });

  it('lists every table-like relation the inventory lists, unreadable ones included', async () => {
    answer([]);
    await profiler.tables(config);
    const [sql, params] = stmt();
    // information_schema hides tables the role cannot read; pg_catalog lists
    // them.
    expect(sql).not.toContain('information_schema.columns');
    expect(sql).toContain('FROM pg_class c');
    expect(sql).toContain('LEFT JOIN pg_attribute a');
    expect(sql).toContain("c.relkind IN ('r', 'v', 'm', 'p', 'f')");
    expect(sql).toContain('a.attnum > 0');
    expect(sql).toContain('NOT a.attisdropped');
    expect(sql).toContain('format_type(a.atttypid, a.atttypmod)');
    expect(sql).toContain(
      "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    );
    expect(params).toEqual([]);
  });

  it('maps views, partitioned tables and column-less relations', async () => {
    answer([
      {
        schema: 's',
        table: 'events',
        column: 'id',
        type: 'bigint',
        nullable: false,
      },
      {
        schema: 's',
        table: 'events',
        column: 'at',
        type: 'timestamp without time zone',
        nullable: true,
      },
      {
        schema: 's',
        table: 'events_2024',
        column: 'id',
        type: 'bigint',
        nullable: false,
      },
      {
        schema: 's',
        table: 'v_recent',
        column: 'id',
        type: 'bigint',
        nullable: true,
      },
      {
        schema: 's',
        table: 'empty_view',
        column: null,
        type: null,
        nullable: null,
      },
    ]);
    expect(await profiler.tables(config)).toEqual([
      {
        schema: 's',
        table: 'events',
        columns: [
          { name: 'id', type: 'bigint', nullable: false },
          { name: 'at', type: 'timestamp without time zone', nullable: true },
        ],
      },
      {
        schema: 's',
        table: 'events_2024',
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
      },
      {
        schema: 's',
        table: 'v_recent',
        columns: [{ name: 'id', type: 'bigint', nullable: true }],
      },
      { schema: 's', table: 'empty_view', columns: [] },
    ]);
  });

  describe('BA-323 sessions', () => {
    const connect = jest.fn();
    const end = jest.fn();

    beforeEach(() => {
      connect.mockReset().mockResolvedValue(undefined);
      end.mockReset().mockResolvedValue(undefined);
      (Client as unknown as jest.Mock).mockImplementation(() => ({
        connect,
        query,
        end,
        on: jest.fn(),
        processID: 4242,
      }));
    });

    /** One table row from the catalogue read, and what `tables` maps it to. */
    const row = {
      schema: 's',
      table: 't',
      column: null,
      type: null,
      nullable: null,
    };
    const listed = [{ schema: 's', table: 't', columns: [] }];
    /** Each statement: transaction control verbatim, a `tables(schema)` read by its schema. */
    const sqls = () =>
      (query.mock.calls as [string, unknown[]?][]).map(([sql, params]) =>
        sql.includes('FROM pg_class c')
          ? `tables(${String(params?.[0])})`
          : sql,
      );

    it('reuses one session across statements, then rolls back and ends it', async () => {
      answer([row]);
      await profiler.withSessions(config, 4, undefined, async (p) => {
        await p.tables(config, 'a');
        await p.tables(config, 'b');
      });
      expect(Client).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(sqls()).toEqual([
        'BEGIN READ ONLY',
        'tables(a)',
        'tables(b)',
        'ROLLBACK',
      ]);
      expect(end).toHaveBeenCalledTimes(1);
    });

    it('opens at most `size` sessions for concurrent statements', async () => {
      answer([row]);
      await profiler.withSessions(config, 2, undefined, async (p) => {
        await Promise.all(['a', 'b', 'c', 'd'].map((s) => p.tables(config, s)));
      });
      expect(Client).toHaveBeenCalledTimes(2);
      expect(end).toHaveBeenCalledTimes(2);
    });

    it('closes sessions when the callback throws', async () => {
      answer([row]);
      await expect(
        profiler.withSessions(config, 2, undefined, async (p) => {
          await p.tables(config, 'a');
          throw new Error('late');
        }),
      ).rejects.toThrow('late');
      expect(end).toHaveBeenCalledTimes(1);
      expect(sqls()).toContain('ROLLBACK');
    });

    it('one failing statement does not break the next on the same session', async () => {
      query.mockImplementation((_sql: string, params?: unknown[]) => {
        if (params?.[0] === 'bad')
          return Promise.reject(new Error('relation does not exist'));
        return Promise.resolve({ rows: [row] });
      });
      await profiler.withSessions(config, 1, undefined, async (p) => {
        await expect(p.tables(config, 'bad')).rejects.toThrow(
          'Postgres — relation does not exist',
        );
        expect(await p.tables(config, 's')).toEqual(listed);
      });
      expect(Client).toHaveBeenCalledTimes(1);
      expect(sqls().slice(0, 5)).toEqual([
        'BEGIN READ ONLY',
        'tables(bad)',
        'ROLLBACK',
        'BEGIN READ ONLY',
        'tables(s)',
      ]);
    });

    it('classifies a statement timeout (57014) as TimeoutError', async () => {
      query.mockImplementation((sql: string) =>
        sql.startsWith('SELECT')
          ? Promise.reject(
              Object.assign(new Error('canceling statement'), {
                code: '57014',
              }),
            )
          : Promise.resolve({ rows: [] }),
      );
      const err = await profiler.tables(config, 's').catch((e: unknown) => e);
      expect(err).toMatchObject({ name: 'TimeoutError' });
      expect((err as Error).message).toContain('timed out');
      await profiler.withSessions(config, 1, undefined, async (p) => {
        const e = await p.tables(config, 's').catch((x: unknown) => x);
        expect(e).toMatchObject({ name: 'TimeoutError' });
      });
    });

    it('abort cancels the running query and rejects later statements', async () => {
      const ctrl = new AbortController();
      query.mockImplementation((sql: string) =>
        sql.includes('FROM pg_class c')
          ? new Promise(() => undefined)
          : Promise.resolve({ rows: [] }),
      );
      await profiler.withSessions(config, 1, ctrl.signal, async (p) => {
        const running = p.tables(config, 'big');
        await new Promise((r) => setImmediate(r));
        ctrl.abort();
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        await expect(p.tables(config, 'x')).rejects.toMatchObject({
          name: 'AbortError',
        });
      });
      await new Promise((r) => setImmediate(r));
      expect(query).toHaveBeenCalledWith(
        'SELECT pg_cancel_backend($1)',
        [4242],
      );
      expect(end).toHaveBeenCalled();
    });

    it('attaches an error listener to every client it creates', async () => {
      answer([row]);
      await profiler.tables(config, 's');
      await profiler.withSessions(config, 1, undefined, async (p) => {
        await p.tables(config, 's');
      });
      const results = (Client as unknown as jest.Mock).mock.results;
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const r of results as { value: { on: jest.Mock } }[]) {
        expect(r.value.on).toHaveBeenCalledWith('error', expect.any(Function));
      }
    });

    it('a pooled client that emits error is discarded; the next statement gets a fresh one', async () => {
      answer([row]);
      await profiler.withSessions(config, 1, undefined, async (p) => {
        await p.tables(config, 'a');
        const first = (Client as unknown as jest.Mock).mock.results[0]
          .value as {
          on: jest.Mock;
        };
        const calls = first.on.mock.calls as [string, () => void][];
        const handler = calls.find((c) => c[0] === 'error')?.[1] as () => void;
        expect(() => handler()).not.toThrow();
        expect(await p.tables(config, 's')).toEqual(listed);
      });
      expect(Client).toHaveBeenCalledTimes(2);
    });

    it('a failed open wakes the queued statement instead of hanging it', async () => {
      answer([row]);
      let n = 0;
      connect.mockImplementation(() =>
        ++n === 1
          ? Promise.reject(new Error('connection refused'))
          : Promise.resolve(undefined),
      );
      await profiler.withSessions(config, 1, undefined, async (p) => {
        const first = p.tables(config, 'a').catch((e: unknown) => e);
        const second = p.tables(config, 's');
        expect(((await first) as Error).message).toContain(
          'connection refused',
        );
        expect(await second).toEqual(listed);
      });
      expect(Client).toHaveBeenCalledTimes(2);
    }, 5000);
  });

  it('never leaks the password in an error', async () => {
    query.mockRejectedValue(
      Object.assign(new Error('boom'), { config: { password: 'sekret' } }),
    );
    await expect(profiler.keys(config)).rejects.toThrow(/^Postgres — boom$/);
  });
});
