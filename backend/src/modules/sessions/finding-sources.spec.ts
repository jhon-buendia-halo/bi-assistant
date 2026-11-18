import { recordFindingSources } from './finding-sources';
import { STORED_ROWS_CAP } from './turn-data';

// One statement per finding, named after it: the statements themselves are
// finding-rows-sql's (its own spec); here only how they run.
jest.mock('../data-readiness/finding-rows-sql', () => ({
  findingRowsQuery: (finding: { id: string }) => ({
    sql: `SELECT '${finding.id}' AS finding`,
    rationale: `Rows behind ${finding.id}`,
  }),
}));
jest.mock('./readiness-bridge', () => ({
  topFindings: (findings: unknown[]) => findings,
}));

const report = (n: number) =>
  ({
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    findings: Array.from({ length: n }, (_, i) => ({ id: `F${i + 1}` })),
  }) as unknown as Parameters<typeof recordFindingSources>[0]['report'];

const findingOf = (sql: string) => /'(F\d+)'/.exec(sql)?.[1] ?? '';

describe('recordFindingSources (agents.md 5.13)', () => {
  it('runs four at a time, each with the stop signal, and records in finding order', async () => {
    let inFlight = 0;
    let peak = 0;
    const run = jest.fn(
      async (_id: string, sql: string, ...rest: [number, unknown]) => {
        expect(rest).toHaveLength(2);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const id = findingOf(sql);
        // F1 ends last of the first four.
        await new Promise((resolve) =>
          setTimeout(resolve, id === 'F1' ? 30 : 1),
        );
        inFlight -= 1;
        if (id === 'F3') throw new Error('relation does not exist');
        return { columns: ['finding'], rows: [{ finding: id }], totalRows: 1 };
      },
    );
    const recorded: string[] = [];
    const stop = new AbortController();
    const outcome = await recordFindingSources({
      report: report(6),
      run,
      signal: stop.signal,
      record: (args, result) =>
        recorded.push(
          `${findingOf(args.sql)}${(result as { error?: string }).error ? ' failed' : ''}`,
        ),
    });
    expect(peak).toBe(4);
    expect(run.mock.calls[0]).toEqual([
      'ds-1',
      "SELECT 'F1' AS finding",
      STORED_ROWS_CAP,
      { signal: stop.signal },
    ]);
    // A failed statement is one failed source; the batch goes on.
    expect(recorded).toEqual(['F1', 'F2', 'F3 failed', 'F4', 'F5', 'F6']);
    expect(outcome).toEqual({
      sourceCount: 6,
      failedSourceCount: 1,
      stopped: false,
    });
  });

  it('a Stop during a statement cancels it: no failed source, the recorded prefix, stopped', async () => {
    const stop = new AbortController();
    const run = jest.fn(
      (
        _id: string,
        sql: string,
        _limit: number,
        options: { signal: AbortSignal },
      ) =>
        findingOf(sql) === 'F1'
          ? Promise.resolve({ columns: ['finding'], rows: [{ finding: 'F1' }] })
          : new Promise<never>((_, reject) =>
              options.signal.addEventListener('abort', () =>
                reject(new Error('canceling statement due to user request')),
              ),
            ),
    );
    const record = jest.fn();
    const done = recordFindingSources({
      report: report(8),
      run,
      signal: stop.signal,
      record,
    });
    await new Promise((resolve) => setImmediate(resolve));
    stop.abort();
    expect(await done).toEqual({
      sourceCount: 1,
      failedSourceCount: 0,
      stopped: true,
    });
    expect(run).toHaveBeenCalledTimes(5);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
