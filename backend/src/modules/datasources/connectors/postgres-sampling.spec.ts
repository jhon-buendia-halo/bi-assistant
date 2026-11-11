import { Client } from 'pg';
import { PostgresProfiler } from './postgres-profiling';
import { withSamplingSessions } from './sampling';

jest.mock('pg');

const config = {
  host: 'h',
  port: 5432,
  database: 'd',
  user: 'u',
  password: 'sekret',
} as never;
const opts = { sampleSize: 1000, repeatableSeed: 7 };

type Q = string | { text: string; types?: unknown };
const textOf = (q: Q) => (typeof q === 'string' ? q : q.text);

function rowsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: String(i) }));
}

describe('PostgresProfiler.sampleTable', () => {
  const query = jest.fn();
  let profiler: PostgresProfiler;
  let estimate: unknown;
  let reads: (sql: string) => { rows: unknown[] } | Error;

  const dataSql = () =>
    (query.mock.calls as [Q][])
      .map(([q]) => q)
      .filter((q) => typeof q !== 'string' || q.startsWith('SELECT *'))
      .map(textOf)
      .filter((t) => t.startsWith('SELECT * '));

  beforeEach(() => {
    query.mockReset();
    estimate = 5;
    reads = () => ({ rows: [] });
    query.mockImplementation((q: Q) => {
      const t = textOf(q);
      if (/^(BEGIN|ROLLBACK)/.test(t)) return Promise.resolve({ rows: [] });
      if (t.includes('reltuples')) {
        return estimate instanceof Error
          ? Promise.reject(estimate)
          : Promise.resolve({ rows: estimate === undefined ? [] : [{ n: estimate }] });
      }
      const r = reads(t);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve({ ...r, fields: [{ name: 'id' }] });
    });
    (Client as unknown as jest.Mock).mockReset();
    (Client as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query,
      end: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    }));
    profiler = new PostgresProfiler();
  });

  it('reads a small table in full and quotes identifiers', async () => {
    estimate = '50';
    reads = () => ({ rows: rowsOf(50) });
    const out = await profiler.sampleTable(config, 's"x', 't', opts);
    expect(dataSql()).toEqual(['SELECT * FROM "s""x"."t" LIMIT 1000']);
    expect(out).toMatchObject({ method: 'full', rowCountEstimate: 50, columns: ['id'] });
    expect(out.rows).toHaveLength(50);
    expect(out.error).toBeUndefined();
  });

  it('uses BERNOULLI up to 1M rows with p from the formula and REPEATABLE (7)', async () => {
    estimate = '348950';
    reads = () => ({ rows: rowsOf(1000) });
    const out = await profiler.sampleTable(config, 'us_health', 'medical_claims', opts);
    expect(dataSql()).toEqual([
      'SELECT * FROM "us_health"."medical_claims" TABLESAMPLE BERNOULLI (0.4299) REPEATABLE (7) LIMIT 1000',
    ]);
    expect(out.method).toBe('tablesample');
  });

  it('uses SYSTEM above 1M rows', async () => {
    estimate = '5000000';
    reads = () => ({ rows: rowsOf(1000) });
    await profiler.sampleTable(config, 's', 't', opts);
    expect(dataSql()[0]).toBe(
      'SELECT * FROM "s"."t" TABLESAMPLE SYSTEM (0.03) REPEATABLE (7) LIMIT 1000',
    );
  });

  it('retries once with p x 4 when a tablesample read returns fewer than half the rows', async () => {
    estimate = '5000000';
    let n = 0;
    reads = () => ({ rows: rowsOf(n++ === 0 ? 100 : 900) });
    const out = await profiler.sampleTable(config, 's', 't', opts);
    expect(dataSql()).toEqual([
      'SELECT * FROM "s"."t" TABLESAMPLE SYSTEM (0.03) REPEATABLE (7) LIMIT 1000',
      'SELECT * FROM "s"."t" TABLESAMPLE SYSTEM (0.12) REPEATABLE (7) LIMIT 1000',
    ]);
    expect(out.rows).toHaveLength(900);
    expect(out.method).toBe('tablesample');
  });

  it('does not retry twice', async () => {
    estimate = '5000000';
    reads = () => ({ rows: rowsOf(1) });
    await profiler.sampleTable(config, 's', 't', opts);
    expect(dataSql()).toHaveLength(2);
  });

  it('falls back to LIMIT when TABLESAMPLE errors', async () => {
    estimate = '5000';
    reads = (t) =>
      t.includes('TABLESAMPLE')
        ? new Error('TABLESAMPLE is not supported for views')
        : { rows: rowsOf(1000) };
    const out = await profiler.sampleTable(config, 's', 'v', opts);
    expect(dataSql().at(-1)).toBe('SELECT * FROM "s"."v" LIMIT 1000');
    expect(out).toMatchObject({ method: 'limit', rowCountEstimate: 5000 });
    expect(out.error).toBeUndefined();
  });

  it('treats reltuples -1 as unknown: LIMIT, labelled full when it returns fewer rows than asked', async () => {
    estimate = '-1';
    reads = () => ({ rows: rowsOf(50) });
    const out = await profiler.sampleTable(config, 'world_cup', 'players', opts);
    expect(dataSql()).toEqual(['SELECT * FROM "world_cup"."players" LIMIT 1000']);
    expect(out).toMatchObject({ method: 'full', rowCountEstimate: null });
  });

  it('keeps method limit when an unknown-size LIMIT read fills the limit', async () => {
    estimate = undefined;
    reads = () => ({ rows: rowsOf(1000) });
    const out = await profiler.sampleTable(config, 's', 't', opts);
    expect(out.method).toBe('limit');
  });

  it('reads values as raw text with a per-query type parser, leaving the client config alone', async () => {
    estimate = '10';
    reads = () => ({ rows: rowsOf(1) });
    await profiler.sampleTable(config, 's', 't', opts);
    const sample = (query.mock.calls as [Q][]).find(
      ([q]) => typeof q !== 'string' && q.text.startsWith('SELECT * '),
    )![0] as { types: { getTypeParser: () => (v: string) => string } };
    expect(sample.types.getTypeParser()('2024-01-01 10:00:00')).toBe('2024-01-01 10:00:00');
    expect((Client as unknown as jest.Mock).mock.calls[0][0]).not.toHaveProperty('types');
  });

  it('a failing read leaves error, no rows and sampledRows 0, without leaking the config', async () => {
    estimate = '10';
    reads = () => new Error('permission denied for table t');
    const out = await profiler.sampleTable(config, 's', 't', opts);
    expect(out.rows).toEqual([]);
    expect(out.error).toContain('permission denied');
    expect(out.error).not.toContain('sekret');
  });

  it('a statement timeout becomes a table error', async () => {
    estimate = '10';
    reads = () => Object.assign(new Error('canceling statement'), { code: '57014' });
    const out = await profiler.sampleTable(config, 's', 't', opts);
    expect(out.error).toContain('timed out');
    expect(out.rows).toEqual([]);
  });

  it('sampleTable runs on the scope of withSamplingSessions', async () => {
    estimate = '10';
    reads = () => ({ rows: rowsOf(2) });
    const out = await withSamplingSessions(profiler, config, 2, undefined, (scoped) =>
      scoped.sampleTable(config, 's', 't', opts),
    );
    expect(out.rows).toHaveLength(2);
    expect((Client as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });
});
