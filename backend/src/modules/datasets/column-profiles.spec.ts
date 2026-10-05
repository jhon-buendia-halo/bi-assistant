import {
  buildProfileSql,
  buildTopValuesSql,
  parseProfileRow,
  profileColumns,
  DEFAULT_TOP_VALUES,
} from './column-profiles';
import type { DatasetColumnSnapshot } from './repositories/datasets.repository';

function col(
  name: string,
  type: string,
  nullable = false,
): DatasetColumnSnapshot {
  return { name, type, nullable };
}

describe('buildProfileSql', () => {
  const columns = [col('status', 'text'), col('is_paid', 'boolean')];

  it('quotes postgres identifiers with double quotes and addresses schema.table only', () => {
    const sql = buildProfileSql('main.public.claims', columns, 'postgres');

    expect(sql).toContain('FROM "public"."claims"');
    expect(sql).not.toContain('"main"');
    expect(sql).toContain('COUNT(*) AS "rows_total"');
    expect(sql).toContain('COUNT("status") AS "c0_nonnull"');
    expect(sql).toContain('COUNT(DISTINCT "status") AS "c0_distinct"');
    expect(sql).toContain('CAST(MIN("status") AS TEXT) AS "c0_min"');
    expect(sql).toContain('CAST(MAX("status") AS TEXT) AS "c0_max"');
  });

  it('skips MIN/MAX for a boolean column but keeps COUNT/COUNT DISTINCT', () => {
    const sql = buildProfileSql('main.public.claims', columns, 'postgres');

    expect(sql).toContain('COUNT("is_paid") AS "c1_nonnull"');
    expect(sql).toContain('COUNT(DISTINCT "is_paid") AS "c1_distinct"');
    expect(sql).not.toContain('c1_min');
    expect(sql).not.toContain('c1_max');
  });

  it('backtick-quotes databricks identifiers and addresses all three segments', () => {
    const sql = buildProfileSql('main.health.claims', columns, 'databricks');

    expect(sql).toContain('FROM `main`.`health`.`claims`');
    expect(sql).toContain('COUNT(`status`) AS `c0_nonnull`');
    expect(sql).toContain('CAST(MIN(`status`) AS STRING) AS `c0_min`');
    expect(sql).not.toContain('c1_min');
  });

  it('skips unordered types generically: json, array, map, struct, binary', () => {
    const unordered = [
      col('payload', 'jsonb'),
      col('tags', 'text[]'),
      col('attrs', 'MAP<STRING,STRING>'),
      col('addr', 'STRUCT<city:STRING>'),
      col('blob', 'bytea'),
    ];
    const sql = buildProfileSql('main.public.wide', unordered, 'postgres');

    for (let i = 0; i < unordered.length; i += 1) {
      expect(sql).not.toContain(`c${i}_min`);
      expect(sql).not.toContain(`c${i}_max`);
    }
  });
});

describe('buildTopValuesSql', () => {
  it('builds a GROUP BY top-N statement, dialect-quoted, capped at the given limit', () => {
    const sql = buildTopValuesSql(
      'main.public.claims',
      'status',
      'postgres',
      25,
    );

    expect(sql).toBe(
      'SELECT CAST("status" AS TEXT) AS "value", COUNT(*) AS "value_count" ' +
        'FROM "public"."claims" WHERE "status" IS NOT NULL GROUP BY "status" ' +
        'ORDER BY "value_count" DESC LIMIT 25',
    );
  });

  it('defaults the limit to DEFAULT_TOP_VALUES', () => {
    const sql = buildTopValuesSql('main.public.claims', 'status', 'postgres');
    expect(sql).toContain(`LIMIT ${DEFAULT_TOP_VALUES}`);
  });

  it('quotes for databricks with backticks and STRING cast', () => {
    const sql = buildTopValuesSql(
      'main.health.claims',
      'status',
      'databricks',
      10,
    );
    expect(sql).toBe(
      'SELECT CAST(`status` AS STRING) AS `value`, COUNT(*) AS `value_count` ' +
        'FROM `main`.`health`.`claims` WHERE `status` IS NOT NULL GROUP BY `status` ' +
        'ORDER BY `value_count` DESC LIMIT 10',
    );
  });
});

