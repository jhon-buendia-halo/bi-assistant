import {
  deriveDashboardFilters,
  recommendChartForm,
  recommendComposition,
  recommendedFormBlock,
} from './chart-heuristic';
import type { ToolDataRecord } from './entities/project.entity';

/** One successful query result in the shape the assistant stores. */
function record(
  rows: Record<string, unknown>[],
  columns?: string[],
  rowCount?: number,
): ToolDataRecord[] {
  return [
    {
      tool: 'run_readonly_sql',
      input: 'SELECT * FROM main.health.claims',
      columns: columns ?? Object.keys(rows[0] ?? {}),
      rows,
      rowCount: rowCount ?? rows.length,
    },
  ];
}

describe('recommendChartForm rules', () => {
  it('recommends metric cards for a single row of measures', () => {
    const result = recommendChartForm(
      record([{ total_claims: 1204, denied: 88 }]),
    );

    expect(result?.recommendation).toContain('metric cards');
    expect(result?.recommendation).toContain('total_claims');
    expect(result?.shape).toContain('1 row');
  });

  it('recommends a line chart for one measure over time', () => {
    const result = recommendChartForm(
      record([
        { month: '2024-01', claims: 10 },
        { month: '2024-02', claims: 14 },
        { month: '2024-03', claims: 9 },
      ]),
    );

    expect(result?.recommendation).toContain('a line chart over month');
    expect(result?.recommendation).not.toContain('multi-series');
    expect(result?.shape).toContain('month (temporal)');
  });

  it('recommends a multi-series line for two or three measures over time', () => {
    const result = recommendChartForm(
      record([
        { period: '2024-01-01', claims: 10, denials: 2, cost: 100 },
        { period: '2024-02-01', claims: 14, denials: 3, cost: 120 },
      ]),
    );

    expect(result?.recommendation).toContain('multi-series line chart');
    expect(result?.recommendation).toContain('claims, denials and cost');
  });

  it('falls back to a switchable line when there are more than three measures', () => {
    const result = recommendChartForm(
      record([
        { month: '2024-01', a: 1, b: 2, c: 3, d: 4 },
        { month: '2024-02', a: 2, b: 3, c: 4, d: 5 },
      ]),
    );

    expect(result?.recommendation).toContain('line chart over month');
    expect(result?.recommendation).toContain('switch between');
  });

  it('recommends sorted horizontal bars for one label and one measure', () => {
    const result = recommendChartForm(
      record([
        { payer: 'Aetna', claims: 90 },
        { payer: 'Cigna', claims: 40 },
      ]),
    );

    expect(result?.recommendation).toContain('sorted horizontal bars');
    expect(result?.recommendation).not.toContain('Other');
    expect(result?.shape).toContain('payer (categorical, 2 distinct)');
  });

  it('adds a top-N and "Other" cut past eight categories', () => {
    const rows = Array.from({ length: 12 }, (_, n) => ({
      payer: `payer-${n}`,
      claims: n,
    }));

    const result = recommendChartForm(record(rows));

    expect(result?.recommendation).toContain('top 8');
    expect(result?.recommendation).toContain('"Other"');
  });

  it('recommends a scatter plot for two measures', () => {
    const result = recommendChartForm(
      record([
        { cost: 10, outcome: 3 },
        { cost: 20, outcome: 6 },
      ]),
    );

    expect(result?.recommendation).toContain('scatter plot');
    expect(result?.recommendation).toContain('cost (x axis)');
  });

  it('colours the scatter plot by an optional category', () => {
    const result = recommendChartForm(
      record([
        { cost: 10, outcome: 3, plan: 'HMO' },
        { cost: 20, outcome: 6, plan: 'PPO' },
      ]),
    );

    expect(result?.recommendation).toContain('scatter plot');
    expect(result?.recommendation).toContain('coloured by plan');
  });

  it('recommends a heatmap for two labels crossed by one measure', () => {
    const result = recommendChartForm(
      record([
        { region: 'North', plan: 'HMO', claims: 10 },
        { region: 'South', plan: 'PPO', claims: 20 },
      ]),
    );

    expect(result?.recommendation).toContain('heatmap');
    expect(result?.recommendation).toContain('shaded by claims');
  });

  it('falls back to a sortable table when nothing matches', () => {
    const result = recommendChartForm(
      record([
        { a: 'x', b: 'y', c: 'z', d: 'w' },
        { a: 'p', b: 'q', c: 'r', d: 's' },
      ]),
    );

    expect(result?.recommendation).toContain('sortable table');
  });
});

