import { ChatMessage } from '../../features/sessions/models/session.model';
import { QueryEvidence } from './query-evidence.model';
import { coverageLine, queryRows } from './query-labels';

function message(
  evidence: QueryEvidence[] | undefined,
  data: ChatMessage['data'] = [
    { tool: 'run_readonly_sql', rationale: 'Dates the returns cover', rowCount: 1 },
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
      ['Q1', 'Dates the returns cover', 'Whole table'],
      ['Q2', 'Query 2', 'Top 100 after ranking'],
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
      queryRows(message([{ index: 1, coverage: 'top-n', outerLimit: 100, explanation: explanation(status) }]))[1]
        .chipLabel;
    expect(at('verified')).toBe('Top 100 of 1,870');
    expect(at('unverified')).toBe('Top 100 after ranking');
  });

  it('marks a failed record Failed and has no line for it alone', () => {
    const msg = message([{ index: 0 }], [{ tool: 'run_readonly_sql', error: 'boom' }]);
    expect(queryRows(msg)[0].chipLabel).toBe('Failed');
    expect(coverageLine(msg)).toBeNull();
  });

  it('writes the whole-tables sentence, leaving out unknown sizes', () => {
    const one = coverageLine(
      message([
        { index: 0, coverage: 'whole-table', tables: [{ entity: 'db.sales.returns', rows: 48912 }] },
        { index: 1, coverage: 'top-n', tables: [{ entity: 'db.sales.returns', rows: 48912 }] },
      ]),
    );
    expect(one?.text).toBe('The whole returns table was read (48,912 rows).');
    expect(one?.linkLabel).toBe('Inspect the 2 queries');
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
    expect(two?.text).toBe('The whole returns (48,912 rows) and products tables were read.');
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
      'Q1 is a sample of rows, not a ranking: no figure should come from it. ' +
        'Q2 was cut at 500 rows, so figures from it may be incomplete.',
    );
  });

  it('shows rows with no coverage chip and no line when evidence is missing', () => {
    const msg = message(undefined);
    expect(queryRows(msg).every((r) => r.chipLabel === undefined)).toBeTrue();
    expect(queryRows(msg).length).toBe(2);
    expect(coverageLine(msg)).toBeNull();
  });
});