describe('parseProfileRow', () => {
  it('coerces string/bigint counts (as drivers return them for COUNT(*)) to numbers', () => {
    const row = {
      rows_total: '100',
      c0_nonnull: '100',
      c0_distinct: '1',
      c0_min: 'USD',
      c0_max: 'USD',
    };

    const { sampledRows, stats } = parseProfileRow(row, [
      col('currency', 'text'),
    ]);

    expect(sampledRows).toBe(100);
    expect(stats[0]).toEqual({
      nonNull: 100,
      distinctCount: 1,
      min: 'USD',
      max: 'USD',
    });
  });

  it('leaves min/max undefined when the aggregate omitted them (unordered types)', () => {
    const row = { rows_total: 5, c0_nonnull: 5, c0_distinct: 2 };
    const { stats } = parseProfileRow(row, [col('flag', 'boolean')]);
    expect(stats[0].min).toBeUndefined();
    expect(stats[0].max).toBeUndefined();
  });
});

/**
 * Fixture-like scenario for the orchestrator: a 100-row table with a constant
 * currency column, a 30%-null column, a 4-value enum, a cents column, and a
 * >25-distinct column — mirrors the acceptance fixture list in the unit spec.
 */
describe('profileColumns', () => {
  const columns: DatasetColumnSnapshot[] = [
    col('currency', 'text'), // 0: constant 'USD'
    col('status', 'text'), // 1: 4-value enum
    col('amount_cents', 'bigint'), // 2: cents-like, 80 distinct (no topValues)
    col('notes', 'text', true), // 3: 30% null, 65 distinct (no topValues)
    col('external_id', 'text'), // 4: 40 distinct (> 25, no topValues)
    col('is_active', 'boolean'), // 5: 2 distinct, MIN/MAX skipped
  ];

  const aggregateRow = {
    rows_total: 100,
    c0_nonnull: 100,
    c0_distinct: 1,
    c0_min: 'USD',
    c0_max: 'USD',
    c1_nonnull: 100,
    c1_distinct: 4,
    c1_min: 'DENIED',
    c1_max: 'VOID',
    c2_nonnull: 100,
    c2_distinct: 80,
    c2_min: '500',
    c2_max: '250000',
    c3_nonnull: 70,
    c3_distinct: 65,
    c3_min: 'a note',
    c3_max: 'zzz note',
    c4_nonnull: 100,
    c4_distinct: 40,
    c4_min: 'ext-0001',
    c4_max: 'ext-9999',
    c5_nonnull: 100,
    c5_distinct: 2,
    // no c5_min / c5_max — boolean, MIN/MAX skipped
  };

  const topValueRows: Record<string, { rows: Record<string, unknown>[] }> = {
    currency: { rows: [{ value: 'USD', value_count: 100 }] },
    status: {
      rows: [
        { value: 'PAID', value_count: 60 },
        { value: 'DENIED', value_count: 20 },
        { value: 'PENDING', value_count: 15 },
        { value: 'VOID', value_count: 5 },
      ],
    },
    is_active: {
      rows: [
        { value: 'true', value_count: 90 },
        { value: 'false', value_count: 10 },
      ],
    },
  };

  function buildRunner() {
    return jest.fn((sql: string) => {
      if (sql.includes('GROUP BY')) {
        const hit = Object.keys(topValueRows).find((name) =>
          sql.includes(`"${name}"`),
        );
        if (hit) return Promise.resolve(topValueRows[hit]);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [aggregateRow] });
    });
  }

  it('marks a fully-constant column constant with no null rate', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles.currency.constant).toBe(true);
    expect(profiles.currency.distinctCount).toBe(1);
    expect(profiles.currency.nullRate).toBe(0);
    expect(profiles.currency.min).toBe('USD');
    expect(profiles.currency.max).toBe('USD');
    expect(profiles.currency.topValues).toEqual([{ value: 'USD', count: 100 }]);
  });

  it('computes a 30% null rate from nonNull vs sampledRows', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles.notes.sampledRows).toBe(100);
    expect(profiles.notes.nullRate).toBeCloseTo(0.3);
    expect(profiles.notes.constant).toBe(false);
  });

  it('fetches top values for a low-cardinality enum column (<=25 distinct)', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles.status.distinctCount).toBe(4);
    expect(profiles.status.topValues).toEqual([
      { value: 'PAID', count: 60 },
      { value: 'DENIED', count: 20 },
      { value: 'PENDING', count: 15 },
      { value: 'VOID', count: 5 },
    ]);
  });

  it('reads magnitude cents-like for a `_cents`-suffixed column', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles.amount_cents.magnitude).toBe('cents-like');
  });

  it('skips top values for a column above the 25-distinct cap', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles.external_id.distinctCount).toBe(40);
    expect(profiles.external_id.topValues).toBeUndefined();
    expect(profiles.amount_cents.topValues).toBeUndefined();
    const groupByCalls = run.mock.calls
      .map(([sql]: [string]) => sql)
      .filter((sql: string) => sql.includes('GROUP BY'));
    expect(
      groupByCalls.some((sql: string) => sql.includes('"external_id"')),
    ).toBe(false);
    expect(
      groupByCalls.some((sql: string) => sql.includes('"amount_cents"')),
    ).toBe(false);
  });

  it('still profiles a boolean column (COUNT/DISTINCT) with no min/max', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles.is_active.distinctCount).toBe(2);
    expect(profiles.is_active.min).toBeUndefined();
    expect(profiles.is_active.max).toBeUndefined();
    expect(profiles.is_active.topValues).toEqual([
      { value: 'true', count: 90 },
      { value: 'false', count: 10 },
    ]);
  });

  it('returns no profiles when the aggregate statement fails, without throwing', async () => {
    const run = jest.fn().mockRejectedValue(new Error('permission denied'));

    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
    );

    expect(profiles).toEqual({});
  });

  it('returns no profiles when the aggregate statement times out', async () => {
    const run = jest.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ rows: [aggregateRow] }), 200),
        ),
    ) as unknown as (
      sql: string,
    ) => Promise<{ rows: Record<string, unknown>[] }>;

    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
      { timeoutMs: 15 },
    );

    expect(profiles).toEqual({});
  });

  it('caps profiled columns at maxColumns', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      columns,
      'postgres',
      {
        maxColumns: 2,
      },
    );

    expect(Object.keys(profiles).sort()).toEqual(['currency', 'status']);
  });

  it('returns {} for a table with no columns', async () => {
    const run = buildRunner();
    const profiles = await profileColumns(
      run,
      'main.public.claims',
      [],
      'postgres',
    );
    expect(profiles).toEqual({});
    expect(run).not.toHaveBeenCalled();
  });
});

