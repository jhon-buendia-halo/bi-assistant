import { ChatMessage } from '../../features/sessions/models/session.model';
import { QueryEvidence } from './query-evidence.model';
import {
  coverageLine,
  queryRows,
  sourceInfos,
  sourceLabel,
} from './query-labels';

function message(
  evidence: QueryEvidence[] | undefined,
  data: ChatMessage['data'] = [
    {
      tool: 'run_readonly_sql',
      rationale: 'Dates the returns cover',
      rowCount: 1,
    },
    { tool: 'run_readonly_sql', rowCount: 100 },
  ],
): ChatMessage {
  return { role: 'assistant', content: 'x', at: '', data, evidence };
}

describe('query-labels', () => {
  it('labels each coverage and falls back to "Query <n>"', () => {
    const rows = queryRows(
      message([
        { index: 0, coverage: 'whole-table' },
        { index: 1, coverage: 'top-n', outerLimit: 100 },
      ]),
    );
    expect(rows.map((r) => [r.label, r.title, r.chipLabel])).toEqual([
      ['Source 1', 'Dates the returns cover', 'Whole table'],
      ['Source 2', 'Query 2', 'Top 100 after ranking'],
    ]);
  });

  it('reads Top 100 of 1,870 only once the counts are verified', () => {
    const explanation = (status: 'verified' | 'unverified') => ({
      at: '',
      steps: [
        { verb: 'start' as const, text: '', rows: 48912 },
        { verb: 'count' as const, text: '', rows: 1870 },
        { verb: 'show' as const, text: '', rows: 100 },
      ],
      stageCounts: { status, at: '' },
    });
    const at = (status: 'verified' | 'unverified') =>
      queryRows(
        message([
          {
            index: 1,
            coverage: 'top-n',
            outerLimit: 100,
            explanation: explanation(status),
          },
        ]),
      )[1].chipLabel;
    expect(at('verified')).toBe('Top 100 of 1,870');
    expect(at('unverified')).toBe('Top 100 after ranking');
  });

  it('marks a failed record Failed and has no line for it alone', () => {
    const msg = message(
      [{ index: 0 }],
      [{ tool: 'run_readonly_sql', error: 'boom' }],
    );
    expect(queryRows(msg)[0].chipLabel).toBe('Failed');
    expect(coverageLine(msg)).toBeNull();
  });

  it('writes the whole-tables sentence, leaving out unknown sizes', () => {
    const one = coverageLine(
      message([
        {
          index: 0,
          coverage: 'whole-table',
          tables: [{ entity: 'db.sales.returns', rows: 48912 }],
        },
        {
          index: 1,
          coverage: 'top-n',
          tables: [{ entity: 'db.sales.returns', rows: 48912 }],
        },
      ]),
    );
    expect(one?.text).toBe('The whole returns table was read (48,912 rows).');
    expect(one?.linkLabel).toBe('Inspect the 2 sources');
    const two = coverageLine(
      message([
        {
          index: 0,
          coverage: 'whole-table',
          tables: [
            { entity: 'db.sales.returns', rows: 48912 },
            { entity: 'db.sales.products', rows: null },
          ],
        },
        { index: 1, coverage: 'whole-table' },
      ]),
    );
    expect(two?.text).toBe(
      'The whole returns (48,912 rows) and products tables were read.',
    );
  });

  it('warns about a cut query and a sample', () => {
    const line = coverageLine(
      message([
        { index: 0, coverage: 'sample' },
        { index: 1, coverage: 'partial', rowLimit: 500 },
      ]),
    );
    expect(line?.tone).toBe('warning');
    expect(line?.text).toBe(
      'Source 1 is a sample of rows, not a ranking: no figure should come from it. ' +
        'Source 2 was cut at 500 rows, so figures from it may be incomplete.',
    );
  });

  it('names a page of an earlier result as a view, not a cut (R83)', () => {
    const line = coverageLine(
      message(
        [
          {
            index: 0,
            coverage: 'partial',
            rowLimit: 50,
            view: {
              filters: [],
              sort: [],
              page: 2,
              pageSize: 50,
              matchedRows: 400,
            },
          },
        ],
        [{ tool: 'explore_result', rowCount: 50, truncated: true }],
      ),
    );
    expect(line?.tone).toBe('success');
    expect(line?.text).toBe('Source 1 shows page 2 of 8 of an earlier result.');
  });

  it('shows rows with no coverage chip and no line when evidence is missing', () => {
    const msg = message(undefined);
    expect(queryRows(msg).every((r) => r.chipLabel === undefined)).toBeTrue();
    expect(queryRows(msg).length).toBe(2);
    expect(coverageLine(msg)).toBeNull();
  });

  it('builds the number in one place and words the link for one or many sources', () => {
    expect(sourceLabel(0)).toBe('Source 1');
    expect(queryRows(message(undefined)).map((r) => r.number)).toEqual([
      '1',
      '2',
    ]);
    const one = coverageLine(
      message(
        [{ index: 0, coverage: 'whole-table' }],
        [{ tool: 'run_readonly_sql', rowCount: 3 }],
      ),
    );
    expect(one?.linkLabel).toBe('Inspect the source');
  });

  it('describes each source for the card: purpose, rows with + when cut, coverage', () => {
    const infos = sourceInfos({
      data: [
        {
          tool: 'run_readonly_sql',
          rationale: 'Returns per product',
          rowCount: 1204,
        },
        { tool: 'run_readonly_sql', rowCount: 500, truncated: true },
      ],
      evidence: [{ index: 0, coverage: 'whole-table' }],
    });
    expect(infos.map((i) => [i.label, i.purpose, i.rows, i.coverage])).toEqual([
      ['Source 1', 'Returns per product', '1,204 rows', 'Whole table'],
      ['Source 2', 'Query 2', '500+ rows', null],
    ]);
  });
});
