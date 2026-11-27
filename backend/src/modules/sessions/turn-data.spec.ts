import { carriedQueryRecords, toolDataRecord } from './turn-data';

describe('toolDataRecord: an explore_result result (agents.md 3.15)', () => {
  const SOURCE = 'SELECT country, goals FROM wc.public.scorers';
  const view = {
    filters: [{ column: 'country', op: 'eq' as const, value: 'Brazil' }],
    sort: [],
    page: 2,
    pageSize: 2,
    matchedRows: 5,
    capped: false,
  };

  it('stores the page against the source SQL, so the inspector, re-run and CSV act on it', () => {
    const record = toolDataRecord(
      'explore_result',
      { filterText: 'only Brazil', page: 2, rationale: '  Only   Brazil. ' },
      {
        sourceSql: SOURCE,
        datasourceId: 'ds-1',
        view,
        columns: ['country', 'goals'],
        rows: [
          { country: 'Brazil', goals: 3 },
          { country: 'Brazil', goals: 2 },
        ],
        page: 2,
        pageCount: 3,
        matchedRows: 5,
        capped: false,
        understood: 'Country is Brazil',
      },
    );
    expect(record).toEqual({
      tool: 'explore_result',
      input: SOURCE,
      columns: ['country', 'goals'],
      rows: [
        { country: 'Brazil', goals: 3 },
        { country: 'Brazil', goals: 2 },
      ],
      rowCount: 2,
      // More pages exist.
      truncated: true,
      rationale: 'Only Brazil.',
    });
    // The view is evidence, never a record field fed to models.
    expect(record).not.toHaveProperty('view');
  });

  it('is not truncated on the last page', () => {
    const record = toolDataRecord(
      'explore_result',
      { rationale: 'x' },
      {
        sourceSql: SOURCE,
        columns: ['country'],
        rows: [{ country: 'Chile' }],
        page: 3,
        pageCount: 3,
        matchedRows: 5,
        capped: false,
      },
    );
    expect(record).not.toHaveProperty('truncated');
  });

  it('keeps a refusal with its source SQL when one was named', () => {
    expect(
      toolDataRecord(
        'explore_result',
        { query: SOURCE, rationale: 'x' },
        { error: 'Unknown column "nope"' },
      ),
    ).toEqual({
      tool: 'explore_result',
      input: SOURCE,
      error: 'Unknown column "nope"',
      rationale: 'x',
    });
  });
});

describe('carriedQueryRecords: the SQL a tool ran itself (agent-change step 4)', () => {
  const SQL = 'SELECT COUNT(*) AS rows FROM shop.public.orders';

  it('makes one run_readonly_sql record per carried query, so the inspector shows each', () => {
    const records = carriedQueryRecords({
      verdict: 'not-ready',
      queryRecords: [
        {
          sql: SQL,
          columns: ['rows'],
          rows: [{ rows: 1200 }],
          rationale: '  How many   orders there are. ',
        },
        {
          sql: 'SELECT COUNT(*) - COUNT(email) AS nulls FROM shop.public.customers',
          rows: [{ nulls: 3 }],
        },
      ],
    });
    expect(records).toEqual([
      {
        tool: 'run_readonly_sql',
        input: SQL,
        columns: ['rows'],
        rows: [{ rows: 1200 }],
        rowCount: 1,
        rationale: 'How many orders there are.',
      },
      {
        tool: 'run_readonly_sql',
        input:
          'SELECT COUNT(*) - COUNT(email) AS nulls FROM shop.public.customers',
        columns: ['nulls'],
        rows: [{ nulls: 3 }],
        rowCount: 1,
      },
    ]);
  });

  it('carries the truncation a query reports', () => {
    const [record] = carriedQueryRecords({
      queryRecords: [
        { sql: SQL, columns: ['rows'], rows: [{ rows: 1 }], truncated: true },
      ],
    });
    expect(record.truncated).toBe(true);
  });

  it('carries nothing for a result without queries, an error or a malformed entry', () => {
    expect(carriedQueryRecords({ columns: [], rows: [] })).toEqual([]);
    expect(carriedQueryRecords({ error: 'boom' })).toEqual([]);
    expect(carriedQueryRecords(undefined)).toEqual([]);
    expect(
      carriedQueryRecords({
        queryRecords: [{ sql: '  ' }, { rows: [] }, 'SELECT 1', null],
      }),
    ).toEqual([]);
  });

  it('never makes a record of the carrying tool itself', () => {
    expect(
      toolDataRecord(
        'assess_readiness',
        { rationale: 'x' },
        { verdict: 'ready', queryRecords: [{ sql: SQL, rows: [] }] },
      ),
    ).toBeNull();
  });
});
