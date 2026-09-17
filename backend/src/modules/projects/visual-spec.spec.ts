import {
  selectRecord,
  validateSpecAgainstData,
  visualSpecSchema,
  type SpecDataRecord,
  type VisualSpec,
} from './visual-spec';

const claims: SpecDataRecord = {
  columns: ['payer', 'claims', 'denial_rate'],
  rows: [
    { payer: 'Aetna', claims: '120', denial_rate: 4.5 },
    { payer: 'Cigna', claims: 90, denial_rate: 6.1 },
    { payer: 'Humana', claims: 45, denial_rate: null },
  ],
};

const totals: SpecDataRecord = {
  columns: ['total_claims', 'note'],
  rows: [{ total_claims: 255, note: 'all payers' }],
};

function spec(partial: Partial<VisualSpec> = {}): VisualSpec {
  return {
    spec: 1,
    chart: {
      form: 'bar',
      select: ['payer', 'claims'],
      x: 'payer',
      y: 'claims',
    },
    ...partial,
  };
}

describe('visualSpecSchema', () => {
  it('accepts a minimal chart-only spec', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: { form: 'bar', select: ['payer'], x: 'payer', y: 'claims' },
    });

    expect(parsed.success).toBe(true);
  });

  it('strips unknown keys instead of failing', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      nonsense: true,
      chart: {
        form: 'line',
        select: ['month'],
        x: 'month',
        y: 'n',
        colour: 'red',
      },
    });

    expect(parsed).not.toHaveProperty('nonsense');
    expect(parsed.chart).not.toHaveProperty('colour');
  });

  it('rejects an unknown chart form', () => {
    expect(
      visualSpecSchema.safeParse({
        spec: 1,
        chart: { form: 'sankey', select: ['a'] },
      }).success,
    ).toBe(false);
  });

  it('rejects a spec version other than 1', () => {
    expect(
      visualSpecSchema.safeParse({
        spec: 2,
        chart: { form: 'bar', select: ['a'] },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing chart, an empty select, and a blank column name', () => {
    expect(visualSpecSchema.safeParse({ spec: 1 }).success).toBe(false);
    expect(
      visualSpecSchema.safeParse({
        spec: 1,
        chart: { form: 'bar', select: [] },
      }).success,
    ).toBe(false);
    expect(
      visualSpecSchema.safeParse({
        spec: 1,
        chart: { form: 'bar', select: [''] },
      }).success,
    ).toBe(false);
  });

  it('rejects more than four KPI tiles and an unknown aggregation', () => {
    const kpi = {
      label: 'Claims',
      select: ['claims'],
      column: 'claims',
      agg: 'sum',
    };
    expect(
      visualSpecSchema.safeParse({
        ...spec(),
        kpis: [kpi, kpi, kpi, kpi, kpi],
      }).success,
    ).toBe(false);
    expect(
      visualSpecSchema.safeParse({
        ...spec(),
        kpis: [{ ...kpi, agg: 'median' }],
      }).success,
    ).toBe(false);
  });

  it('accepts several measures on y and a sort/topN/format block', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: {
        form: 'line',
        select: ['month', 'claims', 'denials'],
        x: 'month',
        y: ['claims', 'denials'],
        sort: { by: 'x', dir: 'asc' },
        topN: 8,
        stacked: false,
        labels: true,
        format: { y: 'compact' },
        xLabel: 'Month',
        yLabel: 'Claims',
      },
      table: { select: ['month'], columns: ['month'], collapsed: true },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects a non-integer topN', () => {
    expect(
      visualSpecSchema.safeParse({
        spec: 1,
        chart: { form: 'bar', select: ['a'], x: 'a', y: 'b', topN: 2.5 },
      }).success,
    ).toBe(false);
  });
});

describe('selectRecord', () => {
  it('returns the first record carrying every listed column', () => {
    expect(selectRecord([totals, claims], ['payer', 'claims'])).toBe(claims);
    expect(selectRecord([totals, claims], ['total_claims'])).toBe(totals);
  });

  it('falls back to the first row keys when columns are absent', () => {
    const record: SpecDataRecord = { rows: [{ a: 1, b: 2 }] };

    expect(selectRecord([record], ['a', 'b'])).toBe(record);
    expect(selectRecord([record], ['c'])).toBeUndefined();
  });

  it('returns undefined when no record carries all the columns', () => {
    expect(
      selectRecord([totals, claims], ['payer', 'total_claims']),
    ).toBeUndefined();
  });
});

