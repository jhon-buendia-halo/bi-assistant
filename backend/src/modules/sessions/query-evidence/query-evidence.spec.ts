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
