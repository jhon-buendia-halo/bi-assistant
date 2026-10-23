import { RequestContext } from '@mastra/core/request-context';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetToolServices } from '../tool-services';
import { DATASETS_CONTEXT_KEY, runReadOnlySqlTool } from './dataset.tools';
import { USAGE_SINK_CONTEXT_KEY } from '../usage-sink';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext },
) => Promise<unknown>;

describe('run_readonly_sql usage sink (agents-evals R219)', () => {
  const execute = runReadOnlySqlTool.execute as unknown as Execute;
  let runReadOnlySql: jest.Mock;
  let requestContext: RequestContext;

  beforeEach(() => {
    runReadOnlySql = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }] });
    setDatasetToolServices({
      getDatasets: jest
        .fn()
        .mockResolvedValue([
          { name: 'claims', datasourceId: 'ds-1', tables: [] },
        ]),
      runReadOnlySql,
    } as unknown as DatasetToolServices);
    requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, ['claims']);
  });

  const run = () =>
    execute({ sql: 'select 1', rationale: 'because' }, { requestContext });

  it("hands the attempt's sink to the SQL service as the last argument", async () => {
    const sink = jest.fn();
    requestContext.set(USAGE_SINK_CONTEXT_KEY, sink);

    await run();

    const passed = (runReadOnlySql.mock.calls as unknown[][])[0][4] as (
      ...args: unknown[]
    ) => void;
    passed('sql-fixer', { usage: {} }, 'm');
    expect(sink).toHaveBeenCalledWith('sql-fixer', { usage: {} }, 'm');
  });

  it('passes no sink outside an eval', async () => {
    await run();

    expect((runReadOnlySql.mock.calls as unknown[][])[0][4]).toBeUndefined();
  });

  it('never lets a throwing sink break the query', async () => {
    requestContext.set(USAGE_SINK_CONTEXT_KEY, () => {
      throw new Error('boom');
    });
    runReadOnlySql.mockImplementation((...args: unknown[]) => {
      (args[4] as (...a: unknown[]) => void)('sql-fixer', {});
      return Promise.resolve({ columns: ['n'], rows: [{ n: 1 }] });
    });

    await expect(run()).resolves.toEqual(
      expect.objectContaining({ rows: [{ n: 1 }] }),
    );
  });
});

describe('run_readonly_sql note on a grouped result (agents.md 5.3)', () => {
  const execute = runReadOnlySqlTool.execute as unknown as Execute;
  let runReadOnlySql: jest.Mock;
  let requestContext: RequestContext;
  const twoGroups = [
    { g: 'a', n: 2 },
    { g: 'b', n: 3 },
  ];

  beforeEach(() => {
    runReadOnlySql = jest.fn();
    setDatasetToolServices({
      getDatasets: jest
        .fn()
        .mockResolvedValue([
          { name: 'claims', datasourceId: 'ds-1', tables: [] },
        ]),
      runReadOnlySql,
    } as unknown as DatasetToolServices);
    requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, ['claims']);
  });

  const run = (sql: string) =>
    execute({ sql, rationale: 'because' }, { requestContext }) as Promise<{
      note?: string;
    }>;

  it('says where a figure across the rows must come from, with no digits', async () => {
    runReadOnlySql.mockResolvedValue({ columns: ['g', 'n'], rows: twoGroups });

    const { note } = await run('SELECT g, COUNT(*) AS n FROM t GROUP BY g');

    expect(note).toMatch(/^grouped rows — a total across them/);
    expect(note).toContain('SUM(SUM(x)) OVER ()');
    expect(note).not.toMatch(/\d/);
  });

  it('joins it after the notes the SQL service added', async () => {
    runReadOnlySql.mockResolvedValue({
      columns: ['g', 'n'],
      rows: twoGroups,
      correctedSql: 'SELECT g, COUNT(*) AS n FROM t GROUP BY g',
      note: 'original query failed and was auto-corrected — cite the corrected SQL',
    });

    const { note } = await run('SELECT g, COUNT(*) AS n FROM t GROUP BY gg');

    expect(note).toMatch(
      /^original query failed and was auto-corrected — cite the corrected SQL; grouped rows/,
    );
  });

  it('adds nothing to a single row or an ungrouped result', async () => {
    runReadOnlySql.mockResolvedValueOnce({
      columns: ['g', 'n'],
      rows: [twoGroups[0]],
    });
    runReadOnlySql.mockResolvedValueOnce({
      columns: ['g', 'n'],
      rows: twoGroups,
    });

    expect(
      (await run('SELECT g, COUNT(*) AS n FROM t GROUP BY g')).note,
    ).toBeUndefined();
    expect((await run('SELECT g, n FROM t')).note).toBeUndefined();
  });
});

describe('run_readonly_sql warning on a LEFT JOIN filter that removes no row (agents.md 5.4)', () => {
  const execute = runReadOnlySqlTool.execute as unknown as Execute;
  let runReadOnlySql: jest.Mock;
  let requestContext: RequestContext;
  const deadFilter =
    'SELECT r.name, SUM(f.amount) AS total FROM s.regions r LEFT JOIN s.fees f ON f.region_id = r.id LEFT JOIN s.periods p ON p.id = f.period_id AND p.year = 2025 GROUP BY r.name';

  beforeEach(() => {
    runReadOnlySql = jest
      .fn()
      .mockResolvedValue({ columns: ['name', 'total'], rows: [] });
    setDatasetToolServices({
      getDatasets: jest
        .fn()
        .mockResolvedValue([
          { name: 'claims', datasourceId: 'ds-1', tables: [] },
        ]),
      runReadOnlySql,
    } as unknown as DatasetToolServices);
    requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, ['claims']);
  });

  const run = (sql: string) =>
    execute({ sql, rationale: 'because' }, { requestContext }) as Promise<{
      error?: string;
      warnings?: string[];
    }>;

  it('still runs the statement and says where the filter has to go', async () => {
    const result = await run(deadFilter);

    expect(runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^`p\.year = 2025` is in the ON clause of `LEFT JOIN s\.periods p`, and nothing else in the query reads p\. .*in WHERE/,
      ),
    ]);
  });

  it('adds no warning when the filter is in WHERE', async () => {
    const result = await run(
      'SELECT r.name, SUM(f.amount) AS total FROM s.regions r LEFT JOIN s.fees f ON f.region_id = r.id LEFT JOIN s.periods p ON p.id = f.period_id WHERE p.year = 2025 GROUP BY r.name',
    );

    expect(result.warnings).toBeUndefined();
  });
});
