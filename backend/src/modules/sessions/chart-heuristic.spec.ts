import {
  recommendChartForm,
  recommendComposition,
  recommendedFormBlock,
} from './chart-heuristic';
import type { ToolDataRecord } from './entities/session.entity';

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

  it('prefers grouped bars over a scatter for one label with few rows', () => {
    // A scatter of a handful of small values stacks points and looks broken.
    const result = recommendChartForm(
      record([
        { cost: 10, outcome: 3, plan: 'HMO' },
        { cost: 20, outcome: 6, plan: 'PPO' },
      ]),
    );

    expect(result?.recommendation).toContain('grouped bars');
    expect(result?.recommendation).toContain('one group per plan');
    expect(result?.recommendation).not.toContain('scatter');
  });

  it('colours the scatter plot by a category once there are enough rows', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      cost: 10 + i,
      outcome: 3 + i,
      plan: i % 2 ? 'HMO' : 'PPO',
    }));
    const result = recommendChartForm(record(rows));

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

const STATES = [
  'FL',
  'TX',
  'CA',
  'NY',
  'OH',
  'PA',
  'GA',
  'IL',
  'MI',
  'NC',
  'WA',
  'AZ',
];

const ALL_STATES =
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  );

function sql(rows: Record<string, unknown>[]): ToolDataRecord {
  return {
    tool: 'run_readonly_sql',
    input: 'SELECT 1',
    columns: Object.keys(rows[0]),
    rows,
    rowCount: rows.length,
  };
}

const election = sql(
  ['A', 'B', 'C'].map((plan, n) => ({
    election: 'Yes',
    plan_type: plan,
    n: n + 1,
  })),
);
const ageBands = sql(
  Array.from({ length: 12 }, (_, n) => ({
    age_band: `${20 + n * 5}-${24 + n * 5}`,
    total: 100 + n,
    hsa: 10 + n,
    ppo: 20 + n,
    na: n,
  })),
);
const states = sql(
  Array.from({ length: 45 }, (_, n) => ({
    state: ALL_STATES[n],
    employees: 1000 - n,
    avg_age: 40 + (n % 7),
    avg_income: 50000 + n,
    avg_tenure: 3 + (n % 5),
  })),
);
const totals = sql([
  {
    employees: 5000,
    avg_age: 41,
    avg_income: 61000,
    avg_tenure: 6,
    states: 45,
  },
]);

describe('state, pivot and dashboard advice', () => {
  it('recommends a map for a column of US states', () => {
    const result = recommendChartForm([
      sql(STATES.map((state, n) => ({ state, employees: 100 - n }))),
    ]);

    expect(result?.recommendation).toContain('us-map');
    expect(result?.recommendation).toContain('employees');
    expect(result?.recommendation).toContain('ranked bars');
  });

  it('keeps bars when the column holds only four states', () => {
    const result = recommendChartForm([
      sql(
        ['FL', 'TX', 'CA', 'NY'].map((state, n) => ({
          state,
          employees: 10 + n,
        })),
      ),
    ]);

    expect(result?.recommendation).toContain('sorted horizontal bars');
    expect(result?.recommendation).not.toContain('us-map');
  });

  it('keeps bars for a category that is not states', () => {
    const result = recommendChartForm([
      sql(
        Array.from({ length: 12 }, (_, n) => ({
          plan: `plan-${n}`,
          employees: n,
        })),
      ),
    ]);

    expect(result?.recommendation).toContain('sorted horizontal bars');
  });

  it('recommends a wide pivot for one label with three or more measures', () => {
    const result = recommendChartForm([ageBands]);

    expect(result?.recommendation).toContain('pivot');
    expect(result?.recommendation).toContain('age_band');
    expect(result?.recommendation).toContain('total, hsa, ppo and na');
    expect(result?.recommendation).not.toContain('sortable table');
  });

  it('offers a long pivot next to the heatmap for two labels', () => {
    const result = recommendChartForm([election]);

    expect(result?.recommendation).toContain('heatmap');
    expect(result?.recommendation).toContain('pivot (long shape)');
  });

  it('recommends panels for the four-set run, in run order', () => {
    const form = recommendedFormBlock([election, ageBands, states, totals]);
    const block = form!.block;

    expect(form!.composed).toBe(true);
    expect(block).toContain('<recommended-form>');
    expect(block).toContain('</recommended-form>');
    expect(block).toContain('Recommended form: panels');
    expect(block).toContain('if you deviate, say why in the description.');
    const at = [
      '[election, plan_type, n]',
      '[age_band, total, hsa, ppo, na]',
      '[state, employees, avg_age, avg_income, avg_tenure]',
      '[employees, avg_age, avg_income, avg_tenure, states]',
    ].map((columns) => block.indexOf(columns));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const line = (columns: string) =>
      block.split('\n').find((l) => l.includes(columns)) ?? '';
    expect(line('[age_band,')).toContain('12 rows');
    expect(line('[age_band,')).toContain('pivot');
    expect(line('[state,')).toContain('45 rows');
    expect(line('[state,')).toContain('us-map');
    expect(line('[employees,')).toContain('kpis');
    expect(line('[employees,')).not.toContain('panel as');
    expect(line('[state,')).toContain('panel as');
  });

  it('keeps one form plus tiles for one chart set and a single row', () => {
    const form = recommendedFormBlock([ageBands, totals]);

    expect(form!.block).not.toContain('panels');
    expect(form!.block).toContain('pivot');
    expect(form!.block).toContain('Composed answer:');
  });

  it('keeps the single-set advice for one result set', () => {
    const form = recommendedFormBlock(
      record([
        { payer: 'Aetna', claims: 90 },
        { payer: 'Cigna', claims: 40 },
      ]),
    );

    expect(form!.block).toContain('Recommended form: sorted horizontal bars');
    expect(form!.block).not.toContain('panels');
    expect(form!.composed).toBe(false);
  });

  it('lists at most eight sets for ten result sets', () => {
    const sets = Array.from({ length: 10 }, (_, n) =>
      sql([
        { [`label_${n}`]: 'a', [`value_${n}`]: 1 },
        { [`label_${n}`]: 'b', [`value_${n}`]: 2 },
      ]),
    );
    const block = recommendedFormBlock(sets)!.block;

    expect(block).toContain('Recommended form: panels');
    expect(block.match(/\[label_\d+, value_\d+\]/g)).toHaveLength(8);
    expect(block).toContain('[label_0, value_0]');
    expect(block).not.toContain('[label_9, value_9]');
  });
});
