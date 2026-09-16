import { recommendChartForm, recommendedFormBlock } from './chart-heuristic';
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

describe('recommendedFormBlock', () => {
  it('wraps the recommendation in the designer prompt block', () => {
    const block = recommendedFormBlock(
      record([
        { payer: 'Aetna', claims: 90 },
        { payer: 'Cigna', claims: 40 },
      ]),
    );

    expect(block).toContain('<recommended-form>');
    expect(block).toContain('Data shape: 2 rows;');
    expect(block).toContain('Recommended form: sorted horizontal bars');
    expect(block).toContain('if you deviate, say why in the description.');
    expect(block).toContain('</recommended-form>');
  });

  it('is absent when there is nothing chartable', () => {
    expect(recommendedFormBlock([])).toBeUndefined();
  });
});
