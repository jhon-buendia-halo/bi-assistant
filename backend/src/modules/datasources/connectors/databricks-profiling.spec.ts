import { DBSQLClient } from '@databricks/sql';
import { DatabricksProfiler } from './databricks-profiling';

jest.mock('@databricks/sql', () => ({ DBSQLClient: jest.fn() }));

const config = {
  host: 'h.example.com',
  token: 'dapiSECRET',
  warehouseId: 'wh1',
};

describe('DatabricksProfiler', () => {
  let sqls: string[];
  let responder: (sql: string) => unknown[] | Error;
  const profiler = new DatabricksProfiler();

  beforeEach(() => {
    sqls = [];
    responder = () => [];
    const session = {
      executeStatement: jest.fn((sql: string) => {
        sqls.push(sql);
        const r = responder(sql);
        return r instanceof Error
          ? Promise.reject(r)
          : Promise.resolve({ fetchAll: () => Promise.resolve(r) });
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (DBSQLClient as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue(session),
      close: jest.fn().mockResolvedValue(undefined),
    }));
  });

  it('connects with the bare hostname when the stored host has https:// and a trailing slash (BA-322)', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    (DBSQLClient as unknown as jest.Mock).mockImplementation(() => ({
      connect,
      openSession: jest.fn().mockResolvedValue({
        executeStatement: jest.fn().mockResolvedValue({
          fetchAll: () => Promise.resolve([{ total: '1' }]),
        }),
        close: jest.fn().mockResolvedValue(undefined),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    await profiler.columnStats(
      { ...config, host: '  https://dbc-1.cloud.databricks.com/  ' },
      'cat.sch',
      't',
      [],
      ['a'],
      [],
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'dbc-1.cloud.databricks.com' }),
    );
  });

  it('columnStats flattens catalog.schema, backtick-quotes and maps results', async () => {
    responder = () => [
      { total: '10', n0: '2', d0: '5', d1: 3, mn0: '1', mx0: '9' },
    ];
    const out = await profiler.columnStats(
      config,
      'cat.sch',
      'ta`b',
      ['a'],
      ['a', 'b'],
      ['a'],
    );
    expect(sqls[0]).toContain('FROM `cat`.`sch`.`ta``b`');
    expect(sqls[0]).toContain('COUNT_IF(`a` IS NULL)');
    expect(sqls[0]).toContain('COUNT(DISTINCT `b`)');
    expect(sqls[0]).toContain('CAST(MIN(`a`) AS STRING)');
    expect(out).toEqual({
      totalRows: 10,
      nullCounts: { a: 2 },
      distinctCounts: { a: 5, b: 3 },
      minValues: { a: '1' },
      maxValues: { a: '9' },
    });
  });

  it('duplicateCount returns 0 without fields and sums excess', async () => {
    expect(await profiler.duplicateCount(config, 'c.s', 't', [])).toBe(0);
    expect(sqls).toHaveLength(0);
    responder = () => [{ dup_excess: '4' }];
    expect(await profiler.duplicateCount(config, 'c.s', 't', ['x', 'y'])).toBe(
      4,
    );
    expect(sqls[0]).toContain('GROUP BY `x`, `y` HAVING COUNT(*) > 1');
  });

  it('orphanCount joins child to parent', async () => {
    responder = () => [{ orphan_count: 7 }];
    const n = await profiler.orphanCount(config, {
      schema: 'c.s',
      table: 'child',
      column: 'pid',
      refSchema: 'c.s2',
      refTable: 'parent',
      refColumn: 'id',
    });
    expect(n).toBe(7);
    expect(sqls[0]).toContain('FROM `c`.`s`.`child` c');
    expect(sqls[0]).toContain('LEFT JOIN `c`.`s2`.`parent` p');
    expect(sqls[0]).toContain('c.`pid` = p.`id`');
  });

  it('invalidFormatCount inlines the pattern as a raw, case-insensitive literal', async () => {
    responder = () => [{ invalid: '3' }];
    expect(
      await profiler.invalidFormatCount(
        config,
        'c.s',
        't',
        'col',
        '^a\\d\\.\\s$',
      ),
    ).toBe(3);
    expect(sqls[0]).toContain(
      "NOT regexp_like(CAST(`col` AS STRING), r'(?i)^a\\d\\.\\s$')",
    );
  });

  it('invalidFormatCount rejects a pattern with a single quote', async () => {
    await expect(
      profiler.invalidFormatCount(config, 'c.s', 't', 'col', "^a'b$"),
    ).rejects.toThrow(/single quote/);
  });

  it('normalizedDistinctCount lowercases and trims', async () => {
    responder = () => [{ d: '2' }];
    expect(
      await profiler.normalizedDistinctCount(config, 'c.s', 't', 'n'),
    ).toBe(2);
    expect(sqls[0]).toContain(
      'COUNT(DISTINCT lower(trim(CAST(`n` AS STRING))))',
    );
  });

  it('keys groups constraint columns, flattened, skipping system catalogs', async () => {
    responder = (sql) =>
      sql === 'SHOW CATALOGS'
        ? [{ catalog: 'main' }, { catalog: 'system' }]
        : [
            {
              schema_name: 's',
              table_name: 't',
              constraint_name: 'pk',
              kind: 'PRIMARY KEY',
              column_name: 'a',
            },
            {
              schema_name: 's',
              table_name: 't',
              constraint_name: 'pk',
              kind: 'PRIMARY KEY',
              column_name: 'b',
            },
            {
              schema_name: 's',
              table_name: 't',
              constraint_name: 'u',
              kind: 'UNIQUE',
              column_name: 'c',
            },
          ];
    const keys = await profiler.keys(config);
    expect(keys).toEqual([
      { schema: 'main.s', table: 't', kind: 'primary', columns: ['a', 'b'] },
      { schema: 'main.s', table: 't', kind: 'unique', columns: ['c'] },
    ]);
    expect(sqls.filter((s) => s.includes('`system`'))).toHaveLength(0);
  });

  it('foreignKeys maps edges and is empty on failure', async () => {
    responder = (sql) =>
      sql === 'SHOW CATALOGS'
        ? [{ catalog: 'main' }]
        : [
            {
              child_schema: 's',
              child_table: 'o',
              child_col: 'cid',
              parent_schema: 's',
              parent_table: 'c',
              parent_col: 'id',
            },
          ];
    expect(await profiler.foreignKeys(config)).toEqual([
      {
        schema: 'main.s',
        table: 'o',
        column: 'cid',
        refSchema: 'main.s',
        refTable: 'c',
        refColumn: 'id',
      },
    ]);
    responder = () => new Error('denied');
    expect(await profiler.foreignKeys(config)).toEqual([]);
  });

  it('tables reads information_schema and maps lastModifiedAt', async () => {
    responder = (sql) => {
      if (sql.includes('.columns'))
        return [
          {
            table_schema: 's',
            table_name: 't',
            column_name: 'a',
            full_data_type: 'int',
            is_nullable: 'YES',
          },
        ];
      if (sql.includes('.tables'))
        return [
          {
            table_schema: 's',
            table_name: 't',
            last_altered: '2026-01-02T03:04:05.000Z',
          },
        ];
      return [];
    };
    const out = await profiler.tables(config, 'main.s');
    expect(out).toEqual([
      {
        schema: 'main.s',
        table: 't',
        columns: [{ name: 'a', type: 'int', nullable: true }],
        lastModifiedAt: '2026-01-02T03:04:05.000Z',
      },
    ]);
    expect(sqls[0]).toContain('`main`.information_schema.columns');
    expect(sqls[0]).toContain("table_schema = 's'");
  });

  it('reads tables, columns and catalogs in a stable order', async () => {
    responder = (sql) => {
      if (sql === 'SHOW CATALOGS')
        return [{ catalog: 'zeta' }, { catalog: 'alpha' }];
      if (sql.includes('.tables'))
        return [{ table_schema: 's', table_name: 't' }];
      return [];
    };
    const out = await profiler.tables(config);
    const tableSql = sqls.filter((q) => q.includes('.tables'));
    const columnSql = sqls.filter((q) => q.includes('.columns'));
    expect(tableSql).toHaveLength(2);
    for (const q of tableSql) {
      expect(q).toMatch(/ORDER BY table_schema, table_name\s*$/);
    }
    for (const q of columnSql) {
      expect(q).toContain(
        'ORDER BY table_schema, table_name, ordinal_position',
      );
    }
    // Catalogs are visited in name order, whatever SHOW CATALOGS returns.
    expect(columnSql[0]).toContain('`alpha`.information_schema');
    expect(columnSql[1]).toContain('`zeta`.information_schema');
    expect(out.map((t) => t.schema)).toEqual(['alpha.s', 'zeta.s']);
  });

  it('reads foreign keys in a stable order', async () => {
    responder = (sql) => (sql === 'SHOW CATALOGS' ? [{ catalog: 'main' }] : []);
    await profiler.foreignKeys(config);
    const fkSql = sqls.find((q) => q.includes('referential_constraints'));
    expect(fkSql).toContain(
      'ORDER BY kcu.table_schema, kcu.table_name, kcu.constraint_name, kcu.ordinal_position',
    );
  });

  it('a failing statement surfaces an Error without the token', async () => {
    responder = () => new Error('bad auth dapiSECRET rejected');
    const err = await profiler
      .duplicateCount(config, 'c.s', 't', ['a'])
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('dapiSECRET');
    expect((err as Error).message).toContain('rejected');
  });

  it('tablePrivileges marks browse-only schemas as not selectable', async () => {
    responder = (sql) => {
      if (sql === 'SHOW CATALOGS') return [{ catalog: 'main' }];
      if (sql.includes('.tables'))
        return [
          { table_schema: 'open', table_name: 'a' },
          { table_schema: 'locked', table_name: 'b' },
        ];
      return [];
    };
    const fetchMock = jest.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url.includes('/schemas')
              ? {
                  schemas: [
                    { name: 'open' },
                    { name: 'locked', browse_only: true },
                  ],
                }
              : { catalogs: [{ name: 'main' }] },
          ),
      }),
    );
    const orig = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      expect(await profiler.tablePrivileges(config)).toEqual([
        { schema: 'main.open', table: 'a', selectable: true },
        { schema: 'main.locked', table: 'b', selectable: false },
      ]);
    } finally {
      global.fetch = orig;
    }
  });

  it('rowCount runs SELECT COUNT(*) on the qualified table', async () => {
    responder = () => [{ n: '42' }];
    expect(await profiler.rowCount(config, 'c.s', 't')).toBe(42);
    expect(sqls[0]).toContain('SELECT COUNT(*) AS n FROM `c`.`s`.`t`');
  });

  it('columnStats folds normalized-distinct and format aggregates into one SELECT', async () => {
    responder = () => [{ total: '10', d0: '5', nd0: '4', nd1: 2, f0: '3' }];
    const out = await profiler.columnStats(config, 'c.s', 't', [], ['a'], [], {
      normalizedDistinct: ['n', 'm'],
      formats: [{ column: 'e', pattern: '^a\\d$' }],
    });
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain(
      'COUNT(DISTINCT lower(trim(CAST(`n` AS STRING)))) AS nd0',
    );
    expect(sqls[0]).toContain(
      "COUNT_IF(`e` IS NOT NULL AND NOT regexp_like(CAST(`e` AS STRING), r'(?i)^a\\d$')) AS f0",
    );
    expect(out.normalizedDistinctCounts).toEqual({ n: 4, m: 2 });
    expect(out.invalidFormatCounts).toEqual({ e: 3 });
  });

  it('columnStats with only a normalized-distinct extra is a valid SELECT', async () => {
    responder = () => [{ total: '10', nd0: '4' }];
    const out = await profiler.columnStats(config, 'c.s', 't', [], [], [], {
      normalizedDistinct: ['n'],
    });
    expect(sqls[0]).toBe(
      'SELECT COUNT(*) AS total, COUNT(DISTINCT lower(trim(CAST(`n` AS STRING)))) AS nd0 FROM `c`.`s`.`t`',
    );
    expect(out.normalizedDistinctCounts).toEqual({ n: 4 });
  });

  describe('withSessions', () => {
    interface Op {
      fetchAll: jest.Mock;
      cancel: jest.Mock;
      close: jest.Mock;
    }
    let clients: { connect: jest.Mock; close: jest.Mock }[];
    let sessionCloses: jest.Mock[];
    let ops: Op[];
    let behaviour: (sql: string) => Promise<unknown[]>;
    let active: number;
    let maxActive: number;

    beforeEach(() => {
      clients = [];
      sessionCloses = [];
      ops = [];
      active = 0;
      maxActive = 0;
      behaviour = () => Promise.resolve([]);
      (DBSQLClient as unknown as jest.Mock).mockImplementation(() => {
        const sessionClose = jest.fn().mockResolvedValue(undefined);
        sessionCloses.push(sessionClose);
        const session = {
          executeStatement: jest.fn((sql: string) => {
            const op: Op = {
              fetchAll: jest.fn(async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                try {
                  return await behaviour(sql);
                } finally {
                  active--;
                }
              }),
              cancel: jest.fn().mockResolvedValue(undefined),
              close: jest.fn().mockResolvedValue(undefined),
            };
            ops.push(op);
            return Promise.resolve(op);
          }),
          close: sessionClose,
        };
        const client = {
          connect: jest.fn().mockResolvedValue(undefined),
          openSession: jest.fn().mockResolvedValue(session),
          close: jest.fn().mockResolvedValue(undefined),
        };
        clients.push(client);
        return client;
      });
    });

    const tick = () => new Promise((r) => setTimeout(r, 0));

    it('reuses at most `size` sessions, queues the rest and closes all', async () => {
      behaviour = async () => {
        await tick();
        return [{ n: '1' }];
      };
      const out = await profiler.withSessions(config, 2, undefined, async (p) =>
        Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            p.rowCount(config, 'c.s', `t${i}`),
          ),
        ),
      );
      expect(out).toEqual([1, 1, 1, 1, 1, 1]);
      expect(clients).toHaveLength(2);
      expect(maxActive).toBeLessThanOrEqual(2);
      expect(ops).toHaveLength(6);
      for (const c of clients) {
        expect(c.connect).toHaveBeenCalledWith(
          expect.objectContaining({ telemetryEnabled: false }),
        );
        expect(c.close).toHaveBeenCalledTimes(1);
      }
      for (const c of sessionCloses) expect(c).toHaveBeenCalledTimes(1);
    });

    it('opens sessions lazily and closes them when fn throws', async () => {
      await expect(
        profiler.withSessions(config, 3, undefined, async (p) => {
          await p.rowCount(config, 'c.s', 't');
          throw new Error('boom dapiSECRET');
        }),
      ).rejects.toThrow('boom ***');
      expect(clients).toHaveLength(1);
      expect(clients[0].close).toHaveBeenCalledTimes(1);
      expect(sessionCloses[0]).toHaveBeenCalledTimes(1);
    });

    it('abort cancels the in-flight operation and rejects with AbortError', async () => {
      behaviour = () => new Promise(() => undefined);
      const ctrl = new AbortController();
      const result = profiler
        .withSessions(config, 2, ctrl.signal, async (p) => {
          const first = p.rowCount(config, 'c.s', 't');
          const second = p.rowCount(config, 'c.s', 'u');
          await tick();
          await tick();
          ctrl.abort();
          const late = p.rowCount(config, 'c.s', 'v');
          const settled = await Promise.allSettled([first, second, late]);
          return settled.map((s) =>
            s.status === 'rejected' ? (s.reason as Error).name : 'ok',
          );
        })
        .catch((e: Error) => e);
      const names = await result;
      expect(names).toEqual(['AbortError', 'AbortError', 'AbortError']);
      expect(ops.length).toBeGreaterThanOrEqual(2);
      expect(ops[0].cancel).toHaveBeenCalled();
      expect(ops[1].cancel).toHaveBeenCalled();
      expect(clients.every((c) => c.close.mock.calls.length === 1)).toBe(true);
    });

    it('a straggler after fn rejected neither opens nor leaks a session', async () => {
      behaviour = () => Promise.resolve([{ n: '1' }]);
      let scoped!: {
        rowCount: (c: typeof config, s: string, t: string) => Promise<number>;
      };
      let first!: Promise<number>;
      await expect(
        profiler.withSessions(config, 2, undefined, (p) => {
          scoped = p;
          first = p.rowCount(config, 'c.s', 't');
          first.catch(() => undefined);
          return Promise.reject(new Error('fn failed'));
        }),
      ).rejects.toThrow('fn failed');
      await first.catch(() => undefined);
      expect(clients).toHaveLength(1);
      await expect(scoped.rowCount(config, 'c.s', 'u')).rejects.toThrow(
        /closed/,
      );
      expect(clients).toHaveLength(1);
      expect(clients[0].close).toHaveBeenCalledTimes(1);
      expect(sessionCloses[0]).toHaveBeenCalledTimes(1);
    });

    it('a statement that times out is cancelled and reports a TimeoutError', async () => {
      jest.useFakeTimers();
      try {
        behaviour = () => new Promise(() => undefined);
        const p = profiler
          .withSessions(config, 1, undefined, (s) =>
            s.rowCount(config, 'c.s', 't'),
          )
          .catch((e: Error) => e);
        await jest.advanceTimersByTimeAsync(16_000);
        const err = (await p) as Error;
        expect(err.name).toBe('TimeoutError');
        expect(err.message).toContain('timed out');
        expect(ops[0].cancel).toHaveBeenCalled();
        expect(ops[0].close).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('reads the whole inventory once per scope for tables and tablePrivileges', async () => {
      const seen: string[] = [];
      behaviour = () => Promise.resolve([]);
      const origExec = (
        DBSQLClient as unknown as jest.Mock
      ).getMockImplementation()!;
      (DBSQLClient as unknown as jest.Mock).mockImplementation(() => {
        const client = origExec() as {
          openSession: jest.Mock;
        };
        const open = client.openSession;
        client.openSession = jest.fn(async () => {
          const s = (await open()) as {
            executeStatement: (sql: string) => Promise<unknown>;
          };
          const exec = s.executeStatement;
          s.executeStatement = (sql: string) => {
            seen.push(sql);
            return exec(sql);
          };
          return s;
        });
        return client;
      });
      const fetchMock = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ catalogs: [], schemas: [] }),
        }),
      );
      const orig = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;
      try {
        await profiler.withSessions(config, 2, undefined, async (p) => {
          await p.tables(config);
          await p.tablePrivileges(config);
        });
      } finally {
        global.fetch = orig;
      }
      expect(seen.filter((q) => q === 'SHOW CATALOGS')).toHaveLength(1);
    });
  });
});
