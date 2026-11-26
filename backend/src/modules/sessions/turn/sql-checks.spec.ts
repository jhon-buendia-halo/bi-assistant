// The guarded read-only path of a turn (agents.md 5.2): the row clamp a
// caller passes (`SqlCallOptions.maxRows`, a dashboard's data query) reaches
// the datasource with the turn's stop signal, and a call without one keeps
// the connectors' default clamp.
jest.mock('../../../mastra/agents/sql-fixer.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlFixOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('../../../mastra/model-resolver', () => ({
  resolveAgentModelConfig: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));

import { SqlChecks } from './sql-checks';

function checks(runReadOnlySql: jest.Mock) {
  return new SqlChecks({
    mastra: {} as never,
    datasourcesService: { runReadOnlySql } as never,
    verifiedQueries: {} as never,
    datasets: { bound: jest.fn().mockResolvedValue([]) } as never,
    logger: { warn: jest.fn() } as never,
  });
}

describe('SqlChecks passes the row clamp through (plan bi-dashboard 2.2)', () => {
  it('runSqlWithRepair hands maxRows and the stop signal to the datasource', async () => {
    const run = jest.fn().mockResolvedValue({
      columns: ['team'],
      rows: [{ team: 'Brazil' }],
      totalRows: 1,
    });
    const signal = new AbortController().signal;
    const result = await checks(run).runSqlWithRepair(
      'ds-pg',
      'SELECT team FROM goals',
      5000,
      ['World Cup'],
      { signal, maxRows: 5000 },
    );
    expect(run).toHaveBeenCalledWith(
      'ds-pg',
      'SELECT team FROM goals',
      5000,
      5000,
      { signal },
    );
    expect(result.truncated).toBeUndefined();
  });

  it('passes maxRows without a signal, and keeps the default clamp without either', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }], totalRows: 1 });
    await checks(run).runSqlWithRepair('ds-pg', 'SELECT 1 AS n', 5000, [], {
      maxRows: 5000,
    });
    expect(run).toHaveBeenLastCalledWith('ds-pg', 'SELECT 1 AS n', 5000, 5000);
    await checks(run).runSqlWithRepair('ds-pg', 'SELECT 1 AS n', 100, []);
    expect(run).toHaveBeenLastCalledWith('ds-pg', 'SELECT 1 AS n', 100);
    const signal = new AbortController().signal;
    await checks(run).runSqlWithRepair('ds-pg', 'SELECT 1 AS n', 100, [], {
      signal,
    });
    expect(run).toHaveBeenLastCalledWith(
      'ds-pg',
      'SELECT 1 AS n',
      100,
      undefined,
      { signal },
    );
  });

  it('marks a result the clamp cut as truncated', async () => {
    const rows = Array.from({ length: 5000 }, (_, n) => ({ n }));
    const run = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows, totalRows: 5001 });
    const result = await checks(run).runSqlWithRepair(
      'ds-pg',
      'SELECT n FROM t',
      5000,
      [],
      { maxRows: 5000 },
    );
    expect(result.truncated).toBe(true);
  });
});
