import {
  panelSpecSchema,
  selectRecord,
  specCharts,
  validateSpecAgainstData,
  visualSpecSchema,
  type ChartSpec,
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

  it('rejects an empty select and a blank column name, and reports a missing chart at the data check', () => {
    const bare = visualSpecSchema.safeParse({ spec: 1 });
    expect(bare.success).toBe(true);
    expect(
      bare.success && validateSpecAgainstData(bare.data, [claims]),
    ).toEqual([
      'spec: needs a chart (a single visual) or at least one panel (a dashboard)',
    ]);
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

  it('accepts six KPI tiles, rejects seven and an unknown aggregation', () => {
    const kpi = {
      label: 'Claims',
      select: ['claims'],
      column: 'claims',
      agg: 'sum',
    };
    expect(
      visualSpecSchema.safeParse({
        ...spec(),
        kpis: [kpi, kpi, kpi, kpi, kpi, kpi],
      }).success,
    ).toBe(true);
    expect(
      visualSpecSchema.safeParse({
        ...spec(),
        kpis: [kpi, kpi, kpi, kpi, kpi, kpi, kpi],
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

  it('accepts an explicit null for series, x, y, format.y and table.columns and normalises to undefined', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      chart: {
        form: 'metric-cards',
        select: ['payer'],
        x: null,
        y: null,
        series: null,
        format: { y: null },
      },
      table: { select: ['payer'], columns: null },
    });

    expect(parsed.chart?.x).toBeUndefined();
    expect(parsed.chart?.y).toBeUndefined();
    expect(parsed.chart?.series).toBeUndefined();
    expect(parsed.chart?.format).toEqual({ y: undefined });
    expect(parsed.table?.columns).toBeUndefined();
  });

  it('resolves sort.by given a measure column to "y"', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: { by: 'claims', dir: 'desc' },
      },
    });

    expect(parsed.chart?.sort).toEqual({ by: 'y', dir: 'desc' });
  });

  it('resolves sort.by given a multi-measure column to "y"', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      chart: {
        form: 'line',
        select: ['month', 'claims', 'denials'],
        x: 'month',
        y: ['claims', 'denials'],
        sort: { by: 'denials', dir: 'asc' },
      },
    });

    expect(parsed.chart?.sort).toEqual({ by: 'y', dir: 'asc' });
  });

  it('resolves sort.by given the x column to "x"', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: { by: 'payer', dir: 'asc' },
      },
    });

    expect(parsed.chart?.sort).toEqual({ by: 'x', dir: 'asc' });
  });

  it('leaves the "x"/"y" literals untouched', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: { by: 'y', dir: 'desc' },
      },
    });

    expect(parsed.chart?.sort).toEqual({ by: 'y', dir: 'desc' });
  });

  it('leaves an unresolvable sort.by column name as-is instead of rejecting the spec', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: { by: 'denial_rate', dir: 'desc' },
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.chart?.sort).toEqual({
      by: 'denial_rate',
      dir: 'desc',
    });
  });

  it('drops the sort clause instead of failing when sort.by is null', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: { by: null, dir: 'desc' },
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.chart?.sort).toBeUndefined();
  });

  it('drops the sort clause instead of failing when sort itself is null', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: null,
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.chart?.sort).toBeUndefined();
  });

  it('drops the sort clause instead of failing when sort.dir is not "asc"/"desc"', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: {
        form: 'bar',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
        sort: { by: 'payer', dir: 'ascending' },
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.chart?.sort).toBeUndefined();
  });

  it('still rejects input that is not a spec at all, and leaves a spec with no chart to validateSpecAgainstData', () => {
    // Nothing parseable (the model returned nothing) keeps failing so the
    // retry/fallback path still runs.
    expect(visualSpecSchema.safeParse(undefined).success).toBe(false);
    expect(visualSpecSchema.safeParse({ chart: { form: 'bar' } }).success).toBe(
      false,
    );
    // A spec with neither chart nor panels parses; the data check reports it.
    const parsed = visualSpecSchema.safeParse({ spec: 1 });
    expect(parsed.success).toBe(true);
    expect(
      parsed.success && validateSpecAgainstData(parsed.data, [claims]),
    ).toHaveLength(1);
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

  it('reports a sort.by column that names neither the x column nor a y measure', () => {
    const problems = validateSpecAgainstData(
      spec({
        chart: {
          form: 'bar',
          select: ['payer', 'claims'],
          x: 'payer',
          y: 'claims',
          sort: { by: 'denial_rate', dir: 'desc' },
        },
      }),
      [claims],
    );

    expect(problems).toEqual([
      expect.stringContaining('chart.sort.by: "denial_rate" is not "x", "y"'),
    ]);
  });

  it('does not flag a resolved sort.by ("x"/"y")', () => {
    expect(
      validateSpecAgainstData(
        spec({
          chart: {
            form: 'bar',
            select: ['payer', 'claims'],
            x: 'payer',
            y: 'claims',
            sort: { by: 'y', dir: 'desc' },
          },
        }),
        [claims],
      ),
    ).toEqual([]);
  });
});

