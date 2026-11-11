import { DBSQLClient } from '@databricks/sql';
import { DatabricksProfiler } from './databricks-profiling';

jest.mock('@databricks/sql', () => ({ DBSQLClient: jest.fn() }));

const config = { host: 'h.example.com', token: 'dapiSECRET', warehouseId: 'wh1' };
const opts = { sampleSize: 1000, repeatableSeed: 7 };
const GIB = 1024 ** 3;

function rowsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

describe('DatabricksProfiler.sampleTable', () => {
  let sqls: string[];
  let responder: (sql: string) => unknown[] | Error;
  const profiler = new DatabricksProfiler();
  const reads = () => sqls.filter((s) => s.startsWith('SELECT * '));

  /** count + detail + a reader for the data statements. */
  const warehouse = (
    count: number | Error,
    bytes: number | Error,
    read: (sql: string) => unknown[] | Error,
  ) => {
    responder = (sql) => {
      if (sql.startsWith('SELECT COUNT')) return count instanceof Error ? count : [{ n: count }];
      if (sql.startsWith('DESCRIBE DETAIL')) return bytes instanceof Error ? bytes : [{ sizeInBytes: bytes }];
      return read(sql);
    };
  };

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

  it('reads a small table in full, backtick-quoted, and skips DESCRIBE DETAIL', async () => {
    warehouse(5, 0, () => rowsOf(5));
    const out = await profiler.sampleTable(config, 'samples.tp`ch', 'region', opts);
    expect(reads()).toEqual(['SELECT * FROM `samples`.`tp``ch`.`region` LIMIT 1000']);
    expect(sqls.some((s) => s.startsWith('DESCRIBE'))).toBe(false);
    expect(out).toMatchObject({ method: 'full', rowCountEstimate: 5, columns: ['id'] });
  });

  it('uses TABLESAMPLE (p PERCENT) REPEATABLE (7) below 50 GiB', async () => {
    warehouse(29_999_795, 753_837_113, () => rowsOf(1000));
    const out = await profiler.sampleTable(config, 'samples.tpch', 'lineitem', opts);
    expect(sqls).toContain('DESCRIBE DETAIL `samples`.`tpch`.`lineitem`');
    expect(reads()).toEqual([
      'SELECT * FROM `samples`.`tpch`.`lineitem` TABLESAMPLE (0.0051 PERCENT) REPEATABLE (7) LIMIT 1000',
    ]);
    expect(out.method).toBe('tablesample');
  });

  it('uses LIMIT from 50 GiB (live: 52 s cold on 160 GB)', async () => {
    warehouse(5_999_989_709, 160_349_373_524, () => rowsOf(1000));
    const out = await profiler.sampleTable(config, 'samples.tpch_sf1000', 'lineitem', opts);
    expect(reads()).toEqual(['SELECT * FROM `samples`.`tpch_sf1000`.`lineitem` LIMIT 1000']);
    expect(out.method).toBe('limit');
  });

  it('is tablesample just under 50 GiB and limit at exactly 50 GiB', async () => {
    warehouse(1_000_000, 50 * GIB - 1, () => rowsOf(1000));
    expect((await profiler.sampleTable(config, 'c.s', 't', opts)).method).toBe('tablesample');
    warehouse(1_000_000, 50 * GIB, () => rowsOf(1000));
    expect((await profiler.sampleTable(config, 'c.s', 't', opts)).method).toBe('limit');
  });

  it('uses LIMIT when the row count or the size is unknown', async () => {
    warehouse(new Error('timed out'), 0, () => rowsOf(1000));
    const a = await profiler.sampleTable(config, 'c.s', 't', opts);
    expect(a).toMatchObject({ method: 'limit', rowCountEstimate: null });
    warehouse(50_000, new Error('not a Delta table'), () => rowsOf(1000));
    const b = await profiler.sampleTable(config, 'c.s', 'v', opts);
    expect(b).toMatchObject({ method: 'limit', rowCountEstimate: 50_000 });
  });

  it('retries once with p x 4 when the read is under half of the expected rows', async () => {
    let n = 0;
    warehouse(5_000_000, GIB, () => rowsOf(n++ === 0 ? 10 : 800));
    const out = await profiler.sampleTable(config, 'c.s', 't', opts);
    expect(reads()).toEqual([
      'SELECT * FROM `c`.`s`.`t` TABLESAMPLE (0.03 PERCENT) REPEATABLE (7) LIMIT 1000',
      'SELECT * FROM `c`.`s`.`t` TABLESAMPLE (0.12 PERCENT) REPEATABLE (7) LIMIT 1000',
    ]);
    expect(out.rows).toHaveLength(800);
  });

  it('falls back to LIMIT when TABLESAMPLE is refused (views)', async () => {
    warehouse(5000, GIB, (sql) =>
      sql.includes('TABLESAMPLE') ? new Error('[UNSUPPORTED] TABLESAMPLE on view') : rowsOf(1000),
    );
    const out = await profiler.sampleTable(config, 'c.s', 'v', opts);
    expect(reads().at(-1)).toBe('SELECT * FROM `c`.`s`.`v` LIMIT 1000');
    expect(out).toMatchObject({ method: 'limit' });
    expect(out.error).toBeUndefined();
  });

  it('labels a LIMIT read that returns fewer rows than asked as full', async () => {
    warehouse(new Error('x'), 0, () => rowsOf(30));
    const out = await profiler.sampleTable(config, 'c.s', 't', opts);
    expect(out.method).toBe('full');
  });

  it('normalises values to strings: Date to ISO, bigint to decimal text, objects to JSON, null kept', async () => {
    warehouse(1, 0, () => [
      {
        d: new Date('2024-01-02T03:04:05.000Z'),
        big: BigInt('9007199254740993'),
        obj: { a: [1, 2] },
        n: null,
        num: 3.5,
        b: true,
      },
    ]);
    const out = await profiler.sampleTable(config, 'c.s', 't', opts);
    expect(out.rows[0]).toEqual({
      d: '2024-01-02T03:04:05.000Z',
      big: '9007199254740993',
      obj: '{"a":[1,2]}',
      n: null,
      num: '3.5',
      b: 'true',
    });
  });

  it('a failing read leaves error and no rows, and the message never carries the token', async () => {
    warehouse(5, 0, () => new Error('PERMISSION_DENIED token dapiSECRET'));
    const out = await profiler.sampleTable(config, 'c.s', 't', opts);
    expect(out.rows).toEqual([]);
    expect(out.error).toContain('PERMISSION_DENIED');
    expect(out.error).not.toContain('dapiSECRET');
  });

  it('a timeout becomes a table error, not a thrown error', async () => {
    jest.useFakeTimers();
    try {
      (DBSQLClient as unknown as jest.Mock).mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        openSession: jest.fn().mockResolvedValue({
          executeStatement: jest.fn(() => new Promise(() => undefined)),
          close: jest.fn().mockResolvedValue(undefined),
        }),
        close: jest.fn().mockResolvedValue(undefined),
      }));
      const p = profiler.sampleTable(config, 'c.s', 't', opts);
      await jest.advanceTimersByTimeAsync(16_000);
      await jest.advanceTimersByTimeAsync(16_000);
      await jest.advanceTimersByTimeAsync(16_000);
      const out = await p;
      expect(out.rows).toEqual([]);
      expect(out.error).toContain('timed out');
    } finally {
      jest.useRealTimers();
    }
  });
});