describe('recommendChartForm column typing', () => {
  it('treats numeric strings as measures', () => {
    const result = recommendChartForm(
      record([
        { payer: 'Aetna', claims: '1,204' },
        { payer: 'Cigna', claims: '318.5' },
      ]),
    );

    expect(result?.recommendation).toContain('sorted horizontal bars');
    expect(result?.shape).toContain('claims (numeric)');
  });

  it('treats ISO date strings as temporal', () => {
    const result = recommendChartForm(
      record([
        { bucket: '2024-01-15T00:00:00Z', claims: 10 },
        { bucket: '2024-02-15T00:00:00Z', claims: 12 },
      ]),
    );

    expect(result?.shape).toContain('bucket (temporal)');
    expect(result?.recommendation).toContain('line chart over bucket');
  });

  it('treats native Date values as temporal', () => {
    const result = recommendChartForm(
      record([
        { bucket: new Date('2024-01-15T00:00:00Z'), claims: 10 },
        { bucket: new Date('2024-02-15T00:00:00Z'), claims: 12 },
      ]),
    );

    expect(result?.shape).toContain('bucket (temporal)');
  });

  it('uses the column name to spot numeric periods like year', () => {
    const result = recommendChartForm(
      record([
        { year: 2022, claims: 10 },
        { year: 2023, claims: 12 },
      ]),
    );

    expect(result?.shape).toContain('year (temporal)');
    expect(result?.recommendation).toContain('line chart over year');
  });

  it('does not read a temporal name out of an unrelated word', () => {
    const result = recommendChartForm(
      record([
        { yearly_revenue: 100, birthday: 'x' },
        { yearly_revenue: 200, birthday: 'y' },
      ]),
    );

    expect(result?.shape).toContain('yearly_revenue (numeric)');
    expect(result?.shape).toContain('birthday (categorical');
  });

  it('ignores nulls when typing a column', () => {
    const result = recommendChartForm(
      record([
        { payer: 'Aetna', claims: 10 },
        { payer: null, claims: null },
        { payer: 'Cigna', claims: 12 },
      ]),
    );

    expect(result?.recommendation).toContain('sorted horizontal bars');
    expect(result?.shape).toContain('payer (categorical, 2 distinct)');
  });

  it('drops columns that are null in every sampled row', () => {
    const result = recommendChartForm(
      record([
        { payer: 'Aetna', claims: 10, notes: null },
        { payer: 'Cigna', claims: 12, notes: null },
      ]),
    );

    expect(result?.shape).not.toContain('notes');
    expect(result?.recommendation).toContain('sorted horizontal bars');
  });

  it('treats a mixed numeric/text column as categorical', () => {
    const result = recommendChartForm(
      record([
        { code: '10', claims: 5 },
        { code: 'n/a', claims: 7 },
      ]),
    );

    expect(result?.shape).toContain('code (categorical, 2 distinct)');
    expect(result?.recommendation).toContain('sorted horizontal bars');
  });
});

describe('recommendChartForm input handling', () => {
  it('returns nothing without chartable rows', () => {
    expect(recommendChartForm(undefined)).toBeUndefined();
    expect(recommendChartForm([])).toBeUndefined();
    expect(
      recommendChartForm([
        { tool: 'run_readonly_sql', error: 'boom', rowCount: 10 },
        { tool: 'run_readonly_sql', rows: [], rowCount: 0 },
      ]),
    ).toBeUndefined();
  });

  it('profiles the widest successful result set', () => {
    const result = recommendChartForm([
      { tool: 'run_readonly_sql', error: 'boom' },
      { tool: 'run_readonly_sql', rows: [{ total: 5 }], rowCount: 1 },
      ...record([
        { payer: 'Aetna', claims: 90 },
        { payer: 'Cigna', claims: 40 },
        { payer: 'Humana', claims: 20 },
      ]),
    ]);

    expect(result?.shape).toContain('3 rows');
    expect(result?.recommendation).toContain('sorted horizontal bars');
  });

  it('reports the full row count even when only a sample is stored', () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({
      month: `2024-01-${String((n % 28) + 1).padStart(2, '0')}`,
      claims: n,
    }));

    const result = recommendChartForm(record(rows, undefined, 4_000));

    expect(result?.shape).toContain('4000 rows');
  });
});

