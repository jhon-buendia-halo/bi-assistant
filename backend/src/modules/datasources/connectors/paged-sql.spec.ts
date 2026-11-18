import { BadRequestException } from '@nestjs/common';
import {
  buildPagedSql,
  readPagedRows,
  TOTAL_COLUMN,
  type PagedSql,
} from './paged-sql';
import type {
  ColumnKind,
  FilterSpec,
  PagedStatement,
  SortSpec,
} from './paged-sql.types';

const KINDS: Record<string, ColumnKind> = {
  country: 'text',
  goals: 'number',
  year: 'number',
  vip: 'boolean',
  played: 'date',
};

function stmt(overrides: Partial<PagedStatement> = {}): PagedStatement {
  return {
    sql: 'SELECT country, goals, year FROM t',
    columns: ['country', 'goals', 'year'],
    filters: [],
    sort: [],
    limit: 50,
    offset: 0,
    kinds: KINDS,
    ...overrides,
  };
}

function where(built: PagedSql): string {
  return /\nWHERE (.*)\n/.exec(built.text)?.[1] ?? '';
}

function orderBy(built: PagedSql): string {
  return /\nORDER BY (.*)\n/.exec(built.text)?.[1] ?? '';
}

function filtered(
  filter: FilterSpec,
  dialect: 'postgres' | 'databricks' | 'sqlite' | 'duckdb' = 'postgres',
): PagedSql {
  return buildPagedSql(
    dialect,
    stmt({
      sql: 'SELECT country, goals, year, vip, played FROM t',
      columns: ['country', 'goals', 'year', 'vip', 'played'],
      filters: [filter],
    }),
  );
}

function rejection(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as Error).message;
  }
  throw new Error('expected a 400');
}

describe('buildPagedSql: the wrapper (plan 1.28.1)', () => {
  it('wraps the stored SQL, unlimited when it has no LIMIT of its own, with the total, the order and the page window', () => {
    const built = buildPagedSql('postgres', stmt({ offset: 100 }));

    expect(built.text).toBe(
      [
        'SELECT _qti.*, COUNT(*) OVER () AS "__qti_total"',
        'FROM (',
        'SELECT country, goals, year FROM t',
        ') AS _qti',
        'ORDER BY 1 ASC NULLS LAST, 2, 3',
        'LIMIT 50 OFFSET 100',
      ].join('\n'),
    );
    expect(built.params).toEqual([]);
    expect(built.countText).toBe(
      [
        'SELECT COUNT(*) AS "__qti_total"',
        'FROM (',
        'SELECT country, goals, year FROM t',
        ') AS _qti',
      ].join('\n'),
    );
  });

  it('keeps a CTE stored statement whole inside the subquery', () => {
    const sql = 'WITH x AS (SELECT 1 AS a) SELECT a FROM x';
    const built = buildPagedSql('sqlite', stmt({ sql, columns: ['a'] }));

    expect(built.text).toContain(`FROM (\n${sql}\n) AS _qti`);
  });

  it('drops a trailing comment and semicolon before wrapping', () => {
    const one = buildPagedSql(
      'postgres',
      stmt({ sql: 'SELECT country, goals, year FROM t; -- all of it\n' }),
    );
    const two = buildPagedSql(
      'postgres',
      stmt({ sql: 'SELECT country, goals, year FROM t -- note' }),
    );

    for (const built of [one, two]) {
      expect(built.text).toContain(
        'FROM (\nSELECT country, goals, year FROM t\n) AS _qti',
      );
    }
  });

  it('peels a markdown fence and a leading comment', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({ sql: '```sql\n-- top scorers\nSELECT country FROM t\n```' }),
    );

    expect(built.text).toContain('FROM (\nSELECT country FROM t\n) AS _qti');
  });

  it('raises the stored top-level LIMIT to 50,001 and leaves an inner one', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({
        sql: 'SELECT country, goals, year FROM (SELECT * FROM t LIMIT 3) s ORDER BY goals DESC LIMIT 10',
      }),
    );

    expect(built.text).toContain(
      'SELECT country, goals, year FROM (SELECT * FROM t LIMIT 3) s ORDER BY goals DESC LIMIT 50001\n',
    );
  });

  it('skips a column of unknown kind as a tie-breaker', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({ kinds: { country: 'text', goals: 'unknown', year: 'number' } }),
    );

    expect(built.text).toContain('ORDER BY 1 ASC NULLS LAST, 3\n');
  });

  it('refuses a stored statement that is not read-only', () => {
    expect(
      rejection(() =>
        buildPagedSql('postgres', stmt({ sql: 'DELETE FROM t' })),
      ),
    ).toMatch(/read-only/);
    expect(
      rejection(() =>
        buildPagedSql('postgres', stmt({ sql: 'SELECT 1; DROP TABLE t' })),
      ),
    ).toMatch(/single statement/);
  });

  it('never scans the wrapper: a column named with a forbidden word filters and sorts', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({
        sql: 'SELECT * FROM v',
        columns: ['Last Update', 'created_at'],
        kinds: { 'Last Update': 'date', created_at: 'date' },
        filters: [{ column: 'Last Update', op: 'not_null' }],
        sort: [{ column: 'created_at', direction: 'desc' }],
      }),
    );

    expect(where(built)).toBe('"Last Update" IS NOT NULL');
    expect(orderBy(built)).toBe('"created_at" DESC NULLS LAST, 1');
  });

  it('writes LIMIT and OFFSET as checked integers', () => {
    expect(
      rejection(() => buildPagedSql('postgres', stmt({ limit: 0 }))),
    ).toMatch(/page/i);
    expect(
      rejection(() => buildPagedSql('postgres', stmt({ offset: 1.5 }))),
    ).toMatch(/page/i);
    expect(
      rejection(() => buildPagedSql('postgres', stmt({ offset: 50_001 }))),
    ).toMatch(/page/i);
  });
});

