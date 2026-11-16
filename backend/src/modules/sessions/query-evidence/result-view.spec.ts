import {
  columnKindsOf,
  pageResultOf,
  parsePageRequest,
  preparePage,
  type PageSource,
} from './result-view';

const SQL =
  'SELECT country, goals, won, played_on FROM matches ORDER BY goals DESC LIMIT 100';

const SOURCE: PageSource = {
  sql: SQL,
  columns: ['country', 'goals', 'won', 'played_on'],
  rows: [
    { country: 'Brazil', goals: 3, won: true, played_on: '2018-06-17' },
    { country: 'Spain', goals: '12', won: false, played_on: null },
    {
      country: 'Chile',
      goals: null,
      won: true,
      played_on: '2018-06-18T15:00:00Z',
    },
  ],
};

/** The 400 message a call throws. */
function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a 400');
}

describe('result-view: kinds inferred from the stored rows', () => {
  it('reads number, boolean, date, text and unknown per column', () => {
    expect(
      columnKindsOf(
        ['n', 'flag', 'day', 'name', 'empty', 'json', 'zip', 'mixed'],
        [
          {
            n: 1,
            flag: true,
            day: '2024-01-02',
            name: 'a',
            empty: null,
            json: { a: 1 },
            zip: '02134',
            mixed: 1,
          },
          {
            n: '2.5',
            flag: false,
            day: '2024-01-02T10:00:00.000Z',
            name: 'b',
            json: null,
            zip: '10001',
            mixed: 'x',
          },
        ],
      ),
    ).toEqual({
      n: 'number',
      flag: 'boolean',
      day: 'date',
      name: 'text',
      empty: 'unknown',
      json: 'unknown',
      // A leading zero keeps a code a code.
      zip: 'text',
      mixed: 'text',
    });
  });
});

describe('result-view: parsePageRequest (the body of api.md 152, 154)', () => {
  it('takes an empty body as the first page in the default order', () => {
    expect(parsePageRequest(undefined)).toEqual({});
    expect(parsePageRequest({})).toEqual({});
  });

  it('refuses a body of the wrong shape', () => {
    expect(errorOf(() => parsePageRequest([]))).toBe(
      'The body must be a JSON object',
    );
    expect(errorOf(() => parsePageRequest({ filters: 'x' }))).toBe(
      'filters must be a list',
    );
    expect(errorOf(() => parsePageRequest({ sort: {} }))).toBe(
      'sort must be a list',
    );
    expect(
      errorOf(() =>
        parsePageRequest({ filters: [{ column: 'a', op: 'like' }] }),
      ),
    ).toBe('Filter on a: unknown operator "like"');
    expect(
      errorOf(() =>
        parsePageRequest({ sort: [{ column: 'a', direction: 'up' }] }),
      ),
    ).toBe('Sort on a: the direction is asc or desc');
    expect(errorOf(() => parsePageRequest({ filters: [{ op: 'eq' }] }))).toBe(
      'Each filter names a column',
    );
  });
});

