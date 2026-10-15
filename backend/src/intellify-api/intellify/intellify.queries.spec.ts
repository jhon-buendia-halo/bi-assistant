import {
  carriersQuery,
  clientByCodeQuery,
  clientsQuery,
  financialsQuery,
  planDesignsQuery,
  qi,
  scope,
} from './intellify.queries';

const HOSTILE = `x'; DROP TABLE clients; --`;

describe('intellify queries', () => {
  it('quotes the schema identifier', () => {
    expect(qi('intellify')).toBe('"intellify"');
    expect(qi('a"b')).toBe('"a""b"');
  });

  it('never interpolates a request value: filters are bound parameters', () => {
    const sc = scope('intellify');
    const queries = [
      clientsQuery(sc, { q: HOSTILE }, 10, 0),
      carriersQuery(sc, { line: HOSTILE, clientOneCode: HOSTILE }, 10, 0),
      planDesignsQuery(sc, { clientOneCode: HOSTILE, line: HOSTILE }, 10, 0),
      financialsQuery(
        sc,
        { clientOneCode: HOSTILE, line: HOSTILE, planYear: 2026 },
        10,
        0,
      ),
    ];
    for (const { count, page } of queries) {
      expect(count.text).not.toContain('DROP TABLE');
      expect(page.text).not.toContain('DROP TABLE');
      expect(page.values).toContain(HOSTILE);
    }
    expect(clientByCodeQuery(sc, HOSTILE).text).not.toContain('DROP');
  });

  it('binds exactly the parameters each statement references', () => {
    const sc = scope('intellify');
    const used = (text: string) => new Set(text.match(/\$\d+/g) ?? []).size;
    const { count, page } = carriersQuery(
      sc,
      { line: 'Medical', clientOneCode: 'IC1' },
      25,
      50,
    );
    expect(count.values).toEqual(['Medical']);
    expect(used(count.text)).toBe(count.values.length);
    expect(used(page.text)).toBe(page.values.length);
    expect(page.values.slice(-2)).toEqual([25, 50]);
  });

  it('leaves soft-deleted rows out unless includeDeleted', () => {
    expect(clientsQuery(scope('intellify'), {}, 1, 0).page.text).toContain(
      'NOT c.deleted',
    );
    expect(
      clientsQuery(scope('intellify', true), {}, 1, 0).page.text,
    ).not.toContain('NOT c.deleted');
  });
});
