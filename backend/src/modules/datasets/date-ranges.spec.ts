import { dateColumns, dateRangeSql, rangesOf } from './date-ranges';

describe('date ranges at save time (data-model 3.3 `range`)', () => {
  it('reads only the date columns, at most twelve', () => {
    expect(
      dateColumns([
        { name: 'Date of Hire', type: 'DATE' },
        { name: 'Age', type: 'DOUBLE' },
        { name: 'updated_at', type: 'timestamp with time zone' },
      ]),
    ).toEqual(['Date of Hire', 'updated_at']);
    const many = Array.from({ length: 15 }, (_, i) => ({
      name: `d${i}`,
      type: 'date',
    }));
    expect(dateColumns(many)).toHaveLength(12);
  });

  it('writes one MIN/MAX statement in each dialect, and none for REST', () => {
    expect(
      dateRangeSql('file', 'file.demo_census_prod.demographics_data', [
        'Date of Hire',
      ]),
    ).toBe(
      'SELECT CAST(MIN("Date of Hire") AS VARCHAR) AS min_0, CAST(MAX("Date of Hire") AS VARCHAR) AS max_0 FROM file."demo_census_prod"."demographics_data"',
    );
    expect(dateRangeSql('postgres', 'world_cup.public.matches', ['date'])).toBe(
      'SELECT CAST(MIN("date") AS TEXT) AS min_0, CAST(MAX("date") AS TEXT) AS max_0 FROM "public"."matches"',
    );
    expect(
      dateRangeSql('databricks', 'main.hr.census', ['hired', 'born']),
    ).toBe(
      'SELECT CAST(MIN(`hired`) AS STRING) AS min_0, CAST(MAX(`hired`) AS STRING) AS max_0, CAST(MIN(`born`) AS STRING) AS min_1, CAST(MAX(`born`) AS STRING) AS max_1 FROM `main`.`hr`.`census`',
    );
    expect(dateRangeSql('postgres', 'a."b', ['c'])).toBeNull();
    expect(dateRangeSql('rest', 'api.v1.items', ['created'])).toBeNull();
    expect(dateRangeSql('file', 'file.s.t', [])).toBeNull();
  });

  it('quotes names that hold quotes', () => {
    expect(dateRangeSql('postgres', 'db.s.t', ['a"b'])).toContain(
      'MIN("a""b")',
    );
    expect(dateRangeSql('databricks', 'c.s.t', ['a`b'])).toContain(
      'MIN(`a``b`)',
    );
  });

  it('reads each column range from the one row, leaving out a column with no date', () => {
    expect(
      rangesOf(['Date of Hire', 'Termination'], {
        min_0: '2004-01-01',
        max_0: '2023-07-02 00:00:00',
        min_1: null,
        max_1: null,
      }),
    ).toEqual(
      new Map([['Date of Hire', { min: '2004-01-01', max: '2023-07-02' }]]),
    );
    expect(rangesOf(['x'], undefined).size).toBe(0);
  });
});
