import {
  asksAboutToday,
  asksTimeRelative,
  dataEnd,
  isDateType,
  isSnapshot,
  isoDay,
  readsNow,
  sqlReadsTable,
} from './data-dates';

const NOW = new Date('2026-11-17T12:00:00Z');

/** The census of the comparison: hires up to 2023-07-02. */
const CENSUS = {
  key: 'file.demo_census_prod.demographics_data',
  columns: [
    { name: 'Date of Birth', range: { min: '1949-02-01', max: '2002-05-30' } },
    { name: 'Date of Hire', range: { min: '2004-01-01', max: '2023-07-02' } },
    { name: 'Age' },
  ],
};

describe('data dates (agents.md 5.11 *Data dates*)', () => {
  it('reads date types and driver values as days', () => {
    for (const type of [
      'DATE',
      'date',
      'timestamp without time zone',
      'TIMESTAMP_NTZ',
      'datetime',
      'timestamptz',
    ]) {
      expect([type, isDateType(type)]).toEqual([type, true]);
    }
    for (const type of ['DOUBLE', 'varchar', 'integer', undefined]) {
      expect([type, isDateType(type)]).toEqual([type, false]);
    }
    expect(isoDay('2023-07-02')).toBe('2023-07-02');
    expect(isoDay('2023-07-02 13:45:00')).toBe('2023-07-02');
    expect(isoDay(new Date('2023-07-02T00:00:00Z'))).toBe('2023-07-02');
    expect(isoDay('July 2')).toBeNull();
    expect(isoDay(null)).toBeNull();
  });

  it('takes the latest date of the dated columns, and calls data ending over 90 days ago a snapshot', () => {
    expect(dataEnd([CENSUS])?.date).toBe('2023-07-02');
    expect(isSnapshot('2023-07-02', NOW)).toBe(true);
    expect(isSnapshot('2026-09-01', NOW)).toBe(false);
    expect(isSnapshot(null, NOW)).toBe(false);
  });

  it('ends a dataset at its latest date, so an older table in it (a launch date) is not singled out', () => {
    const products = {
      key: 'edge.public.products',
      columns: [
        {
          name: 'launched_at',
          range: { min: '2015-01-01', max: '2025-09-04' },
        },
      ],
    };
    const promotions = {
      key: 'edge.public.promotions',
      columns: [
        { name: 'start_date', range: { min: '2025-01-08', max: '2025-10-08' } },
      ],
    };
    expect(dataEnd([products, promotions])).toEqual({
      date: '2025-10-08',
      table: 'edge.public.promotions',
      column: 'start_date',
    });
    expect(dataEnd([{ key: 'x.y.z', columns: [] }])).toBeNull();
  });

  it('reads a time cue in the question: tenure, age, since, recency, now', () => {
    for (const q of [
      'How many employees fall in each tenure band?',
      'What is the average age by plan?',
      'How many orders since January?',
      'Revenue last month',
      '¿Cuál es la antigüedad promedio?',
    ]) {
      expect([q, asksTimeRelative(q)]).toEqual([q, true]);
    }
    for (const q of [
      'Who were the top scorers in 2018?',
      'Which plan is the most popular?',
      'Total goals per match',
    ]) {
      expect([q, asksTimeRelative(q)]).toEqual([q, false]);
    }
  });

  it('finds the current date in SQL, the words that ask about today, and the table a statement reads', () => {
    expect(
      readsNow(
        'SELECT date_diff(\'day\', "Date of Hire", CURRENT_DATE) FROM t',
      ),
    ).toBe(true);
    expect(readsNow('SELECT AGE(NOW(), hired) FROM t')).toBe(true);
    expect(readsNow('SELECT datediff(current_timestamp(), hired) FROM t')).toBe(
      true,
    );
    expect(
      readsNow("SELECT date_diff('day', hired, DATE '2024-01-01') FROM t"),
    ).toBe(false);
    expect(
      asksAboutToday(
        'How many employees have tenure under 1 year as of today?',
      ),
    ).toBe(true);
    expect(asksAboutToday('¿Cuántos empleados hay hoy?')).toBe(true);
    expect(asksAboutToday('How many employees fall in each tenure band?')).toBe(
      false,
    );
    expect(
      sqlReadsTable(
        'SELECT * FROM file.demo_census_prod.demographics_data',
        CENSUS.key,
      ),
    ).toBe(true);
    expect(
      sqlReadsTable(
        'SELECT * FROM "demo_census_prod"."demographics_data"',
        CENSUS.key,
      ),
    ).toBe(true);
    expect(
      sqlReadsTable('SELECT * FROM demographics_data_v2', CENSUS.key),
    ).toBe(false);
  });
});