describe('result-view: preparePage validates against the stored record', () => {
  it('defaults to page 1 of 50 rows in the default order, on the stored SQL and columns', () => {
    const { statement, view } = preparePage(SOURCE, {});

    expect(statement).toEqual({
      sql: SQL,
      columns: SOURCE.columns,
      filters: [],
      sort: [],
      limit: 50,
      offset: 0,
      kinds: {
        country: 'text',
        goals: 'number',
        won: 'boolean',
        played_on: 'date',
      },
    });
    expect(view).toEqual({ filters: [], sort: [], page: 1, pageSize: 50 });
  });

  it('turns page and page size into limit and offset', () => {
    const { statement } = preparePage(SOURCE, { page: 3, pageSize: 20 });
    expect(statement).toMatchObject({ limit: 20, offset: 40 });
  });

  it('refuses a page or page size out of range', () => {
    expect(errorOf(() => preparePage(SOURCE, { page: 0 }))).toBe(
      'Page must be a whole number of at least 1',
    );
    expect(errorOf(() => preparePage(SOURCE, { page: 1.5 }))).toBe(
      'Page must be a whole number of at least 1',
    );
    expect(errorOf(() => preparePage(SOURCE, { pageSize: 101 }))).toBe(
      'Page size must be a whole number from 1 to 100',
    );
    expect(errorOf(() => preparePage(SOURCE, { pageSize: 0 }))).toBe(
      'Page size must be a whole number from 1 to 100',
    );
  });

  it('refuses a page past the 50,000-row limit, and keeps the last page inside it', () => {
    expect(errorOf(() => preparePage(SOURCE, { page: 1001 }))).toBe(
      'Page 1001 is past the 50,000-row limit',
    );
    expect(
      errorOf(() => preparePage(SOURCE, { page: 501, pageSize: 100 })),
    ).toBe('Page 501 is past the 50,000-row limit');
    expect(
      preparePage(SOURCE, { page: 1000, pageSize: 50 }).statement,
    ).toMatchObject({ offset: 49_950, limit: 50 });
    // The last page stops at row 50,000.
    expect(
      preparePage(SOURCE, { page: 538, pageSize: 93 }).statement,
    ).toMatchObject({ offset: 49_941, limit: 59 });
  });

  it('refuses more than 10 filters, 50 values or 3 sort keys', () => {
    const eq = { column: 'country', op: 'eq' as const, value: 'Brazil' };
    expect(
      errorOf(() =>
        preparePage(SOURCE, { filters: Array.from({ length: 11 }, () => eq) }),
      ),
    ).toBe('A view takes at most 10 filters');
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          filters: [
            {
              column: 'country',
              op: 'in',
              values: Array.from({ length: 51 }, (_, i) => `c${i}`),
            },
          ],
        }),
      ),
    ).toBe('Filter on country: in takes at most 50 values');
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          sort: ['country', 'goals', 'won', 'played_on'].map((column) => ({
            column,
            direction: 'asc' as const,
          })),
        }),
      ),
    ).toBe('A view sorts by at most 3 columns');
  });

  it('refuses an unknown column in a filter or a sort', () => {
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          filters: [{ column: 'Country', op: 'eq', value: 'Brazil' }],
        }),
      ),
    ).toBe('Unknown column "Country"');
    expect(
      errorOf(() =>
        preparePage(SOURCE, { sort: [{ column: 'nope', direction: 'asc' }] }),
      ),
    ).toBe('Unknown column "nope"');
  });

  it('refuses a column that appears more than once in the result', () => {
    const twice: PageSource = { ...SOURCE, columns: ['n', 'n', 'country'] };
    const message =
      'Column "n" appears more than once in the result; it cannot be filtered or sorted';
    expect(
      errorOf(() =>
        preparePage(twice, { filters: [{ column: 'n', op: 'gt', value: 1 }] }),
      ),
    ).toBe(message);
    expect(
      errorOf(() =>
        preparePage(twice, { sort: [{ column: 'n', direction: 'desc' }] }),
      ),
    ).toBe(message);
    // The other columns stay usable.
    expect(
      preparePage(twice, { sort: [{ column: 'country', direction: 'asc' }] })
        .statement.sort,
    ).toEqual([{ column: 'country', direction: 'asc' }]);
  });

  it('refuses an operator without its value', () => {
    for (const [filter, op] of [
      [{ column: 'goals', op: 'gt' }, 'gt'],
      [{ column: 'goals', op: 'eq', value: null }, 'eq'],
      [{ column: 'goals', op: 'between', value: 1 }, 'between'],
      [{ column: 'country', op: 'in', values: [] }, 'in'],
      [{ column: 'country', op: 'contains', value: '' }, 'contains'],
    ] as const) {
      expect(
        errorOf(() => preparePage(SOURCE, { filters: [filter as never] })),
      ).toBe(`Filter on ${filter.column}: ${op} needs a value`);
    }
  });

  it('takes the empty text as a value of a text column for is, is not and lists', () => {
    for (const filter of [
      { column: 'country', op: 'eq', value: '' },
      { column: 'country', op: 'neq', value: '' },
      { column: 'country', op: 'in', values: ['', 'Brazil'] },
    ] as const) {
      expect(
        preparePage(SOURCE, { filters: [filter as never] }).statement.filters,
      ).toEqual([filter]);
    }
    // A number column has no empty text.
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          filters: [{ column: 'goals', op: 'eq', value: '' }],
        }),
      ),
    ).toBe('Filter on goals: eq needs a value');
  });

  it('coerces each value by its column kind', () => {
    const { statement } = preparePage(SOURCE, {
      filters: [
        { column: 'goals', op: 'between', value: '1', valueTo: ' 4.5 ' },
        { column: 'won', op: 'eq', value: 'TRUE' },
        { column: 'country', op: 'in', values: ['Brazil', 7] },
        { column: 'played_on', op: 'gte', value: '2018-06-17' },
        { column: 'goals', op: 'contains', value: 1 },
        { column: 'country', op: 'is_null', value: 'ignored' },
      ],
    });

    expect(statement.filters).toEqual([
      { column: 'goals', op: 'between', value: 1, valueTo: 4.5 },
      { column: 'won', op: 'eq', value: true },
      { column: 'country', op: 'in', values: ['Brazil', '7'] },
      { column: 'played_on', op: 'gte', value: '2018-06-17' },
      // A text match reads the value as text, whatever the column.
      { column: 'goals', op: 'contains', value: '1' },
      { column: 'country', op: 'is_null' },
    ]);
  });

  it('refuses a value that does not coerce, before any query', () => {
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          filters: [{ column: 'goals', op: 'gt', value: 'many' }],
        }),
      ),
    ).toBe('Filter on goals: "many" is not a number');
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          filters: [{ column: 'won', op: 'eq', value: 'yes' }],
        }),
      ),
    ).toBe('Filter on won: "yes" is not true or false');
    expect(
      errorOf(() =>
        preparePage(SOURCE, {
          filters: [{ column: 'played_on', op: 'lt', value: 'June' }],
        }),
      ),
    ).toBe('Filter on played_on: "June" is not a date');
  });

  it('echoes the requested sort, empty for the default order', () => {
    const sort = [{ column: 'goals', direction: 'desc' as const }];
    expect(preparePage(SOURCE, { sort }).view.sort).toEqual(sort);
    expect(preparePage(SOURCE, { sort }).statement.sort).toEqual(sort);
    expect(preparePage(SOURCE, { sort: [] }).view.sort).toEqual([]);
  });

  it('falls back to the stored rows for the columns when none are recorded', () => {
    const { statement } = preparePage(
      { sql: SQL, rows: [{ a: 1, b: 'x' }] },
      {},
    );
    expect(statement.columns).toEqual(['a', 'b']);
  });
});