// The census run behind the dashboard: headline totals, an age band by plan
// type crosstab, a plan-election split, and employees by state.
const STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX',
]; // prettier-ignore

const election: SpecDataRecord = {
  columns: ['election', 'plan_type', 'n'],
  rows: [
    { election: 'Enrolled', plan_type: 'HSA', n: 412 },
    { election: 'Enrolled', plan_type: 'PPO', n: 655 },
    { election: 'Waived', plan_type: 'NA', n: 133 },
  ],
};

const ageBands: SpecDataRecord = {
  columns: ['age_band', 'total', 'hsa', 'ppo', 'na'],
  rows: Array.from({ length: 12 }, (_, i) => ({
    age_band: `${20 + i * 4}-${23 + i * 4}`,
    total: String(100 + i),
    hsa: 40 + i,
    ppo: 50,
    na: 10 + (i % 3),
  })),
};

const states: SpecDataRecord = {
  columns: ['state', 'employees', 'avg_age', 'avg_income', 'avg_tenure'],
  rows: STATE_CODES.slice(0, 43)
    .concat(['PR', 'DC'])
    .map((state, i) => ({
      state,
      employees: 262 - i,
      avg_age: 38.5,
      avg_income: '71,250',
      avg_tenure: 4.2,
    })),
};

const headline: SpecDataRecord = {
  columns: ['employees', 'avg_age', 'avg_income', 'avg_tenure', 'states'],
  rows: [
    {
      employees: 1200,
      avg_age: 39.1,
      avg_income: 70500,
      avg_tenure: 4.6,
      states: 45,
    },
  ],
};

const census = [election, ageBands, states, headline];

function panelsSpec(panels: unknown[]): VisualSpec {
  return visualSpecSchema.parse({ spec: 1, panels });
}

const pivotChart: ChartSpec = {
  form: 'pivot',
  select: ['election', 'plan_type', 'n'],
  x: 'election',
  y: 'n',
  series: 'plan_type',
} as const;

const mapChart: ChartSpec = {
  form: 'us-map',
  select: ['state', 'employees'],
  x: 'state',
  y: 'employees',
} as const;

