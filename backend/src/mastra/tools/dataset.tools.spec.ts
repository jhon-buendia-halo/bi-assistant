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
