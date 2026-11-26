import { Logger } from '@nestjs/common';
import { DBSQLClient } from '@databricks/sql';
import {
  DatabricksProfiler,
  catalogReads,
  skippedCatalogsMessage,
} from './databricks-profiling';

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
          fetchAll: () => Promise.resolve([]),
        }),
        close: jest.fn().mockResolvedValue(undefined),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    await profiler.tables(
      { ...config, host: '  https://dbc-1.cloud.databricks.com/  ' },
      'cat.sch',
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'dbc-1.cloud.databricks.com' }),
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
    const err = await profiler.tables(config, 'c.s').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('dapiSECRET');
    expect((err as Error).message).toContain('rejected');
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
        return [];
      };
      // Each `tables(config, schema)` runs two statements (columns, tables).
      const out = await profiler.withSessions(config, 2, undefined, async (p) =>
        Promise.all(
          Array.from({ length: 6 }, (_, i) => p.tables(config, `c.s${i}`)),
        ),
      );
      expect(out).toEqual([[], [], [], [], [], []]);
      expect(clients).toHaveLength(2);
      expect(maxActive).toBeLessThanOrEqual(2);
      expect(ops).toHaveLength(12);
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
          await p.tables(config, 'c.s');
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
          const first = p.tables(config, 'c.s');
          const second = p.tables(config, 'c.u');
          await tick();
          await tick();
          ctrl.abort();
          const late = p.tables(config, 'c.v');
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
      behaviour = () => Promise.resolve([]);
      let scoped!: {
        tables: (c: typeof config, s: string) => Promise<unknown[]>;
      };
      let first!: Promise<unknown[]>;
      await expect(
        profiler.withSessions(config, 2, undefined, (p) => {
          scoped = p;
          first = p.tables(config, 'c.s');
          first.catch(() => undefined);
          return Promise.reject(new Error('fn failed'));
        }),
      ).rejects.toThrow('fn failed');
      await first.catch(() => undefined);
      expect(clients).toHaveLength(1);
      await expect(scoped.tables(config, 'c.u')).rejects.toThrow(/closed/);
      expect(clients).toHaveLength(1);
      expect(clients[0].close).toHaveBeenCalledTimes(1);
      expect(sessionCloses[0]).toHaveBeenCalledTimes(1);
    });

    it('a statement that times out is cancelled and reports a TimeoutError', async () => {
      jest.useFakeTimers();
      try {
        behaviour = () => new Promise(() => undefined);
        const p = profiler
          .withSessions(config, 1, undefined, (s) => s.tables(config, 'c.s'))
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

    it('reads the whole inventory once per scope', async () => {
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
      await profiler.withSessions(config, 2, undefined, async (p) => {
        await p.tables(config);
        await p.tables(config);
      });
      expect(seen.filter((q) => q === 'SHOW CATALOGS')).toHaveLength(1);
    });

    describe('with a reach', () => {
      const reach = {
        namespaces: ['big_cat.mkt'],
        entities: [{ namespace: 'big_cat.mkt', name: 'vw_policy' }],
      };

      it('reads only the reached schemas, never listing every catalog', async () => {
        const seen: string[] = [];
        behaviour = (sql) => {
          seen.push(sql);
          if (sql.includes('.tables'))
            return Promise.resolve([
              { table_schema: 'mkt', table_name: 'vw_policy' },
            ]);
          return Promise.resolve([]);
        };
        const out = await profiler.withSessions(
          config,
          2,
          undefined,
          async (p) => {
            const tables = await p.tables(config);
            await p.keys(config);
            await p.foreignKeys(config);
            return tables;
          },
          reach,
        );
        expect(out.map((t) => `${t.schema}.${t.table}`)).toEqual([
          'big_cat.mkt.vw_policy',
        ]);
        expect(seen).not.toContain('SHOW CATALOGS');
        const catalogueReads = seen.filter((q) =>
          q.includes('information_schema'),
        );
        expect(catalogueReads).toHaveLength(4);
        for (const q of catalogueReads) {
          expect(q).toContain('`big_cat`.information_schema');
          expect(q).toMatch(/table_schema IN \('mkt'\)/);
        }
      });

      it('reads the scoped tables alone when their schema is too large to list', async () => {
        const seen: string[] = [];
        behaviour = (sql) => {
          seen.push(sql);
          if (sql.includes('table_schema IN'))
            return Promise.reject(
              new Error('Databricks query timed out after 15s'),
            );
          if (sql.includes('.tables'))
            return Promise.resolve([
              { table_schema: 'mkt', table_name: 'vw_policy' },
            ]);
          return Promise.resolve([]);
        };
        const out = await profiler.withSessions(
          config,
          1,
          undefined,
          (p) => p.tables(config),
          reach,
        );
        expect(out.map((t) => t.table)).toEqual(['vw_policy']);
        expect(seen.some((q) => q.includes("table_name = 'vw_policy'"))).toBe(
          true,
        );
      });

      it('without a reach still lists every catalog', async () => {
        const seen: string[] = [];
        behaviour = (sql) => {
          seen.push(sql);
          return Promise.resolve(
            sql === 'SHOW CATALOGS' ? [{ catalog: 'main' }] : [],
          );
        };
        await profiler.withSessions(config, 1, undefined, (p) =>
          p.tables(config),
        );
        expect(seen).toContain('SHOW CATALOGS');
        expect(seen.some((q) => q.includes('table_schema IN'))).toBe(false);
      });
    });
  });

  it('logs the catalogs it could not read once, not once per catalog', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      responder = (sql) => {
        if (sql === 'SHOW CATALOGS')
          return [{ catalog: 'a' }, { catalog: 'b' }, { catalog: 'ok' }];
        if (sql.includes('`ok`.')) return [];
        return new Error(
          '[INSUFFICIENT_PERMISSIONS] Insufficient privileges:\nUser does not have USE CATALOG.',
        );
      };
      await profiler.tables(config);
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        '[tables] skipped 2 of 3 catalog(s): "a" ([INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have USE CATALOG.); "b" ([INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have USE CATALOG.)',
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('catalogReads', () => {
  it('groups a reach by catalog, in name order, with its schemas and tables', () => {
    expect(
      catalogReads({
        namespaces: ['z.s1', 'a.s2', 'z.s0', 'not-a-namespace'],
        entities: [
          { namespace: 'z.s1', name: 't1' },
          { namespace: 'z.s1', name: 't1' },
          { namespace: 'a.s2', name: 't2' },
        ],
      }),
    ).toEqual([
      {
        catalog: 'a',
        schemas: ['s2'],
        tables: [{ schema: 's2', name: 't2' }],
      },
      {
        catalog: 'z',
        schemas: ['s0', 's1'],
        tables: [{ schema: 's1', name: 't1' }],
      },
    ]);
  });
});

describe('skippedCatalogsMessage', () => {
  it('names the first ten and counts the rest', () => {
    const skipped = Array.from({ length: 12 }, (_, i) => ({
      catalog: `c${i}`,
      error: new Error('denied'),
    }));
    const message = skippedCatalogsMessage('keys', skipped, 20);
    expect(message.startsWith('[keys] skipped 12 of 20 catalog(s): "c0"')).toBe(
      true,
    );
    expect(message).toContain('"c9" (denied)');
    expect(message).not.toContain('"c10"');
    expect(message.endsWith('; and 2 more')).toBe(true);
  });
});