describe('panelSpecSchema and visualSpecSchema panels', () => {
  const chart = { form: 'bar', select: ['a'], x: 'a', y: 'b' };

  it('parses a panels spec', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      panels: [
        { title: 'Plans', span: 4, chart: pivotChart },
        { title: 'States', span: 8, chart: mapChart },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.panels).toHaveLength(2);
    expect(parsed.success && parsed.data.chart).toBeUndefined();
  });

  it.each([3, 6, 12])('accepts a span of %i', (span) => {
    expect(panelSpecSchema.safeParse({ title: 'T', span, chart }).success).toBe(
      true,
    );
  });

  it.each([2, 13, 0, -4, 4.5])('rejects a span of %p', (span) => {
    expect(panelSpecSchema.safeParse({ title: 'T', span, chart }).success).toBe(
      false,
    );
  });

  it('rejects a blank panel title', () => {
    expect(panelSpecSchema.safeParse({ title: '', chart }).success).toBe(false);
  });

  it('accepts eight panels and rejects nine', () => {
    const panel = { title: 'T', chart };
    expect(
      visualSpecSchema.safeParse({ spec: 1, panels: Array(8).fill(panel) })
        .success,
    ).toBe(true);
    expect(
      visualSpecSchema.safeParse({ spec: 1, panels: Array(9).fill(panel) })
        .success,
    ).toBe(false);
  });

  it('accepts null for chart, panels, span, category and totals', () => {
    const parsed = visualSpecSchema.safeParse({
      spec: 1,
      chart: null,
      panels: [
        {
          title: 'Plans',
          span: null,
          chart: { ...pivotChart, totals: null },
        },
      ],
      kpis: [
        {
          label: 'Top state',
          select: ['state', 'employees'],
          column: 'employees',
          agg: 'max',
          category: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);

    const second = visualSpecSchema.safeParse({
      spec: 1,
      chart: { ...pivotChart, totals: null },
      panels: null,
    });
    expect(second.success).toBe(true);
    expect(second.success && second.data.chart?.totals).toBeUndefined();
  });

  it('keeps chart, panels, span, category and totals optional on a hand-built spec', () => {
    const chartOnly: VisualSpec = {
      spec: 1,
      chart: { form: 'bar', select: ['a'], x: 'a', y: 'b' },
    };
    const panelOnly: VisualSpec = {
      spec: 1,
      panels: [{ title: 'T', chart: { form: 'pivot', select: ['a'] } }],
      kpis: [{ label: 'K', select: ['a'], column: 'a', agg: 'sum' }],
    };

    expect(chartOnly.panels).toBeUndefined();
    expect(panelOnly.chart).toBeUndefined();
  });

  it('keeps the pivot totals flag', () => {
    const parsed = visualSpecSchema.parse({
      spec: 1,
      chart: { ...pivotChart, totals: false },
    });
    expect(parsed.chart?.totals).toBe(false);
  });
});

describe('specCharts', () => {
  const chart: ChartSpec = {
    form: 'bar',
    select: ['a'],
    x: 'a',
    y: 'b',
  };

  it('names a single chart "chart"', () => {
    expect(specCharts({ chart })).toEqual([{ where: 'chart', chart }]);
  });

  it('names each panel by index and title', () => {
    const result = specCharts({
      panels: [
        { title: 'Plans', chart },
        { title: 'States', span: 8, chart },
      ],
    });

    expect(result.map((entry) => entry.where)).toEqual([
      'panels[0] ("Plans")',
      'panels[1] ("States")',
    ]);
    expect(result.map((entry) => entry.title)).toEqual(['Plans', 'States']);
  });

  it('returns nothing when neither chart nor panels is given', () => {
    expect(specCharts({})).toEqual([]);
    expect(specCharts({ chart: null, panels: null })).toEqual([]);
  });

  it('falls back to chart when panels is an empty array', () => {
    expect(specCharts({ chart, panels: [] })).toEqual([
      { where: 'chart', chart },
    ]);
    expect(specCharts({ panels: [] })).toEqual([]);
  });
});

describe('validateSpecAgainstData with panels', () => {
  it('reports giving both chart and panels as one problem', () => {
    const problems = validateSpecAgainstData(
      {
        spec: 1,
        chart: pivotChart,
        panels: [{ title: 'Plans', chart: pivotChart }],
      },
      census,
    );

    expect(problems).toEqual([
      'spec: give either chart (a single visual) or panels (a dashboard), not both',
    ]);
  });

  it('reports giving neither as one problem', () => {
    expect(validateSpecAgainstData({ spec: 1 }, census)).toEqual([
      'spec: needs a chart (a single visual) or at least one panel (a dashboard)',
    ]);
    expect(
      validateSpecAgainstData({ spec: 1, chart: null, panels: [] }, census),
    ).toHaveLength(1);
  });

  it('passes a three-panel spec over three result sets', () => {
    const dashboard = panelsSpec([
      { title: 'Plan election', span: 4, chart: pivotChart },
      {
        title: 'Age band by plan',
        span: 8,
        chart: {
          form: 'pivot',
          select: ['age_band', 'hsa'],
          x: 'age_band',
          y: ['total', 'hsa', 'ppo', 'na'],
        },
      },
      { title: 'Employees by state', span: 12, chart: mapChart },
    ]);

    expect(validateSpecAgainstData(dashboard, census)).toEqual([]);
  });

  it('reports every per-chart rule under the panel prefix', () => {
    const dashboard = panelsSpec([
      {
        title: 'Missing column',
        chart: {
          form: 'bar',
          select: ['age_band', 'total'],
          x: 'age_band',
          y: 'nope',
        },
      },
      {
        title: 'Text measure',
        chart: {
          form: 'bar',
          select: ['election', 'plan_type'],
          x: 'election',
          y: 'plan_type',
        },
      },
      {
        title: 'Lost select',
        chart: { form: 'bar', select: ['zip'], x: 'zip', y: 'n' },
      },
    ]);

    const problems = validateSpecAgainstData(dashboard, census);

    expect(problems).toEqual([
      expect.stringContaining(
        'panels[0] ("Missing column").y: column "nope" is not in the selected result set',
      ),
      expect.stringContaining(
        'panels[1] ("Text measure").y: column "plan_type" is not numeric',
      ),
      expect.stringContaining(
        'panels[2] ("Lost select"): select [zip] matches no result set',
      ),
    ]);
  });

  it('still checks kpis and the table next to panels', () => {
    const problems = validateSpecAgainstData(
      {
        ...panelsSpec([{ title: 'Map', chart: mapChart }]),
        kpis: [
          {
            label: 'Employees',
            select: ['employees', 'states'],
            column: 'employees',
            agg: 'value',
          },
        ],
        table: { select: ['state'], columns: ['state', 'ghost'] },
      },
      census,
    );

    expect(problems).toEqual([
      expect.stringContaining('table.columns: column "ghost"'),
    ]);
  });
});

describe('validateSpecAgainstData pivot', () => {
  const check = (chart: object) =>
    validateSpecAgainstData(visualSpecSchema.parse({ spec: 1, chart }), census);

  it('needs x and y', () => {
    expect(check({ form: 'pivot', select: ['election', 'n'] })).toEqual([
      'chart: form "pivot" needs an x column',
      'chart: form "pivot" needs a y column',
    ]);
  });

  it('accepts the long shape: one series column and one measure', () => {
    expect(check(pivotChart)).toEqual([]);
  });

  it('accepts the wide shape: no series and several measures', () => {
    expect(
      check({
        form: 'pivot',
        select: ['age_band', 'total'],
        x: 'age_band',
        y: ['hsa', 'ppo', 'na'],
        sort: { by: 'y', dir: 'desc' },
        totals: false,
      }),
    ).toEqual([]);
  });

  it('reports a series together with several measures', () => {
    expect(
      check({
        form: 'pivot',
        select: ['age_band', 'hsa'],
        x: 'age_band',
        series: 'age_band',
        y: ['hsa', 'ppo'],
      }),
    ).toEqual([
      'chart: a pivot with a series column takes one y measure; drop series to show several measures as the columns',
    ]);
  });

  it('reports a series column that is not in the result set', () => {
    expect(check({ ...pivotChart, series: 'region' })).toEqual([
      expect.stringContaining('chart.series: column "region"'),
    ]);
  });
});

describe('validateSpecAgainstData us-map', () => {
  const check = (data: SpecDataRecord[], chart: object) =>
    validateSpecAgainstData(visualSpecSchema.parse({ spec: 1, chart }), data);

  it('accepts a column of state codes, including PR and DC', () => {
    expect(states.rows?.map((row) => row.state)).toEqual(
      expect.arrayContaining(['PR', 'DC']),
    );
    expect(states.rows).toHaveLength(45);
    expect(check(census, mapChart)).toEqual([]);
  });

  it('accepts a column of full state names in any case', () => {
    const named: SpecDataRecord = {
      columns: ['state', 'employees'],
      rows: [
        { state: 'Florida', employees: 262 },
        { state: 'new york', employees: 240 },
        { state: 'District of Columbia', employees: 12 },
        { state: 'Washington, D.C.', employees: 3 },
        { state: ' Texas ', employees: 199 },
      ],
    };

    expect(check([named], mapChart)).toEqual([]);
  });

  it('reports a column where under 60% of the values name a state, and says to use a bar', () => {
    const mixed: SpecDataRecord = {
      columns: ['state', 'employees'],
      rows: [
        { state: 'FL', employees: 1 },
        { state: 'TX', employees: 2 },
        { state: 'Remote', employees: 3 },
        { state: 'Unknown', employees: 4 },
        { state: 'Other', employees: 5 },
      ],
    };

    const problems = check([mixed], mapChart);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('chart.x');
    expect(problems[0]).toContain('use a bar instead');
  });

  it('accepts a column where exactly 60% of the values name a state', () => {
    const edge: SpecDataRecord = {
      columns: ['state', 'employees'],
      rows: [
        { state: 'FL', employees: 1 },
        { state: 'TX', employees: 2 },
        { state: 'CA', employees: 3 },
        { state: 'Remote', employees: 4 },
        { state: 'Other', employees: 5 },
      ],
    };

    expect(check([edge], mapChart)).toEqual([]);
  });

  it('reports a column that is a payer name instead of a state', () => {
    expect(
      check([claims], {
        form: 'us-map',
        select: ['payer', 'claims'],
        x: 'payer',
        y: 'claims',
      }),
    ).toEqual([expect.stringContaining('use a bar instead')]);
  });

  it('reports a column that is all blank', () => {
    const blank: SpecDataRecord = {
      columns: ['state', 'employees'],
      rows: [
        { state: null, employees: 1 },
        { state: '', employees: 2 },
        { state: '  ', employees: 3 },
      ],
    };

    expect(check([blank], mapChart)).toEqual([
      expect.stringContaining('use a bar instead'),
    ]);
  });

  it('needs a numeric y', () => {
    expect(
      check(census, { ...mapChart, y: 'state', select: ['state'] }),
    ).toEqual(['chart.y: column "state" is not numeric in the sampled rows']);
  });

  it('needs x and y', () => {
    expect(check(census, { form: 'us-map', select: ['state'] })).toEqual([
      'chart: form "us-map" needs an x column',
      'chart: form "us-map" needs a y column',
    ]);
  });
});

describe('validateSpecAgainstData kpi.category', () => {
  const kpi = (extra: Record<string, unknown>) =>
    visualSpecSchema.parse({
      spec: 1,
      chart: mapChart,
      kpis: [
        {
          label: 'Top state',
          select: ['state', 'employees'],
          column: 'employees',
          agg: 'max',
          ...extra,
        },
      ],
    });

  it.each(['max', 'min', 'value'])('is fine with agg %s', (agg) => {
    expect(
      validateSpecAgainstData(kpi({ agg, category: 'state' }), census),
    ).toEqual([]);
  });

  it('reports a category column missing from the selected result set', () => {
    expect(
      validateSpecAgainstData(kpi({ category: 'region' }), census),
    ).toEqual([
      'kpis[0] ("Top state").category: column "region" is not in the selected result set [state, employees, avg_age, avg_income, avg_tenure]',
    ]);
  });

  it('reports a category with agg sum', () => {
    expect(
      validateSpecAgainstData(kpi({ agg: 'sum', category: 'state' }), census),
    ).toEqual([
      'kpis[0] ("Top state"): category only goes with agg "max", "min" or "value", not "sum"',
    ]);
  });

  it('ignores a null category', () => {
    expect(
      validateSpecAgainstData(kpi({ agg: 'sum', category: null }), census),
    ).toEqual([]);
  });
});