describe('buildPagedSql: identifiers and placeholders per dialect', () => {
  const quoted = stmt({
    sql: 'SELECT * FROM t',
    columns: ['Last "Big" Update', 'we`ird'],
    kinds: { 'Last "Big" Update': 'text', 'we`ird': 'number' },
    filters: [
      { column: 'Last "Big" Update', op: 'eq', value: 'Brazil' },
      { column: 'we`ird', op: 'gt', value: 3 },
    ],
    sort: [{ column: 'we`ird', direction: 'asc' }],
  });

  it('Postgres: double quotes doubled, $n parameters', () => {
    const built = buildPagedSql('postgres', quoted);

    expect(where(built)).toBe(
      'LOWER(CAST("Last ""Big"" Update" AS TEXT)) = LOWER(CAST($1 AS TEXT)) AND "we`ird" > $2',
    );
    expect(orderBy(built)).toBe('"we`ird" ASC NULLS LAST, 1');
    expect(built.params).toEqual(['Brazil', 3]);
  });

  it('Databricks: backticks doubled, :pN parameters, STRING casts', () => {
    const built = buildPagedSql('databricks', quoted);

    expect(built.text).toContain('COUNT(*) OVER () AS `__qti_total`');
    expect(where(built)).toBe(
      'LOWER(CAST(`Last "Big" Update` AS STRING)) = LOWER(:p1) AND `we``ird` > :p2',
    );
    expect(orderBy(built)).toBe('`we``ird` ASC NULLS LAST, 1');
    expect(built.params).toEqual(['Brazil', 3]);
  });

  it('SQLite: double quotes doubled, ? parameters', () => {
    const built = buildPagedSql('sqlite', quoted);

    expect(where(built)).toBe(
      'LOWER(CAST("Last ""Big"" Update" AS TEXT)) = LOWER(?) AND "we`ird" > ?',
    );
    expect(built.params).toEqual(['Brazil', 3]);
  });

  it('DuckDB: double quotes doubled, $n parameters, VARCHAR casts', () => {
    const built = buildPagedSql('duckdb', quoted);

    expect(built.text).toContain('COUNT(*) OVER () AS "__qti_total"');
    expect(where(built)).toBe(
      'LOWER(CAST("Last ""Big"" Update" AS VARCHAR)) = LOWER(CAST($1 AS VARCHAR)) AND "we`ird" > $2',
    );
    expect(orderBy(built)).toBe('"we`ird" ASC NULLS LAST, 1');
    expect(built.params).toEqual(['Brazil', 3]);
  });

  it('DuckDB keeps booleans as booleans', () => {
    const built = filtered({ column: 'vip', op: 'eq', value: true }, 'duckdb');

    expect(where(built)).toBe('"vip" = $1');
    expect(built.params).toEqual([true]);
  });

  it('the count statement keeps the same predicates and parameters', () => {
    const built = buildPagedSql('postgres', quoted);

    expect(built.countText).toContain(
      '\nWHERE LOWER(CAST("Last ""Big"" Update" AS TEXT)) = LOWER(CAST($1 AS TEXT)) AND "we`ird" > $2',
    );
    expect(built.countText).not.toContain('ORDER BY');
    expect(built.countText).not.toContain('OFFSET');
  });
});