describe('profileColumns — magnitude heuristics', () => {
  const columns: DatasetColumnSnapshot[] = [
    col('match_rate', 'double precision'),
    col('goal_count', 'bigint'),
    col('external_ref', 'bigint'),
    col('shirt_number', 'integer'),
  ];

  const aggregateRow = {
    rows_total: 10,
    c0_nonnull: 10,
    c0_distinct: 8,
    c0_min: '0',
    c0_max: '0.87',
    c1_nonnull: 10,
    c1_distinct: 5,
    c1_min: '0',
    c1_max: '12',
    c2_nonnull: 10,
    c2_distinct: 10,
    c2_min: '1000000000',
    c2_max: '9999999999',
    c3_nonnull: 10,
    c3_distinct: 10,
    c3_min: '1',
    c3_max: '23',
  };

  function buildRunner() {
    return jest.fn((sql: string) => {
      if (sql.includes('GROUP BY')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [aggregateRow] });
    });
  }

  it('reads a 0..1 numeric column as a fraction', async () => {
    const profiles = await profileColumns(
      buildRunner(),
      'main.public.matches',
      columns,
      'postgres',
    );
    expect(profiles.match_rate.magnitude).toBe('fraction');
  });

  it('reads an integer `*_count` column as count', async () => {
    const profiles = await profileColumns(
      buildRunner(),
      'main.public.matches',
      columns,
      'postgres',
    );
    expect(profiles.goal_count.magnitude).toBe('count');
  });

  it('reads a large integer (> 10^9) as large-integer', async () => {
    const profiles = await profileColumns(
      buildRunner(),
      'main.public.matches',
      columns,
      'postgres',
    );
    expect(profiles.external_ref.magnitude).toBe('large-integer');
  });

  it('leaves an ordinary small integer column without a magnitude guess', async () => {
    const profiles = await profileColumns(
      buildRunner(),
      'main.public.matches',
      columns,
      'postgres',
    );
    expect(profiles.shirt_number.magnitude).toBeUndefined();
  });
});
