import {
  EXPORT_ROWS,
  coverageOf,
  outerLimitOf,
  withExportLimit,
} from './query-coverage';

const RANKED =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product ORDER BY n DESC LIMIT 100';
const UNRANKED =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product LIMIT 100';

describe('coverageOf (plan 2.1)', () => {
  it('reads ORDER BY … LIMIT 100 with 100 rows as top-n, outer limit 100', () => {
    expect(outerLimitOf(RANKED)).toBe(100);
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql: RANKED,
        rowCount: 100,
        totalRows: 100,
        rowLimit: 100,
      }),
    ).toBe('top-n');
  });

  it('reads the same LIMIT without ORDER BY as a sample', () => {
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql: UNRANKED,
        rowCount: 100,
        totalRows: 100,
        rowLimit: 100,
      }),
    ).toBe('sample');
  });

  it('reads a LIMIT only inside a CTE, cut at 500 of 1,870 rows, as partial', () => {
    const sql =
      'WITH recent AS (SELECT * FROM shop.public.returns ORDER BY at DESC LIMIT 5000) SELECT product, at FROM recent';
    expect(outerLimitOf(sql)).toBeUndefined();
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql,
        rowCount: 500,
        totalRows: 1870,
        rowLimit: 500,
      }),
    ).toBe('partial');
  });

  it('reads LIMIT 100 returning 37 rows as the whole table', () => {
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql: RANKED,
        rowCount: 37,
        totalRows: 37,
        rowLimit: 100,
      }),
    ).toBe('whole-table');
  });

  it("ignores a 'LIMIT 5' inside a literal", () => {
    const sql =
      "SELECT note FROM shop.public.returns WHERE note = 'LIMIT 5' ORDER BY note";
    expect(outerLimitOf(sql)).toBeUndefined();
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql,
        rowCount: 5,
        totalRows: 5,
        rowLimit: 100,
      }),
    ).toBe('whole-table');
  });

  it('reads sample_rows as a sample', () => {
    expect(
      coverageOf({
        tool: 'sample_rows',
        sql: 'shop.public.returns',
        rowCount: 3,
        totalRows: 3,
        rowLimit: 10,
      }),
    ).toBe('sample');
  });

  it('falls back to the cap for a record stored without totalRows', () => {
    // The tool's cap of 500 was reached: probably cut.
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql: 'SELECT * FROM shop.public.returns',
        rowCount: 500,
        rowLimit: 500,
      }),
    ).toBe('partial');
    // The bridge's `truncated` flag: the rows filled the tool's limit.
    expect(
      coverageOf({
        tool: 'run_readonly_sql',
        sql: 'SELECT * FROM shop.public.returns ORDER BY a LIMIT 1000',
        rowCount: 100,
        truncated: true,
      }),
    ).toBe('partial');
    // The query's own LIMIT was reached: that is the ranking, not a cut.
    expect(
      coverageOf({ tool: 'run_readonly_sql', sql: RANKED, rowCount: 100 }),
    ).toBe('top-n');
  });
});

describe('outerLimitOf', () => {
  it('reads FETCH FIRST n ROWS ONLY and ignores a LIMIT in a subquery', () => {
    expect(
      outerLimitOf(
        'SELECT * FROM (SELECT * FROM t LIMIT 3) x ORDER BY a FETCH FIRST 20 ROWS ONLY',
      ),
    ).toBe(20);
    expect(outerLimitOf('SELECT * FROM (SELECT * FROM t LIMIT 3) x')).toBe(
      undefined,
    );
  });

  it("reads SQLite's LIMIT offset, count as the count", () => {
    expect(outerLimitOf('SELECT * FROM t ORDER BY a LIMIT 10, 25')).toBe(25);
  });
});

describe('withExportLimit (api.md 143)', () => {
  it('raises the top-level LIMIT to the export cap plus one', () => {
    expect(withExportLimit(`${RANKED};`)).toBe(
      RANKED.replace('LIMIT 100', `LIMIT ${EXPORT_ROWS + 1}`),
    );
  });

  it('appends a LIMIT when there is none, dropping a trailing comment and semicolon', () => {
    expect(withExportLimit('SELECT * FROM t; -- all of it\n')).toBe(
      `SELECT * FROM t\nLIMIT ${EXPORT_ROWS + 1}`,
    );
  });

  it('raises FETCH FIRST n and leaves an inner LIMIT alone', () => {
    expect(
      withExportLimit(
        'SELECT * FROM (SELECT * FROM t LIMIT 3) x FETCH FIRST 20 ROWS ONLY',
      ),
    ).toBe(
      `SELECT * FROM (SELECT * FROM t LIMIT 3) x FETCH FIRST ${EXPORT_ROWS + 1} ROWS ONLY`,
    );
  });
});