describe('buildPagedSql: order', () => {
  it('sorts the requested keys with NULLS LAST, then every remaining ordinal', () => {
    const sort: SortSpec[] = [
      { column: 'goals', direction: 'desc' },
      { column: 'country', direction: 'asc' },
    ];
    const built = buildPagedSql('postgres', stmt({ sort }));

    expect(orderBy(built)).toBe(
      '"goals" DESC NULLS LAST, "country" ASC NULLS LAST, 3',
    );
  });

  it('defaults to the stored outer ORDER BY when its keys are output names or ordinals', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({
        sql: 'SELECT country, goals, year FROM t ORDER BY goals DESC, 1',
      }),
    );

    expect(orderBy(built)).toBe('2 DESC, 1 ASC, 3');
  });

  it('keeps a stored NULLS clause and reads quoted keys', () => {
    const pg = buildPagedSql(
      'postgres',
      stmt({
        sql: 'SELECT country, goals AS "Goals", year FROM t ORDER BY "Goals" DESC NULLS FIRST LIMIT 10',
        columns: ['country', 'Goals', 'year'],
      }),
    );
    const dbx = buildPagedSql(
      'databricks',
      stmt({
        sql: 'SELECT country, goals, year FROM t ORDER BY `year` ASC',
      }),
    );

    expect(orderBy(pg)).toBe('2 DESC NULLS FIRST, 1, 3');
    expect(orderBy(dbx)).toBe('3 ASC, 1, 2');
  });

  it('falls back to the first column when the stored order is not expressible', () => {
    for (const sql of [
      'SELECT country, goals, year FROM t ORDER BY t.goals DESC',
      'SELECT country, SUM(goals) AS goals, year FROM t GROUP BY 1, 3 ORDER BY SUM(goals) DESC',
      'SELECT country, goals, year FROM t ORDER BY goals DESC, missing',
      'SELECT country, goals, year FROM (SELECT * FROM t ORDER BY goals) s',
      'SELECT country, ROW_NUMBER() OVER (ORDER BY goals) AS goals, year FROM t',
      'SELECT country, goals, year FROM t ORDER BY 7',
    ]) {
      expect(orderBy(buildPagedSql('postgres', stmt({ sql })))).toBe(
        '1 ASC NULLS LAST, 2, 3',
      );
    }
  });

  it('reads the stored ORDER BY of a CTE statement, not the CTE body', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({
        sql: 'WITH s AS (SELECT * FROM t ORDER BY year) SELECT country, goals, year FROM s ORDER BY goals DESC',
      }),
    );

    expect(orderBy(built)).toBe('2 DESC, 1, 3');
  });

  it('cannot default to a duplicated name; an ordinal still works', () => {
    const columns = ['country', 'goals', 'goals'];
    const byName = buildPagedSql(
      'postgres',
      stmt({ sql: 'SELECT a, b, c FROM t ORDER BY goals', columns }),
    );
    const byOrdinal = buildPagedSql(
      'postgres',
      stmt({ sql: 'SELECT a, b, c FROM t ORDER BY 3 DESC', columns }),
    );

    expect(orderBy(byName)).toBe('1 ASC NULLS LAST, 2, 3');
    expect(orderBy(byOrdinal)).toBe('3 DESC, 1, 2');
  });
});

