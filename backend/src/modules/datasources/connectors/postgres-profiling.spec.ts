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
    answer([{ n: '3' }]);
    await profiler.normalizedDistinctCount(config, 's', 't', 'c');
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

  it('columnStats with only a normalized-distinct extra is a valid SELECT', async () => {
    answer([{ total: '10', nd0: '4' }]);
    const out = await profiler.columnStats(config, 's', 't', [], [], [], {
      normalizedDistinct: ['n'],
    });
    const [sql] = stmt();
    expect(sql).toBe(
      'SELECT COUNT(*)::bigint AS total, COUNT(DISTINCT lower(btrim("n"::text)))::bigint AS "nd0" FROM "s"."t"',
    );
    expect(out.normalizedDistinctCounts).toEqual({ n: 4 });
  });

  it('builds one aggregate per table and maps the row', async () => {
    answer([{ total: '10', n0: '4', d0: '6', d1: '10', mn0: '1', mx0: null }]);
    const s = await profiler.columnStats(
      config,
      's',
      't',
      ['a'],
      ['a', 'b'],
      ['b'],
    );
    const [sql] = stmt();
    expect(sql).toContain('COUNT(*) FILTER (WHERE "a" IS NULL)');
    expect(sql).toContain('COUNT(DISTINCT "b")');
    expect(sql).toContain('MIN("b")::text');
    expect(sql).toContain('FROM "s"."t"');
    expect(s).toEqual({
      totalRows: 10,
      nullCounts: { a: 4 },
      distinctCounts: { a: 6, b: 10 },
      minValues: { b: '1' },
      maxValues: {},
    });
  });

  it('escapes embedded quotes in identifiers', async () => {
    answer([{ dup_rows: '2' }]);
    expect(await profiler.duplicateCount(config, 's"x', 't', ['c"d'])).toBe(2);
    const [sql] = stmt();
    expect(sql).toContain('"s""x"."t"');
    expect(sql).toContain('GROUP BY "c""d" HAVING COUNT(*) > 1');
  });

  it('returns 0 duplicates for no fields without querying', async () => {
    expect(await profiler.duplicateCount(config, 's', 't', [])).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('passes the pattern as a bind parameter', async () => {
    answer([{ bad: '1' }]);
    expect(
      await profiler.invalidFormatCount(config, 's', 't', 'e', "x'y"),
    ).toBe(1);
    const [sql, params] = stmt();
    expect(sql).toContain('::text !~* $1');
    expect(params).toEqual(["x'y"]);
  });

  it('counts orphans with a left join', async () => {
    answer([{ orphans: '5' }]);
    const n = await profiler.orphanCount(config, {
      schema: 's',
      table: 'c',
      column: 'pid',
      refSchema: 's',
      refTable: 'p',
      refColumn: 'id',
    });
    expect(n).toBe(5);
    expect(stmt()[0]).toContain('LEFT JOIN "s"."p" p');
  });

  it('maps keys, privileges and tables', async () => {
    answer([{ schema: 's', table: 't', contype: 'p', columns: ['id'] }]);
    expect(await profiler.keys(config)).toEqual([
      { schema: 's', table: 't', kind: 'primary', columns: ['id'] },
    ]);
    query.mockClear();
    answer([{ schema: 's', table: 't', selectable: false }]);
    expect(await profiler.tablePrivileges(config)).toEqual([
      { schema: 's', table: 't', selectable: false },
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
    // information_schema hides tables the role cannot read, so accessibility
    // (R17) would never see them; pg_catalog lists them.
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

  it('probes SELECT on the same relation kinds as the inventory', async () => {
    answer([
      { schema: 's', table: 'events', selectable: true },
      { schema: 's', table: 'v_recent', selectable: true },
    ]);
    expect(await profiler.tablePrivileges(config)).toEqual([
      { schema: 's', table: 'events', selectable: true },
      { schema: 's', table: 'v_recent', selectable: true },
    ]);
    const [sql] = stmt();
    expect(sql).toContain("c.relkind IN ('r', 'v', 'm', 'p', 'f')");
    expect(sql).not.toContain("c.relkind = 'r'");
    expect(sql).toContain("has_table_privilege(c.oid, 'SELECT')");
  });

  describe('BA-323 sessions, folded stats, rowCount', () => {
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

    const sqls = () => (query.mock.calls as string[][]).map((c) => c[0]);

    it('rowCount runs SELECT COUNT(*)', async () => {
      answer([{ n: '123' }]);
      expect(await profiler.rowCount(config, 's', 't')).toBe(123);
      expect(stmt()[0]).toBe('SELECT COUNT(*)::bigint AS n FROM "s"."t"');
    });

    it('folds normalized distinct and invalid-format counts into one statement', async () => {
      answer([{ total: '10', d0: '6', nd0: '5', nd1: '4', f0: '2', f1: '0' }]);
      const s = await profiler.columnStats(config, 's', 't', [], ['a'], [], {
        normalizedDistinct: ['a', 'b'],
        formats: [
          { column: 'e', pattern: 'p1' },
          { column: 'z', pattern: 'p2' },
        ],
      });
      const [sql, params] = stmt();
      expect(sql).toContain(
        'COUNT(DISTINCT lower(btrim("b"::text)))::bigint AS "nd1"',
      );
      expect(sql).toContain(
        `COUNT(*) FILTER (WHERE "z" IS NOT NULL AND "z"::text !~* $2)::bigint AS "f1"`,
      );
      expect(params).toEqual(['p1', 'p2']);
      expect(s.normalizedDistinctCounts).toEqual({ a: 5, b: 4 });
      expect(s.invalidFormatCounts).toEqual({ e: 2, z: 0 });
    });

    it('reuses one session across statements, then rolls back and ends it', async () => {
      answer([{ n: '1' }]);
      await profiler.withSessions(config, 4, undefined, async (p) => {
        await p.rowCount(config, 's', 'a');
        await p.rowCount(config, 's', 'b');
      });
      expect(Client).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(sqls()).toEqual([
        'BEGIN READ ONLY',
        'SELECT COUNT(*)::bigint AS n FROM "s"."a"',
        'SELECT COUNT(*)::bigint AS n FROM "s"."b"',
        'ROLLBACK',
      ]);
      expect(end).toHaveBeenCalledTimes(1);
    });

    it('opens at most `size` sessions for concurrent statements', async () => {
      answer([{ n: '1' }]);
      await profiler.withSessions(config, 2, undefined, async (p) => {
        await Promise.all(
          ['a', 'b', 'c', 'd'].map((t) => p.rowCount(config, 's', t)),
        );
      });
      expect(Client).toHaveBeenCalledTimes(2);
      expect(end).toHaveBeenCalledTimes(2);
    });

    it('closes sessions when the callback throws', async () => {
      answer([{ n: '1' }]);
      await expect(
        profiler.withSessions(config, 2, undefined, async (p) => {
          await p.rowCount(config, 's', 'a');
          throw new Error('late');
        }),
      ).rejects.toThrow('late');
      expect(end).toHaveBeenCalledTimes(1);
      expect(sqls()).toContain('ROLLBACK');
    });

    it('one failing statement does not break the next on the same session', async () => {
      query.mockImplementation((sql: string) => {
        if (sql.includes('"bad"'))
          return Promise.reject(new Error('relation does not exist'));
        return Promise.resolve({ rows: [{ n: '7' }] });
      });
      await profiler.withSessions(config, 1, undefined, async (p) => {
        await expect(p.rowCount(config, 's', 'bad')).rejects.toThrow(
          'Postgres — relation does not exist',
        );
        expect(await p.rowCount(config, 's', 'ok')).toBe(7);
      });
      expect(Client).toHaveBeenCalledTimes(1);
      expect(sqls().slice(0, 5)).toEqual([
        'BEGIN READ ONLY',
        'SELECT COUNT(*)::bigint AS n FROM "s"."bad"',
        'ROLLBACK',
        'BEGIN READ ONLY',
        'SELECT COUNT(*)::bigint AS n FROM "s"."ok"',
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
      const err = await profiler
        .rowCount(config, 's', 't')
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ name: 'TimeoutError' });
      expect((err as Error).message).toContain('timed out');
      await profiler.withSessions(config, 1, undefined, async (p) => {
        const e = await p.rowCount(config, 's', 't').catch((x: unknown) => x);
        expect(e).toMatchObject({ name: 'TimeoutError' });
      });
    });

    it('abort cancels the running query and rejects later statements', async () => {
      const ctrl = new AbortController();
      query.mockImplementation((sql: string) =>
        sql.startsWith('SELECT COUNT')
          ? new Promise(() => undefined)
          : Promise.resolve({ rows: [] }),
      );
      await profiler.withSessions(config, 1, ctrl.signal, async (p) => {
        const running = p.rowCount(config, 's', 'big');
        await new Promise((r) => setImmediate(r));
        ctrl.abort();
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        await expect(p.rowCount(config, 's', 'x')).rejects.toMatchObject({
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
      answer([{ n: '1' }]);
      await profiler.rowCount(config, 's', 't');
      await profiler.withSessions(config, 1, undefined, async (p) => {
        await p.rowCount(config, 's', 't');
      });
      const results = (Client as unknown as jest.Mock).mock.results;
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const r of results as { value: { on: jest.Mock } }[]) {
        expect(r.value.on).toHaveBeenCalledWith('error', expect.any(Function));
      }
    });

    it('a pooled client that emits error is discarded; the next statement gets a fresh one', async () => {
      answer([{ n: '1' }]);
      await profiler.withSessions(config, 1, undefined, async (p) => {
        await p.rowCount(config, 's', 'a');
        const first = (Client as unknown as jest.Mock).mock.results[0]
          .value as {
          on: jest.Mock;
        };
        const calls = first.on.mock.calls as [string, () => void][];
        const handler = calls.find((c) => c[0] === 'error')?.[1] as () => void;
        expect(() => handler()).not.toThrow();
        expect(await p.rowCount(config, 's', 'b')).toBe(1);
      });
      expect(Client).toHaveBeenCalledTimes(2);
    });

    it('a failed open wakes the queued statement instead of hanging it', async () => {
      answer([{ n: '1' }]);
      let n = 0;
      connect.mockImplementation(() =>
        ++n === 1
          ? Promise.reject(new Error('connection refused'))
          : Promise.resolve(undefined),
      );
      await profiler.withSessions(config, 1, undefined, async (p) => {
        const first = p.rowCount(config, 's', 'a').catch((e: unknown) => e);
        const second = p.rowCount(config, 's', 'b');
        expect(((await first) as Error).message).toContain(
          'connection refused',
        );
        expect(await second).toBe(1);
      });
      expect(Client).toHaveBeenCalledTimes(2);
    }, 5000);

    it('caches table privileges per scope', async () => {
      answer([{ schema: 's', table: 't', selectable: true }]);
      await profiler.withSessions(config, 2, undefined, async (p) => {
        await p.tablePrivileges(config);
        await p.tablePrivileges(config);
      });
      expect(
        sqls().filter((s) => s.includes('has_table_privilege')),
      ).toHaveLength(1);
    });
  });

  it('never leaks the password in an error', async () => {
    query.mockRejectedValue(
      Object.assign(new Error('boom'), { config: { password: 'sekret' } }),
    );
    await expect(profiler.keys(config)).rejects.toThrow(/^Postgres — boom$/);
  });
});
