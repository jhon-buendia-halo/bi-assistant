import { RequestContext } from '@mastra/core/request-context';
import type {
  PageRequest,
  PageResult,
} from '../../modules/datasources/connectors/paged-sql.types';
import type { ExplorerCandidate } from '../agents/result-explorer.prompts';
import {
  EXPLORABLE_QUERIES_CONTEXT_KEY,
  type ExplorableQuery,
} from '../../modules/sessions/query-evidence/explorable-queries';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  setDatasetToolServices,
  type DatasetToolServices,
  type ExploredQuerySource,
} from '../tool-services';
import { DATASETS_CONTEXT_KEY } from './dataset.tools';
import { exploreResultTool } from './explore-result.tool';

type Execute = (
  input: Record<string, unknown>,
  context: {
    requestContext: RequestContext;
    agent?: { toolCallId: string };
  },
) => Promise<Record<string, unknown>>;
type ToModelOutput = (output: unknown) => { type: string; value: unknown };

const execute = exploreResultTool.execute as unknown as Execute;

const GOALS: ExplorableQuery = {
  ref: 'Q1',
  sql: 'SELECT country, goals\nFROM wc.public.scorers\nORDER BY goals DESC;',
  datasourceId: 'ds-1',
  columns: ['country', 'goals'],
  kinds: { country: 'text', goals: 'number' },
  sampleValues: { country: ['Brazil', 'France'], goals: [8, 6] },
  rationale: 'Top scorers by country.',
};
const MATCHES: ExplorableQuery = {
  ref: 'Q2',
  sql: 'SELECT year, attendance FROM wc.public.matches',
  datasourceId: 'ds-1',
  columns: ['year', 'attendance'],
  kinds: { year: 'number', attendance: 'number' },
  sampleValues: { year: [2018], attendance: [78011] },
};

function pageOf(overrides: Partial<PageResult> = {}): PageResult {
  return {
    columns: ['country', 'goals'],
    columnKinds: { country: 'text', goals: 'number' },
    rows: [{ country: 'Brazil', goals: 8 }],
    page: 2,
    pageSize: 1,
    pageCount: 4,
    matchedRows: 4,
    capped: false,
    view: {
      filters: [],
      sort: [],
      page: 2,
      pageSize: 1,
      matchedRows: 4,
      capped: false,
    },
    ranAt: '2026-11-16T00:00:00.000Z',
    ...overrides,
  };
}

let pageQuery: jest.Mock;
let interpretResult: jest.Mock;

/** The source and request of the first page call. */
function paged(): { source: ExploredQuerySource; request: PageRequest } {
  // The latest call: a test may page twice.
  const [source, , request] = pageQuery.mock.calls.at(-1) as [
    ExploredQuerySource,
    string[],
    PageRequest,
  ];
  return { source, request };
}

/** What result-explorer was asked. */
function interpreted(): { text: string; candidates: ExplorerCandidate[] } {
  return (
    interpretResult.mock.calls[0] as [
      { text: string; candidates: ExplorerCandidate[] },
    ]
  )[0];
}

beforeEach(() => {
  pageQuery = jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ ...pageOf(), datasourceId: 'ds-1' }),
    );
  interpretResult = jest.fn();
  const services: DatasetToolServices = {
    getDatasets: jest.fn(),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    showPanelItem: jest.fn(),
    updateWorkflow: jest.fn(),
    pageQuery,
    interpretResult,
  };
  setDatasetToolServices(services);
});

function turnContext(queries: ExplorableQuery[] = [GOALS, MATCHES]): {
  requestContext: RequestContext;
  facts: Map<string, QueryFacts>;
} {
  const requestContext = new RequestContext();
  const facts = new Map<string, QueryFacts>();
  requestContext.set(DATASETS_CONTEXT_KEY, ['World Cup']);
  requestContext.set(QUERY_FACTS_CONTEXT_KEY, facts);
  requestContext.set(EXPLORABLE_QUERIES_CONTEXT_KEY, queries);
  return { requestContext, facts };
}