describe('buildPagedSql: predicates per operator', () => {
  const T = 'LOWER(CAST("country" AS TEXT))';
  const P = (n: number) => `LOWER(CAST($${n} AS TEXT))`;
  const cases: [string, FilterSpec, string, unknown[]][] = [
    [
      'eq text, case-insensitive',
      { column: 'country', op: 'eq', value: 'Brazil' },
      `${T} = ${P(1)}`,
      ['Brazil'],
    ],
    [
      'neq text keeps NULLs',
      { column: 'country', op: 'neq', value: 'Brazil' },
      `(${T} <> ${P(1)} OR "country" IS NULL)`,
      ['Brazil'],
    ],
    ['eq number', { column: 'goals', op: 'eq', value: 3 }, '"goals" = $1', [3]],
    [
      'neq number keeps NULLs',
      { column: 'goals', op: 'neq', value: 3 },
      '("goals" <> $1 OR "goals" IS NULL)',
      [3],
    ],
    ['gt', { column: 'goals', op: 'gt', value: 3 }, '"goals" > $1', [3]],
    ['gte', { column: 'goals', op: 'gte', value: 3 }, '"goals" >= $1', [3]],
    ['lt', { column: 'goals', op: 'lt', value: 3 }, '"goals" < $1', [3]],
    ['lte', { column: 'goals', op: 'lte', value: 3 }, '"goals" <= $1', [3]],
    [
      'between',
      { column: 'year', op: 'between', value: 2000, valueTo: 2010 },
      '"year" BETWEEN $1 AND $2',
      [2000, 2010],
    ],
    [
      'in number',
      { column: 'year', op: 'in', values: [2002, 2006] },
      '"year" IN ($1, $2)',
      [2002, 2006],
    ],
    [
      'not_in number keeps NULLs',
      { column: 'year', op: 'not_in', values: [2002] },
      '("year" NOT IN ($1) OR "year" IS NULL)',
      [2002],
    ],
    [
      'in text',
      { column: 'country', op: 'in', values: ['Brazil', 'Italy'] },
      `${T} IN (${P(1)}, ${P(2)})`,
      ['Brazil', 'Italy'],
    ],
    [
      'not_in text keeps NULLs',
      { column: 'country', op: 'not_in', values: ['Brazil'] },
      `(${T} NOT IN (${P(1)}) OR "country" IS NULL)`,
      ['Brazil'],
    ],
    [
      'contains',
      { column: 'country', op: 'contains', value: 'bra' },
      `${T} LIKE ${P(1)}`,
      ['%bra%'],
    ],
    [
      'not_contains keeps NULLs',
      { column: 'country', op: 'not_contains', value: 'bra' },
      `(${T} NOT LIKE ${P(1)} OR "country" IS NULL)`,
      ['%bra%'],
    ],
    [
      'starts_with',
      { column: 'country', op: 'starts_with', value: 'Bra' },
      `${T} LIKE ${P(1)}`,
      ['Bra%'],
    ],
    [
      'contains on a number column compares its text',
      { column: 'goals', op: 'contains', value: 1 },
      `LOWER(CAST("goals" AS TEXT)) LIKE ${P(1)}`,
      ['%1%'],
    ],
    ['is_null', { column: 'goals', op: 'is_null' }, '"goals" IS NULL', []],
    [
      'not_null',
      { column: 'goals', op: 'not_null' },
      '"goals" IS NOT NULL',
      [],
    ],
    [
      'eq boolean',
      { column: 'vip', op: 'eq', value: true },
      '"vip" = $1',
      [true],
    ],
    [
      'gte date as an ISO string',
      { column: 'played', op: 'gte', value: '2024-01-31' },
      '"played" >= $1',
      ['2024-01-31'],
    ],
  ];

  it.each(cases)('%s', (_label, filter, sql, params) => {
    const built = filtered(filter);
    expect(where(built)).toBe(sql);
    expect(built.params).toEqual(params);
  });

  it('AND-s several filters', () => {
    const built = buildPagedSql(
      'postgres',
      stmt({
        filters: [
          { column: 'goals', op: 'gte', value: 3 },
          { column: 'year', op: 'lt', value: 2010 },
        ],
      }),
    );
    expect(where(built)).toBe('"goals" >= $1 AND "year" < $2');
  });

  it('escapes % _ and \\ in LIKE values; SQLite names the escape', () => {
    const filter: FilterSpec = {
      column: 'country',
      op: 'contains',
      value: '50%_off\\',
    };
    const pg = filtered(filter);
    const lite = filtered(filter, 'sqlite');
    const dbx = filtered(filter, 'databricks');
    const duck = filtered(filter, 'duckdb');

    expect(pg.params).toEqual(['%50\\%\\_off\\\\%']);
    expect(where(pg)).not.toContain('ESCAPE');
    expect(where(dbx)).not.toContain('ESCAPE');
    expect(where(lite)).toBe(
      'LOWER(CAST("country" AS TEXT)) LIKE LOWER(?) ESCAPE \'\\\'',
    );
    expect(lite.params).toEqual(['%50\\%\\_off\\\\%']);
    // DuckDB's LIKE has no default escape character either.
    expect(where(duck)).toBe(
      'LOWER(CAST("country" AS VARCHAR)) LIKE LOWER(CAST($1 AS VARCHAR)) ESCAPE \'\\\'',
    );
    expect(duck.params).toEqual(['%50\\%\\_off\\\\%']);
  });
});

