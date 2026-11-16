import type { ChatMessage, ToolDataRecord } from '../entities/session.entity';
import {
  CONTEXT_QUERIES_MAX,
  explorableQueriesOf,
  findExplorableQuery,
  sessionExplorableQueries,
  sqlKey,
  type ExplorableQuery,
} from './explorable-queries';

const sql: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: 'SELECT country, goals FROM wc.public.scorers;',
  columns: ['country', 'goals'],
  rows: [
    { country: 'Brazil', goals: 8 },
    { country: 'Brazil', goals: 5 },
    { country: 'France', goals: '6' },
  ],
  rowCount: 3,
  rationale: 'Top scorers.',
};
const failed: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: 'SELECT nope',
  error: 'boom',
};
const sample: ToolDataRecord = {
  tool: 'sample_rows',
  input: 'wc.public.scorers',
  columns: ['country'],
  rows: [{ country: 'Chile' }],
};
const explored: ToolDataRecord = {
  tool: 'explore_result',
  input: 'SELECT year FROM wc.public.matches',
  columns: ['year'],
  rows: [{ year: 2018 }],
};
const view = { filters: [], sort: [], page: 2, pageSize: 1, matchedRows: 9 };

describe('explorableQueriesOf (plan 2; agents.md 3.15)', () => {
  it('keeps successful SQL and explore records, with kinds, a few values, the datasource and the view', () => {
    const queries = explorableQueriesOf(
      [sql, failed, sample, explored],
      [
        { index: 0, datasourceId: 'ds-1' },
        { index: 1 },
        { index: 2 },
        { index: 3, datasourceId: 'ds-2', view },
      ],
    );
    expect(queries).toEqual([
      {
        ref: 'Q1',
        sql: 'SELECT country, goals FROM wc.public.scorers;',
        datasourceId: 'ds-1',
        columns: ['country', 'goals'],
        kinds: { country: 'text', goals: 'number' },
        sampleValues: { country: ['Brazil', 'France'], goals: [8, 5, '6'] },
        rationale: 'Top scorers.',
      },
      {
        ref: 'Q2',
        sql: 'SELECT year FROM wc.public.matches',
        datasourceId: 'ds-2',
        columns: ['year'],
        kinds: { year: 'number' },
        sampleValues: { year: [2018] },
        view,
      },
    ]);
    // No whole rows travel with a query.
    expect(queries[0]).not.toHaveProperty('rows');
  });
});

describe('findExplorableQuery', () => {
  const queries = explorableQueriesOf([sql, explored]);

  it('matches on whitespace-collapsed SQL without a trailing semicolon', () => {
    expect(
      findExplorableQuery(
        queries,
        'SELECT   country, goals\n FROM wc.public.scorers',
      )?.ref,
    ).toBe('Q1');
    expect(sqlKey(' SELECT 1 ;  ')).toBe('SELECT 1');
  });

  it('takes a ref too, and the latest of two identical statements', () => {
    expect(findExplorableQuery(queries, 'q2')?.ref).toBe('Q2');
    const twice = explorableQueriesOf([sql, explored, sql]);
    expect(findExplorableQuery(twice, sql.input!)?.ref).toBe('Q3');
    expect(findExplorableQuery(queries, 'SELECT 2')).toBeUndefined();
  });
});

describe('sessionExplorableQueries', () => {
  const context: ExplorableQuery = {
    ref: 'Q1',
    sql: 'SELECT 1',
    columns: [],
    kinds: {},
    sampleValues: {},
  };

  it("puts a host's context queries before the session's earlier answers, numbered again", () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Who scored?', at: 't1' },
      {
        role: 'assistant',
        content: 'Brazil.',
        at: 't2',
        data: [sql],
        evidence: [{ index: 0, datasourceId: 'ds-1' }],
      },
    ];
    const queries = sessionExplorableQueries([context], messages);
    expect(queries.map((q) => [q.ref, q.sql])).toEqual([
      ['Q1', 'SELECT 1'],
      ['Q2', sql.input],
    ]);
    expect(queries[1].datasourceId).toBe('ds-1');
  });

  it(`keeps the latest ${CONTEXT_QUERIES_MAX}`, () => {
    const many = Array.from({ length: CONTEXT_QUERIES_MAX + 3 }, (_, i) => ({
      ...context,
      sql: `SELECT ${i}`,
    }));
    const queries = sessionExplorableQueries(many, []);
    expect(queries).toHaveLength(CONTEXT_QUERIES_MAX);
    expect(queries[0]).toMatchObject({ ref: 'Q1', sql: 'SELECT 3' });
  });
});
