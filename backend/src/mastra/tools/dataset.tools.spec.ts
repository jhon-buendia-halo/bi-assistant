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
