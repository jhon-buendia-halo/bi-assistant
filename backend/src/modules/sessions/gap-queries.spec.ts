import type { GapQuery } from '../../mastra/workflows/consumption-gap-analysis.steps';
import { runGapQueries } from './gap-queries';
import { STORED_ROWS_CAP } from './turn-data';

const QUERIES: GapQuery[] = [
  {
    id: 'probe-1',
    datasourceId: 'ds-wc',
    sql: 'SELECT count(*) AS n FROM world_cup.wc_consumption.agg_team_tournament',
    rationale: 'How many team tournaments Consumption holds.',
  },
  {
    id: 'probe-2',
    datasourceId: 'ds-wc',
    sql: 'SELECT broken',
    rationale: 'A query that fails.',
  },
];

describe('runGapQueries (agents.md 5.20)', () => {
  it('runs each query in order at the stored-row cap and records it as a source, a failure as a result', async () => {
    const run = jest.fn((_id: string, sql: string) =>
      sql === 'SELECT broken'
        ? Promise.reject(new Error('column "broken" does not exist'))
        : Promise.resolve({ columns: ['n'], rows: [{ n: 64 }], totalRows: 1 }),
    );
    const record = jest.fn();
    const outcome = await runGapQueries({
      queries: QUERIES,
      run,
      signal: new AbortController().signal,
      record,
    });
    // Each statement gets the run's stop signal.
    const signal = expect.any(AbortSignal) as AbortSignal;
    expect(run.mock.calls).toEqual([
      ['ds-wc', QUERIES[0].sql, STORED_ROWS_CAP, { signal }],
      ['ds-wc', QUERIES[1].sql, STORED_ROWS_CAP, { signal }],
    ]);
    expect(outcome).toEqual({
      results: [
        { id: 'probe-1', columns: ['n'], rows: [{ n: 64 }], error: null },
        {
          id: 'probe-2',
          columns: [],
          rows: [],
          error: 'column "broken" does not exist',
        },
      ],
      stopped: false,
    });
    // Each with its rationale and the facts the query inspector reads.
    expect(record.mock.calls).toEqual([
      [
        { sql: QUERIES[0].sql, rationale: QUERIES[0].rationale },
        { columns: ['n'], rows: [{ n: 64 }] },
        { datasourceId: 'ds-wc', rowLimit: STORED_ROWS_CAP, totalRows: 1 },
      ],
      [
        { sql: QUERIES[1].sql, rationale: QUERIES[1].rationale },
        { error: 'column "broken" does not exist' },
        { datasourceId: 'ds-wc', rowLimit: STORED_ROWS_CAP },
      ],
    ]);
  });

  it('stops before the next query once the run is stopped', async () => {
    const stop = new AbortController();
    const run = jest.fn(() => {
      stop.abort();
      return Promise.resolve({ columns: ['n'], rows: [{ n: 1 }] });
    });
    const record = jest.fn();
    const outcome = await runGapQueries({
      queries: QUERIES,
      run,
      signal: stop.signal,
      record,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(outcome.stopped).toBe(true);
    expect(outcome.results.map((result) => result.id)).toEqual(['probe-1']);
  });

  const probes = (n: number): GapQuery[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `probe-${i + 1}`,
      datasourceId: 'ds-wc',
      sql: `SELECT ${i + 1} AS n`,
      rationale: `Probe ${i + 1}.`,
    }));

  it('runs four at a time and records in query order: 1 slow, 2 to 4 fast, recorded 1, 2, 3, 4', async () => {
    let inFlight = 0;
    let peak = 0;
    const run = jest.fn(async (_id: string, sql: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const n = Number(sql.replace(/\D/g, ''));
      // Statement 1 ends last of the first four.
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 30 : 1));
      inFlight -= 1;
      return { columns: ['n'], rows: [{ n }], totalRows: 1 };
    });
    const recorded: string[] = [];
    const outcome = await runGapQueries({
      queries: probes(6),
      run,
      signal: new AbortController().signal,
      record: (args) => recorded.push(args.rationale),
    });
    expect(peak).toBe(4);
    expect(recorded).toEqual([
      'Probe 1.',
      'Probe 2.',
      'Probe 3.',
      'Probe 4.',
      'Probe 5.',
      'Probe 6.',
    ]);
    expect(outcome.results.map((result) => result.id)).toEqual([
      'probe-1',
      'probe-2',
      'probe-3',
      'probe-4',
      'probe-5',
      'probe-6',
    ]);
  });

  it('a Stop during a statement cancels it: no failed record, the recorded prefix, stopped', async () => {
    const stop = new AbortController();
    const run = jest.fn(
      (
        _id: string,
        sql: string,
        _limit: number,
        options: { signal: AbortSignal },
      ) =>
        sql === 'SELECT 1 AS n'
          ? Promise.resolve({ columns: ['n'], rows: [{ n: 1 }] })
          : // As the connector does: the statement rejects on the abort.
            new Promise<never>((_, reject) =>
              options.signal.addEventListener('abort', () =>
                reject(new Error('canceling statement due to user request')),
              ),
            ),
    );
    const record = jest.fn();
    const done = runGapQueries({
      queries: probes(8),
      run,
      signal: stop.signal,
      record,
    });
    await new Promise((resolve) => setImmediate(resolve));
    stop.abort();
    const outcome = await done;
    // 1 ran; 2 to 5 were cut by the stop; 6 to 8 never started.
    expect(run).toHaveBeenCalledTimes(5);
    expect(record).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      results: [
        { id: 'probe-1', columns: ['n'], rows: [{ n: 1 }], error: null },
      ],
      stopped: true,
    });
  });
});