describe('buildPagedSql: values coerced by kind', () => {
  it('turns a numeric string into a number for a number column', () => {
    expect(
      filtered({ column: 'goals', op: 'gt', value: ' 3.5 ' }).params,
    ).toEqual([3.5]);
  });

  it('turns true/false text into a boolean, and SQLite binds 1/0', () => {
    expect(filtered({ column: 'vip', op: 'eq', value: 'true' }).params).toEqual(
      [true],
    );
    expect(
      filtered({ column: 'vip', op: 'in', values: [true, 'false'] }, 'sqlite')
        .params,
    ).toEqual([1, 0]);
  });

  it('turns a date into an ISO string', () => {
    expect(
      filtered({ column: 'played', op: 'lt', value: 'March 1, 2024 UTC' })
        .params,
    ).toEqual(['2024-03-01T00:00:00.000Z']);
  });

  it('turns a number into text for a text column', () => {
    expect(filtered({ column: 'country', op: 'eq', value: 7 }).params).toEqual([
      '7',
    ]);
  });

  it('refuses a value that does not coerce, before any query', () => {
    expect(
      rejection(() => filtered({ column: 'goals', op: 'gt', value: 'many' })),
    ).toBe('Filter on goals: "many" is not a number');
    expect(
      rejection(() => filtered({ column: 'vip', op: 'eq', value: 'maybe' })),
    ).toBe('Filter on vip: "maybe" is not true or false');
    expect(
      rejection(() => filtered({ column: 'played', op: 'eq', value: 'soon' })),
    ).toBe('Filter on played: "soon" is not a date');
  });
});

