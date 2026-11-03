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
});
