import { RequestContext } from '@mastra/core/request-context';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  setDatasetToolServices,
  type DatasetToolServices,
} from '../tool-services';
import {
  DATASETS_CONTEXT_KEY,
  runReadOnlySqlTool,
  sampleRowsTool,
} from './dataset.tools';
import { USAGE_SINK_CONTEXT_KEY } from '../usage-sink';

type Execute = (
  input: Record<string, unknown>,
  context: {
    requestContext: RequestContext;
    agent?: { toolCallId: string };
  },
) => Promise<unknown>;

const SQL = 'SELECT name FROM shop.public.products ORDER BY name';

function services(
  overrides: Partial<DatasetToolServices> = {},
): DatasetToolServices {
  return {
    getDatasets: jest.fn().mockResolvedValue([
      {
        name: 'shop',
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
        tables: ['shop.public.products'],
      },
    ]),
    sampleRows: jest.fn().mockResolvedValue({
      columns: ['name'],
      rows: [{ name: 'a' }],
      totalRows: 1,
    }),
    runReadOnlySql: jest.fn().mockResolvedValue({
      columns: ['name'],
      rows: [{ name: 'a' }, { name: 'b' }],
      truncated: true,
      totalRows: 1870,
    }),
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    showPanelItem: jest.fn(),
    updateWorkflow: jest.fn(),
    ...overrides,
  };
}

function turnContext(): {
  requestContext: RequestContext;
  facts: Map<string, QueryFacts>;
} {
  const requestContext = new RequestContext();
  const facts = new Map<string, QueryFacts>();
  requestContext.set(DATASETS_CONTEXT_KEY, ['shop']);
  requestContext.set(QUERY_FACTS_CONTEXT_KEY, facts);
  return { requestContext, facts };
}

describe('run_readonly_sql: facts beside the result (plan m1-25 1.25.1)', () => {
  const execute = runReadOnlySqlTool.execute as unknown as Execute;

  it('returns no totalRows key, so the model input is unchanged', async () => {
    setDatasetToolServices(services());
    const { requestContext } = turnContext();
    const result = await execute(
      { sql: SQL, limit: 2, rationale: 'r' },
      { requestContext, agent: { toolCallId: 'call-1' } },
    );
    expect(result).not.toHaveProperty('totalRows');
    expect(result).toEqual({
      columns: ['name'],
      rows: [{ name: 'a' }, { name: 'b' }],
      truncated: true,
    });
  });

  it('warns that the row cap was reached only when the cap dropped rows', async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ name: `p${n}` }));
    const ranked = `${SQL} ORDER BY name`;
    const ask = async (totalRows: number | undefined) => {
      setDatasetToolServices(
        services({
          runReadOnlySql: jest.fn().mockResolvedValue({
            columns: ['name'],
            rows,
            ...(totalRows === undefined ? {} : { totalRows }),
          }),
        }),
      );
      const { requestContext } = turnContext();
      const result = (await execute(
        { sql: ranked, rationale: 'r' },
        { requestContext, agent: { toolCallId: 'call-1' } },
      )) as { warnings?: string[] };
      return (result.warnings ?? []).join(' ');
    };
    // The statement produced 2,431 rows and the cap kept 100.
    expect(await ask(2431)).toContain('stopped at 100 rows');
    // It produced exactly 100: nothing was dropped.
    expect(await ask(100)).not.toContain('stopped at');
    // A connector that does not say: a full page still warns.
    expect(await ask(undefined)).toContain('stopped at 100 rows');
  });

  it('writes the facts keyed by the tool call id and by the statement', async () => {
    setDatasetToolServices(services());
    const { requestContext, facts } = turnContext();
    await execute(
      { sql: SQL, rationale: 'r' },
      { requestContext, agent: { toolCallId: 'call-1' } },
    );
    const expected = { datasourceId: 'ds-1', totalRows: 1870, rowLimit: 100 };
    expect(facts.get('call-1')).toEqual(expected);
    expect(facts.get(queryFactsKey('run_readonly_sql', SQL))).toEqual(expected);
  });

  it('keys a repaired statement by the SQL that ran', async () => {
    const fixed = `${SQL} LIMIT 10`;
    setDatasetToolServices(
      services({
        runReadOnlySql: jest.fn().mockResolvedValue({
          columns: ['name'],
          rows: [],
          correctedSql: fixed,
          totalRows: 0,
        }),
      }),
    );
    const { requestContext, facts } = turnContext();
    const result = await execute(
      { sql: SQL, rationale: 'r' },
      { requestContext },
    );
    expect(result).not.toHaveProperty('totalRows');
    expect(facts.get(queryFactsKey('run_readonly_sql', fixed))).toEqual({
      datasourceId: 'ds-1',
      totalRows: 0,
      rowLimit: 100,
    });
  });

  it('still answers with no facts map in the context', async () => {
    setDatasetToolServices(services());
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, ['shop']);
    const result = await execute(
      { sql: SQL, rationale: 'r' },
      { requestContext },
    );
    expect(result).not.toHaveProperty('totalRows');
  });
});