describe('validateSpecAgainstData', () => {
  it('passes a spec that matches the data', () => {
    expect(validateSpecAgainstData(spec(), [claims])).toEqual([]);
  });

  it('reports a select that matches no record, naming the available columns', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: {
          form: 'bar',
          select: ['provider'],
          x: 'provider',
          y: 'claims',
        },
      }),
      [claims],
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('select [provider] matches no result set');
    expect(problems[0]).toContain('payer, claims, denial_rate');
  });

  it('reports x, y and series columns absent from the selected record', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: {
          form: 'bar',
          select: ['payer'],
          x: 'plan',
          y: 'amount',
          series: 'region',
        },
      }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining('chart.x: column "plan" is not in the selected'),
      expect.stringContaining(
        'chart.y: column "amount" is not in the selected',
      ),
      expect.stringContaining(
        'chart.series: column "region" is not in the selected',
      ),
    ]);
  });

  it('reports a non-numeric y column', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: { form: 'bar', select: ['payer'], x: 'claims', y: 'payer' },
      }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining('chart.y: column "payer" is not numeric'),
    ]);
  });

  it('accepts numeric values arriving as strings, and ignores null cells', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: {
          form: 'line',
          select: ['payer'],
          x: 'payer',
          y: ['claims', 'denial_rate'],
        },
      }),
      [claims],
    );

    expect(problems).toEqual([]);
  });

  it('counts formatted numbers as numeric and booleans as not, like the runtime', () => {
    const formatted: SpecDataRecord = {
      columns: ['label', 'amount', 'flag'],
      rows: [
        { label: 'a', amount: '1,204', flag: true },
        { label: 'b', amount: '$38.20', flag: false },
        { label: 'c', amount: '12%', flag: true },
      ],
    };

    expect(
      validateSpecAgainstData(
        spec({
          chart: { form: 'bar', select: ['label'], x: 'label', y: 'amount' },
        }),
        [formatted],
      ),
    ).toEqual([]);
    expect(
      validateSpecAgainstData(
        spec({
          chart: { form: 'bar', select: ['label'], x: 'label', y: 'flag' },
        }),
        [formatted],
      ),
    ).toEqual([expect.stringContaining('"flag" is not numeric')]);
  });

  it('requires a numeric x for a scatter but not for a bar', () => {
    const scatter = spec({
      chart: {
        form: 'scatter',
        select: ['payer'],
        x: 'payer',
        y: 'denial_rate',
      },
    });

    expect(validateSpecAgainstData(scatter, [claims])).toEqual([
      expect.stringContaining('chart.x: column "payer" is not numeric'),
    ]);
    expect(
      validateSpecAgainstData(
        spec({
          chart: {
            form: 'scatter',
            select: ['payer'],
            x: 'claims',
            y: 'denial_rate',
          },
        }),
        [claims],
      ),
    ).toEqual([]);
  });

  it('requires a series on a heatmap', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: {
          form: 'heatmap',
          select: ['payer'],
          x: 'payer',
          y: 'claims',
        },
      }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining('a heatmap needs a series column'),
    ]);
  });

  it('requires x and y on the plotting forms', () => {
    const problems = validateSpecAgainstData(
      spec({ chart: { form: 'bar', select: ['payer'] } }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining('needs an x column'),
      expect.stringContaining('needs a y column'),
    ]);
  });

  it('asks nothing of x and y for a table or metric-cards form', () => {
    expect(
      validateSpecAgainstData(
        spec({ chart: { form: 'table', select: ['payer'] } }),
        [claims],
      ),
    ).toEqual([]);
    expect(
      validateSpecAgainstData(
        spec({ chart: { form: 'metric-cards', select: ['total_claims'] } }),
        [totals],
      ),
    ).toEqual([]);
  });

  it('checks each KPI against its own selected record', () => {
    const problems = validateSpecAgainstData(
      spec({
        kpis: [
          {
            label: 'Total claims',
            select: ['total_claims'],
            column: 'total_claims',
            agg: 'value',
          },
          {
            label: 'Payers',
            select: ['payer'],
            column: 'payer',
            agg: 'count',
          },
          {
            label: 'Broken',
            select: ['payer'],
            column: 'missing_column',
            agg: 'sum',
          },
        ],
      }),
      [claims, totals],
    );

    expect(problems).toEqual([
      expect.stringContaining(
        'kpis[2] ("Broken"): column "missing_column" is not in the selected',
      ),
    ]);
  });

  it('rejects a non-numeric KPI column unless the aggregation is count', () => {
    const problems = validateSpecAgainstData(
      spec({
        kpis: [
          { label: 'Payer', select: ['payer'], column: 'payer', agg: 'sum' },
        ],
      }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining(
        'kpis[0] ("Payer"): column "payer" is not numeric',
      ),
    ]);
  });

  it('checks the detail table select and its listed columns', () => {
    const problems = validateSpecAgainstData(
      spec({
        table: { select: ['payer'], columns: ['payer', 'plan_id'] },
      }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining(
        'table.columns: column "plan_id" is not in the selected',
      ),
    ]);
  });

  it('reports every problem at once, not just the first', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: { form: 'bar', select: ['payer'], x: 'nope', y: 'payer' },
        kpis: [{ label: 'A', select: ['ghost'], column: 'ghost', agg: 'sum' }],
        table: { select: ['payer'], columns: ['ghost'] },
      }),
      [claims],
    );

    expect(problems).toHaveLength(4);
  });

  it('reports the empty data case rather than silently passing', () => {
    const problems = validateSpecAgainstData(spec(), []);

    expect(problems).toEqual([expect.stringContaining('(no result sets)')]);
  });
});
