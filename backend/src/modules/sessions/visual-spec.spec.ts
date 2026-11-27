import {
  panelSpecSchema,
  selectRecord,
  specCharts,
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

  it('rejects an empty select and a blank column name', () => {
    expect(visualSpecSchema.safeParse({ spec: 1 }).success).toBe(true);
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

  it('still rejects input that is not a spec at all, and parses a spec with no chart', () => {
    // Nothing parseable (the model returned nothing) keeps failing so the
    // retry/fallback path still runs.
    expect(visualSpecSchema.safeParse(undefined).success).toBe(false);
    expect(visualSpecSchema.safeParse({ chart: { form: 'bar' } }).success).toBe(
      false,
    );
    // A spec with neither chart nor panels parses (a stored one still reads).
    expect(visualSpecSchema.safeParse({ spec: 1 }).success).toBe(true);
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
