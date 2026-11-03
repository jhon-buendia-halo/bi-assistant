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
    (Client as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query,
      end: jest.fn().mockResolvedValue(undefined),
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

  it('lists ordinary tables from pg_catalog, unreadable ones included', async () => {
    answer([]);
    await profiler.tables(config);
    const [sql, params] = stmt();
    // information_schema hides tables the role cannot read, so accessibility
    // (R17) would never see them; pg_catalog lists them, views left out.
    expect(sql).not.toContain('information_schema.columns');
    expect(sql).toContain('FROM pg_attribute a');
    expect(sql).toContain("c.relkind = 'r'");
    expect(sql).toContain('NOT a.attisdropped');
    expect(sql).toContain('format_type(a.atttypid, a.atttypmod)');
    expect(params).toEqual([]);
  });

  it('never leaks the password in an error', async () => {
    query.mockRejectedValue(
      Object.assign(new Error('boom'), { config: { password: 'sekret' } }),
    );
    await expect(profiler.keys(config)).rejects.toThrow(/^Postgres — boom$/);
  });
});