describe('recommendComposition', () => {
  /** Wide enough (two measures) and long enough (six rows) for a composition. */
  const wideRows = Array.from({ length: 6 }, (_, n) => ({
    month: `2024-0${n + 1}`,
    claims: n * 10,
    denials: n,
  }));

  it('composes when two queries succeeded', () => {
    const composition = recommendComposition([
      { tool: 'run_readonly_sql', rows: [{ total: 5 }], rowCount: 1 },
      ...record([
        { payer: 'Aetna', claims: 90 },
        { payer: 'Cigna', claims: 40 },
      ]),
    ]);

    expect(composition?.guidance).toContain('rests on 2 query results');
    expect(composition?.guidance).toContain('KPI tiles');
    expect(composition?.guidance).toContain('main chart');
    expect(composition?.guidance).toContain('collapsible detail table');
    expect(composition?.guidance).toContain('data-qti-value');
  });

  it('composes for one wide, reasonably long result set', () => {
    const composition = recommendComposition(record(wideRows));

    expect(composition?.guidance).toContain('2 measures over 6 rows');
    expect(composition?.measures).toEqual(['claims', 'denials']);
  });

  it('does not compose for a single thin result set', () => {
    expect(
      recommendComposition(
        record([
          { payer: 'Aetna', claims: 90 },
          { payer: 'Cigna', claims: 40 },
        ]),
      ),
    ).toBeUndefined();
  });

  it('composes for a single measure once there are enough rows', () => {
    const rows = Array.from({ length: 40 }, (_, n) => ({
      month: `2024-${n}`,
      claims: n,
    }));

    const composition = recommendComposition(record(rows));

    expect(composition?.measures).toEqual(['claims']);
    expect(composition?.guidance).toContain('1 measures over 40 rows');
  });

  it('does not compose for a single measure with too few rows', () => {
    const rows = Array.from({ length: 3 }, (_, n) => ({
      month: `2024-${n}`,
      claims: n,
    }));

    expect(recommendComposition(record(rows))).toBeUndefined();
  });

  it('does not compose for a short multi-measure result set', () => {
    expect(recommendComposition(record(wideRows.slice(0, 3)))).toBeUndefined();
  });

  it('does not compose for a single row of headline numbers', () => {
    expect(
      recommendComposition(record([{ total_claims: 1204, denied: 88 }])),
    ).toBeUndefined();
  });

  it('counts only successful, non-empty records as separate angles', () => {
    expect(
      recommendComposition([
        { tool: 'run_readonly_sql', error: 'boom', rowCount: 10 },
        { tool: 'run_readonly_sql', rows: [], rowCount: 0 },
        ...record([
          { payer: 'Aetna', claims: 90 },
          { payer: 'Cigna', claims: 40 },
        ]),
      ]),
    ).toBeUndefined();
  });

  it('counts the full row count, not just the stored sample', () => {
    const composition = recommendComposition(
      record(wideRows.slice(0, 3), undefined, 4_000),
    );

    expect(composition?.guidance).toContain('over 4000 rows');
  });

  it('returns nothing without chartable rows', () => {
    expect(recommendComposition(undefined)).toBeUndefined();
    expect(recommendComposition([])).toBeUndefined();
  });
});

describe('recommendedFormBlock', () => {
  it('wraps the recommendation in the designer prompt block', () => {
    const form = recommendedFormBlock(
      record([
        { payer: 'Aetna', claims: 90 },
        { payer: 'Cigna', claims: 40 },
      ]),
    );

    expect(form?.block).toContain('<recommended-form>');
    expect(form?.block).toContain('Data shape: 2 rows;');
    expect(form?.block).toContain('Recommended form: sorted horizontal bars');
    expect(form?.block).toContain(
      'if you deviate, say why in the description.',
    );
    expect(form?.block).toContain('</recommended-form>');
    expect(form?.block).not.toContain('Composed answer:');
    expect(form?.composed).toBe(false);
  });

  it('appends the composed paragraph and flags it when the data is rich', () => {
    const form = recommendedFormBlock(
      record(
        Array.from({ length: 8 }, (_, n) => ({
          month: `2024-0${n}`,
          claims: n * 10,
          denials: n,
        })),
      ),
    );

    expect(form?.composed).toBe(true);
    expect(form?.block).toContain(
      'Recommended form: a multi-series line chart',
    );
    expect(form?.block).toContain('Composed answer:');
    expect(form?.block).toContain('collapsible detail table');
    // Order matters: the composition builds on the form named above it.
    expect(form!.block.indexOf('Recommended form:')).toBeLessThan(
      form!.block.indexOf('Composed answer:'),
    );
  });

  it('is absent when there is nothing chartable', () => {
    expect(recommendedFormBlock([])).toBeUndefined();
  });
});