describe('buildPagedSql: validation (api.md errors)', () => {
  it('refuses an unknown column in a filter or a sort', () => {
    expect(
      rejection(() =>
        buildPagedSql(
          'postgres',
          stmt({ filters: [{ column: 'nope', op: 'is_null' }] }),
        ),
      ),
    ).toBe('Unknown column "nope"');
    expect(
      rejection(() =>
        buildPagedSql(
          'postgres',
          stmt({ sort: [{ column: 'Country', direction: 'asc' }] }),
        ),
      ),
    ).toBe('Unknown column "Country"');
  });

  it('refuses to filter or sort a column that appears twice', () => {
    const columns = ['country', 'goals', 'goals'];
    expect(
      rejection(() =>
        buildPagedSql(
          'postgres',
          stmt({ columns, filters: [{ column: 'goals', op: 'is_null' }] }),
        ),
      ),
    ).toBe(
      'Column "goals" appears more than once in the result; it cannot be filtered or sorted',
    );
    expect(
      rejection(() =>
        buildPagedSql(
          'postgres',
          stmt({ columns, sort: [{ column: 'goals', direction: 'asc' }] }),
        ),
      ),
    ).toBe(
      'Column "goals" appears more than once in the result; it cannot be filtered or sorted',
    );
  });

  it('refuses an operator without its value', () => {
    expect(rejection(() => filtered({ column: 'goals', op: 'eq' }))).toBe(
      'Filter on goals: eq needs a value',
    );
    expect(
      rejection(() => filtered({ column: 'goals', op: 'between', value: 1 })),
    ).toBe('Filter on goals: between needs a value');
    expect(
      rejection(() => filtered({ column: 'goals', op: 'in', values: [] })),
    ).toBe('Filter on goals: in needs a value');
    expect(
      rejection(() =>
        filtered({ column: 'country', op: 'contains', value: '' }),
      ),
    ).toBe('Filter on country: contains needs a value');
  });

  it('refuses an unknown operator', () => {
    expect(
      rejection(() =>
        filtered({ column: 'goals', op: 'like' as FilterSpec['op'], value: 1 }),
      ),
    ).toBe('Filter on goals: unknown operator "like"');
  });
});

describe('readPagedRows', () => {
  const built = buildPagedSql('postgres', stmt({ offset: 50 }));

  it('strips the total from the columns and rows and reports it as matchedRows', async () => {
    const exec = jest.fn().mockResolvedValue({
      columns: ['country', 'goals', TOTAL_COLUMN],
      rows: [
        { country: 'Brazil', goals: 3, [TOTAL_COLUMN]: '120' },
        { country: 'Italy', goals: 2, [TOTAL_COLUMN]: '120' },
      ],
    });

    await expect(readPagedRows(built, 50, exec)).resolves.toEqual({
      columns: ['country', 'goals'],
      rows: [
        { country: 'Brazil', goals: 3 },
        { country: 'Italy', goals: 2 },
      ],
      matchedRows: 120,
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('counts once more when a page past the end comes back empty', async () => {
    const exec = jest
      .fn()
      .mockResolvedValueOnce({ columns: ['country', TOTAL_COLUMN], rows: [] })
      .mockResolvedValueOnce({
        columns: [TOTAL_COLUMN],
        rows: [{ [TOTAL_COLUMN]: 7n }],
      });

    await expect(readPagedRows(built, 50, exec)).resolves.toEqual({
      columns: ['country'],
      rows: [],
      matchedRows: 7,
    });
    expect(exec).toHaveBeenLastCalledWith(built.countText);
  });

  it('does not count again for an empty first page', async () => {
    const exec = jest
      .fn()
      .mockResolvedValue({ columns: ['country', TOTAL_COLUMN], rows: [] });

    await expect(readPagedRows(built, 0, exec)).resolves.toMatchObject({
      matchedRows: 0,
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
