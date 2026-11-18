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
    expect(run.mock.calls).toEqual([
      ['ds-wc', QUERIES[0].sql, STORED_ROWS_CAP],
      ['ds-wc', QUERIES[1].sql, STORED_ROWS_CAP],
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
});