describe('deriveDashboardFilters', () => {
  it('keeps a categorical column with a modest cardinality', () => {
    const filters = deriveDashboardFilters([
      [
        {
          columns: ['payer', 'claims'],
          rows: [
            { payer: 'Aetna', claims: 90 },
            { payer: 'Cigna', claims: 40 },
            { payer: 'Aetna', claims: 12 },
          ],
        },
      ],
    ]);

    expect(filters).toEqual([{ column: 'payer', values: ['Aetna', 'Cigna'] }]);
  });

  it('drops a categorical column whose per-tile cardinality is too high', () => {
    const rows = Array.from({ length: 25 }, (_, n) => ({
      patient_id: `p${n}`,
      claims: n,
    }));
    const filters = deriveDashboardFilters([
      [{ columns: ['patient_id', 'claims'], rows }],
    ]);

    expect(filters).toEqual([]);
  });

  it('keeps a low-cardinality temporal column', () => {
    const filters = deriveDashboardFilters([
      [
        {
          columns: ['month', 'claims'],
          rows: [
            { month: '2024-01', claims: 10 },
            { month: '2024-02', claims: 20 },
            { month: '2024-03', claims: 5 },
          ],
        },
      ],
    ]);

    expect(filters).toEqual([
      { column: 'month', values: ['2024-01', '2024-02', '2024-03'] },
    ]);
  });

  it('excludes a purely numeric column', () => {
    const filters = deriveDashboardFilters([
      [
        {
          columns: ['claims', 'denials'],
          rows: [
            { claims: 90, denials: 4 },
            { claims: 40, denials: 1 },
          ],
        },
      ],
    ]);

    expect(filters).toEqual([]);
  });

  it('merges a column across tiles into the union of its values, sorted naturally', () => {
    const filters = deriveDashboardFilters([
      [
        {
          columns: ['payer', 'claims'],
          rows: [
            { payer: 'Payer 2', claims: 90 },
            { payer: 'Payer 10', claims: 40 },
          ],
        },
      ],
      [
        {
          columns: ['payer', 'denials'],
          rows: [
            { payer: 'Payer 2', denials: 2 },
            { payer: 'Payer 1', denials: 1 },
          ],
        },
      ],
    ]);

    expect(filters).toEqual([
      { column: 'payer', values: ['Payer 1', 'Payer 2', 'Payer 10'] },
    ]);
  });

  it('drops a column whose merged (union) values exceed the cap', () => {
    const tileA = Array.from({ length: 15 }, (_, n) => ({ payer: `P${n}` }));
    const tileB = Array.from({ length: 15 }, (_, n) => ({
      payer: `P${n + 15}`,
    }));
    const filters = deriveDashboardFilters([
      [{ columns: ['payer'], rows: tileA }],
      [{ columns: ['payer'], rows: tileB }],
    ]);

    expect(filters).toEqual([]);
  });

  it('sorts columns alphabetically', () => {
    const filters = deriveDashboardFilters([
      [
        {
          columns: ['payer', 'region', 'claims'],
          rows: [
            { payer: 'Aetna', region: 'West', claims: 1 },
            { payer: 'Cigna', region: 'East', claims: 2 },
          ],
        },
      ],
    ]);

    expect(filters.map((f) => f.column)).toEqual(['payer', 'region']);
  });

  it('returns nothing for empty or rowless input', () => {
    expect(deriveDashboardFilters([])).toEqual([]);
    expect(deriveDashboardFilters([[{ columns: ['payer'], rows: [] }]])).toEqual(
      [],
    );
  });
});