describe('result-view: pageResultOf', () => {
  const rows = [{ country: 'Brazil', goals: 3, won: true, played_on: null }];

  it('counts the pages of the matched rows', () => {
    const prepared = preparePage(SOURCE, { page: 2, pageSize: 20 });
    const result = pageResultOf(
      prepared,
      { columns: SOURCE.columns!, rows, matchedRows: 41 },
      '2026-11-15T10:00:00.000Z',
    );

    expect(result).toEqual({
      columns: SOURCE.columns,
      columnKinds: prepared.statement.kinds,
      rows,
      page: 2,
      pageSize: 20,
      pageCount: 3,
      matchedRows: 41,
      capped: false,
      view: {
        filters: [],
        sort: [],
        page: 2,
        pageSize: 20,
        matchedRows: 41,
        capped: false,
      },
      ranAt: '2026-11-15T10:00:00.000Z',
    });
  });

  it('caps the matched rows at 50,000 and says so', () => {
    const result = pageResultOf(preparePage(SOURCE, {}), {
      columns: SOURCE.columns!,
      rows,
      matchedRows: 120_000,
    });
    expect(result).toMatchObject({
      matchedRows: 50_000,
      capped: true,
      pageCount: 1000,
    });
    expect(typeof result.ranAt).toBe('string');
  });

  it('answers one empty page when nothing matches', () => {
    const result = pageResultOf(preparePage(SOURCE, {}), {
      columns: [],
      rows: [],
      matchedRows: 0,
    });
    expect(result).toMatchObject({
      columns: SOURCE.columns,
      rows: [],
      matchedRows: 0,
      capped: false,
      pageCount: 1,
    });
  });
});
