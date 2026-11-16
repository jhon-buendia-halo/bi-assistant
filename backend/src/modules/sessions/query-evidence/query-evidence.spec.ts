import type { ToolDataRecord } from '../entities/session.entity';
import { csvOf, evidenceOf } from './query-evidence';

const ranked: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: 'SELECT product, n FROM shop.public.returns ORDER BY n DESC LIMIT 100',
  columns: ['product', 'n'],
  rows: [{ product: 'a', n: 1 }],
  rowCount: 100,
};
const failed: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: 'SELECT nope',
  error: 'column "nope" does not exist',
};
const sample: ToolDataRecord = {
  tool: 'sample_rows',
  input: 'shop.public.returns',
  columns: ['id'],
  rows: [{ id: 1 }],
  rowCount: 1,
};
const other: ToolDataRecord = {
  tool: 'lookup_client',
  input: 'acme',
  columns: ['x'],
  rows: [],
  rowCount: 0,
};

describe('evidenceOf (plan 2.1)', () => {
  it('gives one entry per query record, failed ones included, in data order', () => {
    const facts = new Map([
      [ranked, { datasourceId: 'ds-1', totalRows: 100, rowLimit: 100 }],
      [failed, { datasourceId: 'ds-1', rowLimit: 100 }],
    ]);
    expect(
      evidenceOf([ranked, other, failed, sample], (record) =>
        facts.get(record),
      ),
    ).toEqual([
      {
        index: 0,
        coverage: 'top-n',
        outerLimit: 100,
        datasourceId: 'ds-1',
        totalRows: 100,
        rowLimit: 100,
      },
      { index: 2, datasourceId: 'ds-1', rowLimit: 100 },
      { index: 3, coverage: 'sample' },
    ]);
  });

  it('builds the evidence of an answer stored before the facts existed', () => {
    expect(evidenceOf([ranked])).toEqual([
      { index: 0, coverage: 'top-n', outerLimit: 100 },
    ]);
    expect(evidenceOf([other])).toEqual([]);
  });
});

describe('evidenceOf: an explore_result record (agents.md 3.15)', () => {
  const view = {
    filters: [{ column: 'country', op: 'eq' as const, value: 'Brazil' }],
    sort: [],
    page: 2,
    pageSize: 2,
    matchedRows: 5,
    capped: false,
  };
  const explored: ToolDataRecord = {
    tool: 'explore_result',
    input: 'SELECT country, goals FROM wc.public.scorers',
    columns: ['country', 'goals'],
    rows: [
      { country: 'Brazil', goals: 3 },
      { country: 'Brazil', goals: 2 },
    ],
    rowCount: 2,
    truncated: true,
  };

  it('carries its view, and is partial when more rows matched than the page holds', () => {
    expect(
      evidenceOf([explored], () => ({
        datasourceId: 'ds-1',
        totalRows: 5,
        rowLimit: 2,
        view,
      })),
    ).toEqual([
      {
        index: 0,
        coverage: 'partial',
        datasourceId: 'ds-1',
        totalRows: 5,
        rowLimit: 2,
        view,
      },
    ]);
  });

  it('is partial from its view alone, for a record with no total', () => {
    const [entry] = evidenceOf([explored], () => ({ view }));
    expect(entry.coverage).toBe('partial');
    expect(entry.view).toEqual(view);
  });

  it('never puts a view on another query', () => {
    const [entry] = evidenceOf([ranked], () => ({ view }));
    expect(entry).not.toHaveProperty('view');
  });
});

describe('csvOf (api.md 143)', () => {
  it('writes a header row and quotes per RFC 4180', () => {
    expect(
      csvOf(
        ['name', 'note', 'n'],
        [
          { name: 'a,b', note: 'say "hi"', n: 1 },
          { name: 'line\nbreak', note: null, n: 2.5 },
          { name: 'x', note: { k: 1 }, n: BigInt(3) },
        ],
      ),
    ).toBe(
      [
        'name,note,n',
        '"a,b","say ""hi""",1',
        '"line\nbreak",,2.5',
        'x,"{""k"":1}",3',
        '',
      ].join('\r\n'),
    );
  });
});