describe('the turn stop signal reaches each statement (agents.md 3.3, 3.4)', () => {
  const runSql = runReadOnlySqlTool.execute as unknown as (
    input: Record<string, unknown>,
    context: { requestContext: RequestContext; abortSignal?: AbortSignal },
  ) => Promise<unknown>;
  const sample = sampleRowsTool.execute as unknown as typeof runSql;

  it('run_readonly_sql hands the tool call its abort signal', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockResolvedValue({ columns: ['name'], rows: [{ name: 'a' }] });
    setDatasetToolServices(services({ runReadOnlySql }));
    const stop = new AbortController();
    await runSql(
      { sql: SQL, limit: 2, rationale: 'r' },
      {
        requestContext: turnContext().requestContext,
        abortSignal: stop.signal,
      },
    );
    expect(runReadOnlySql).toHaveBeenCalledWith('ds-1', SQL, 2, ['shop'], {
      signal: stop.signal,
    });
  });

  it('sample_rows hands the tool call its abort signal', async () => {
    const sampleRows = jest
      .fn()
      .mockResolvedValue({ columns: ['name'], rows: [{ name: 'a' }] });
    setDatasetToolServices(services({ sampleRows }));
    const stop = new AbortController();
    await sample(
      { entity: 'shop.public.products', rationale: 'r' },
      {
        requestContext: turnContext().requestContext,
        abortSignal: stop.signal,
      },
    );
    expect(sampleRows).toHaveBeenCalledWith(
      'ds-1',
      'shop.public.products',
      10,
      { signal: stop.signal },
    );
  });

  it('a statement cut by the stop ends the call, not as a failed query result', async () => {
    const stop = new AbortController();
    setDatasetToolServices(
      services({
        runReadOnlySql: jest.fn(() => {
          stop.abort(new Error('The run was stopped'));
          return Promise.reject(new Error('The run was stopped'));
        }),
      }),
    );
    await expect(
      runSql(
        { sql: SQL, rationale: 'r' },
        {
          requestContext: turnContext().requestContext,
          abortSignal: stop.signal,
        },
      ),
    ).rejects.toThrow('The run was stopped');
  });

  it('a statement that fails without a stop is still a result with its error', async () => {
    setDatasetToolServices(
      services({
        runReadOnlySql: jest
          .fn()
          .mockRejectedValue(new Error('column "x" does not exist')),
      }),
    );
    await expect(
      runSql(
        { sql: SQL, rationale: 'r' },
        {
          requestContext: turnContext().requestContext,
          abortSignal: new AbortController().signal,
        },
      ),
    ).resolves.toEqual({ error: 'column "x" does not exist' });
  });
});

describe('sample_rows: facts beside the result', () => {
  const execute = sampleRowsTool.execute as unknown as Execute;

  it('returns no totalRows key and records the sample cap', async () => {
    setDatasetToolServices(services());
    const { requestContext, facts } = turnContext();
    const result = await execute(
      { entity: 'shop.public.products', rationale: 'r' },
      { requestContext, agent: { toolCallId: 'call-2' } },
    );
    expect(result).toEqual({ columns: ['name'], rows: [{ name: 'a' }] });
    expect(facts.get('call-2')).toEqual({
      datasourceId: 'ds-1',
      totalRows: 1,
      rowLimit: 10,
    });
  });
});

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

  it("hands the attempt's sink to the SQL service in its options", async () => {
    const sink = jest.fn();
    requestContext.set(USAGE_SINK_CONTEXT_KEY, sink);

    await run();

    const passed = (
      (runReadOnlySql.mock.calls as unknown[][])[0][4] as {
        usageSink: (...args: unknown[]) => void;
      }
    ).usageSink;
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
      (args[4] as { usageSink: (...a: unknown[]) => void }).usageSink(
        'sql-fixer',
        {},
      );
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