describe('explore_result (agents.md 3.15; plan 0.4)', () => {
  it('pages the latest query when no query is named', async () => {
    const { requestContext } = turnContext();
    const result = await execute(
      { page: 2, pageSize: 1, rationale: 'The next rows.' },
      { requestContext },
    );
    expect(pageQuery).toHaveBeenCalledWith(
      {
        sql: MATCHES.sql,
        datasourceId: 'ds-1',
        columns: MATCHES.columns,
        kinds: MATCHES.kinds,
      },
      ['World Cup'],
      { page: 2, pageSize: 1 },
    );
    expect(result).toMatchObject({
      sourceSql: MATCHES.sql,
      datasourceId: 'ds-1',
      page: 2,
      pageCount: 4,
      matchedRows: 4,
      capped: false,
    });
  });

  it('matches a named query whatever its whitespace and trailing semicolon', async () => {
    const { requestContext } = turnContext();
    await execute(
      {
        query:
          '  SELECT country, goals FROM wc.public.scorers   ORDER BY goals DESC ',
        sort: [{ column: 'goals', direction: 'asc' }],
        rationale: 'Lowest scorers first.',
      },
      { requestContext },
    );
    expect(paged().source).toMatchObject({ sql: GOALS.sql });
    expect(paged().request).toEqual({
      sort: [{ column: 'goals', direction: 'asc' }],
      page: 1,
    });
  });

  it('lists the earlier queries when the SQL matches none', async () => {
    const { requestContext } = turnContext();
    const result = await execute(
      { query: 'SELECT 1', rationale: 'x' },
      { requestContext },
    );
    expect(result).toEqual({
      error:
        'Unknown query. Earlier queries: Q1 SELECT country, goals FROM wc.public.scorers ORDER BY goals DESC; Q2 SELECT year, attendance FROM wc.public.matches',
    });
    expect(pageQuery).not.toHaveBeenCalled();
  });

  it("keeps an explored query's view: a page alone moves within its filters", async () => {
    const view = {
      filters: [{ column: 'country', op: 'eq' as const, value: 'Brazil' }],
      sort: [],
      page: 1,
      pageSize: 10,
      matchedRows: 30,
    };
    const { requestContext } = turnContext([{ ...GOALS, view }]);
    await execute({ page: 2, rationale: 'More.' }, { requestContext });
    expect(paged().request).toEqual({
      filters: view.filters,
      sort: [],
      page: 2,
      pageSize: 10,
    });
  });

  it('reads filterText with result-explorer over every earlier query; explicit fields override it', async () => {
    interpretResult.mockResolvedValue({
      action: 'explore',
      query: 0,
      interpretation: {
        request: {
          filters: [{ column: 'country', op: 'eq', value: 'Brazil' }],
          sort: [{ column: 'goals', direction: 'desc' }],
          page: 1,
        },
        understood: 'Country is Brazil',
      },
    });
    const { requestContext } = turnContext();
    const result = await execute(
      { filterText: 'only Brazil', page: 3, rationale: 'Only Brazil.' },
      { requestContext },
    );
    const input = interpreted();
    expect(input.text).toBe('only Brazil');
    expect(input.candidates.map((c) => c.ref)).toEqual(['Q1', 'Q2']);
    expect(input.candidates[0].columns[0]).toEqual({
      name: 'country',
      kind: 'text',
      values: ['Brazil', 'France'],
    });
    // The model picked Q1; the explicit page wins over its page 1.
    expect(paged().source).toMatchObject({ sql: GOALS.sql });
    expect(paged().request).toEqual({
      filters: [{ column: 'country', op: 'eq', value: 'Brazil' }],
      sort: [{ column: 'goals', direction: 'desc' }],
      page: 3,
    });
    expect(result.understood).toBe('Country is Brazil');
  });

  it('pages the query the user names as a source, and reads the words over that one alone', async () => {
    interpretResult.mockResolvedValue({
      action: 'explore',
      query: 0,
      interpretation: { request: { page: 2 }, understood: 'Page 2' },
    });
    const { requestContext } = turnContext([
      { ...GOALS, source: 1 },
      { ...MATCHES, source: 3 },
    ]);
    // Without the source the latest query would be paged: here it is the
    // one the reader saw as Source 1.
    await execute(
      { filterText: 'next page of source 1', rationale: 'Next page.' },
      { requestContext },
    );
    expect(interpreted().candidates.map((c) => c.ref)).toEqual([GOALS.ref]);
    expect(paged().source).toMatchObject({ sql: GOALS.sql });
    const named = await execute(
      { query: 'Source 3', rationale: 'Source 3.' },
      { requestContext },
    );
    expect(named).not.toHaveProperty('error');
    expect(paged().source).toMatchObject({ sql: MATCHES.sql });
  });

  it('refuses words that ask a new question', async () => {
    interpretResult.mockResolvedValue({
      action: 'new-question',
      query: 0,
      interpretation: { request: {}, understood: '' },
    });
    const { requestContext } = turnContext();
    const result = await execute(
      { filterText: 'average goals per year', rationale: 'x' },
      { requestContext },
    );
    expect(result).toEqual({
      error:
        'That asks a new question, not a filter on an earlier result; query the data instead.',
    });
    expect(pageQuery).not.toHaveBeenCalled();
  });

  it("answers the page engine's refusal as an error the model reads", async () => {
    pageQuery.mockRejectedValue(new Error('Unknown column "nope"'));
    const { requestContext } = turnContext();
    const result = await execute(
      { sort: [{ column: 'nope', direction: 'asc' }], rationale: 'x' },
      { requestContext },
    );
    expect(result).toEqual({ error: 'Unknown column "nope"' });
  });

  it('writes its facts (datasource, matched rows, page size, view) beside the result', async () => {
    const { requestContext, facts } = turnContext();
    await execute(
      { page: 2, pageSize: 1, rationale: 'x' },
      { requestContext, agent: { toolCallId: 'call-1' } },
    );
    const expected: QueryFacts = {
      datasourceId: 'ds-1',
      totalRows: 4,
      rowLimit: 1,
      view: pageOf().view,
    };
    expect(facts.get('call-1')).toEqual(expected);
    expect(facts.get(queryFactsKey('explore_result', MATCHES.sql))).toEqual(
      expected,
    );
  });

  it('hides sourceSql, datasourceId and view from the model', async () => {
    const { requestContext } = turnContext();
    const result = await execute({ rationale: 'x' }, { requestContext });
    const hook = (
      exploreResultTool as unknown as { toModelOutput?: ToModelOutput }
    ).toModelOutput;
    expect(hook).toBeDefined();
    const seen = hook!(result);
    expect(seen.type).toBe('json');
    expect(seen.value).not.toHaveProperty('sourceSql');
    expect(seen.value).not.toHaveProperty('datasourceId');
    expect(seen.value).not.toHaveProperty('view');
    expect(seen.value).toMatchObject({
      columns: ['country', 'goals'],
      rows: [{ country: 'Brazil', goals: 8 }],
      page: 2,
      pageCount: 4,
      matchedRows: 4,
      capped: false,
    });
    expect(hook!({ error: 'boom' }).value).toEqual({ error: 'boom' });
  });
});
