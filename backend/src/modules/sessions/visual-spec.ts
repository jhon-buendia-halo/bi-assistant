import { z } from 'zod';

/**
 * Visual spec v1 — the small JSON document the designer agent emits instead of
 * freeform HTML/CSS/JavaScript. A fixed browser runtime (`visual-runtime.ts`)
 * renders it, so a visual can no longer break on a fumbled line of generated
 * code: the worst a bad spec can do is fail validation here, before anything is
 * written.
 *
 * Pure and dependency-free (zod only) so both the backend and the specs can use
 * it without pulling in the document pipeline.
 */

/** How a KPI tile reduces its column to one number. */
export const SPEC_AGGREGATIONS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'value',
] as const;

/** Number presentation the runtime applies. */
export const SPEC_FORMATS = [
  'number',
  'compact',
  'percent',
  'currency',
] as const;

/** Chart forms the runtime knows how to draw. */
export const SPEC_CHART_FORMS = [
  'bar',
  'line',
  'scatter',
  'heatmap',
  'metric-cards',
  'table',
  'donut',
] as const;

/** Forms that plot a category/measure pair and therefore need `x` and `y`. */
const XY_FORMS: ReadonlySet<string> = new Set([
  'bar',
  'line',
  'scatter',
  'heatmap',
  'donut',
]);

const columnName = z
  .string()
  .min(1)
  .max(128)
  .describe('Exact column name from the <data> block');

/** Columns that identify which result set to read (see `selectRecord`). */
const selectColumns = z
  .array(columnName)
  .min(1)
  .max(20)
  .describe(
    'Columns that must all be present in a result set for it to be the one this part reads',
  );

export const kpiSpecSchema = z.object({
  label: z.string().min(1).max(120).describe('Short tile label'),
  select: selectColumns,
  column: columnName.describe('Column the tile value is computed from'),
  agg: z.enum(SPEC_AGGREGATIONS).describe('How the column is reduced'),
  format: z.enum(SPEC_FORMATS).optional(),
  unit: z.string().max(16).optional().describe('Short unit suffix, e.g. "%"'),
});

/**
 * Explicit return type for the `chartSpecSchema` transform below. Without it
 * TS would infer the shape from the object literal the transform returns,
 * where `series`/`sort`/`format` are always-present (possibly `undefined`)
 * keys — turning every optional field into a required one for every caller
 * that builds a `ChartSpec` by hand (tests, `visualization-document.ts`).
 */
export interface ChartSpecShape {
  form: (typeof SPEC_CHART_FORMS)[number];
  select: string[];
  x?: string;
  y?: string | string[];
  series?: string;
  sort?: { by: 'x' | 'y' | string; dir: 'asc' | 'desc' };
  topN?: number;
  stacked?: boolean;
  labels?: boolean;
  format?: { y?: (typeof SPEC_FORMATS)[number] };
  xLabel?: string;
  yLabel?: string;
}

export const chartSpecSchema = z
  .object({
    form: z.enum(SPEC_CHART_FORMS),
    select: selectColumns,
    // `.nullable()`: models routinely send an explicit `null` — instead of
    // just omitting the key — to say "not applicable to this form". Accepting
    // it here and folding it to `undefined` in the transform below keeps
    // every existing `if (chart.x)` / `if (chart.series)` reader unchanged.
    x: columnName
      .nullable()
      .optional()
      .describe('Category / time axis column, or null when not applicable'),
    y: z
      .union([columnName, z.array(columnName).min(1).max(8)])
      .nullable()
      .optional()
      .describe(
        'Measure column, or several for a multi-series chart, or null when not applicable',
      ),
    series: columnName
      .nullable()
      .optional()
      .describe('Column that splits the data into series, or null when there is none'),
    sort: z
      .object({
        by: z
          .union([z.enum(['x', 'y']), columnName])
          .describe(
            '"x" or "y" to sort by that axis, or — since "by" reads as "by which column" — the exact column name being plotted; a measure column resolves to "y" and the x column resolves to "x"',
          ),
        dir: z.enum(['asc', 'desc']),
      })
      .optional(),
    topN: z.number().int().positive().max(200).optional(),
    stacked: z.boolean().optional(),
    labels: z.boolean().optional().describe('Draw value labels on the marks'),
    format: z
      .object({
        y: z
          .enum(SPEC_FORMATS)
          .nullable()
          .optional()
          .describe('Number format for the measure, or null for the default'),
      })
      .optional(),
    xLabel: z.string().max(120).optional(),
    yLabel: z.string().max(120).optional(),
  })
  .transform((chart): ChartSpecShape => {
    const x = chart.x ?? undefined;
    const y = chart.y ?? undefined;
    const measures = y === undefined ? [] : Array.isArray(y) ? y : [y];
    // `sort.by` is resolved here, at parse time, rather than left for
    // `validateSpecAgainstData`: it only needs the chart's own `x`/`y`, so a
    // column name that plainly means "the x axis" or "the y axis" is fixed up
    // silently instead of costing a whole retry. A column that matches
    // neither is left untouched — `validateSpecAgainstData` reports it in
    // plain language, and the runtime never sees anything but "x"/"y".
    let sort = chart.sort;
    if (sort && sort.by !== 'x' && sort.by !== 'y') {
      const by = sort.by === x ? 'x' : measures.includes(sort.by) ? 'y' : sort.by;
      sort = { ...sort, by };
    }
    return {
      ...chart,
      x,
      y,
      series: chart.series ?? undefined,
      sort,
      format: chart.format ? { y: chart.format.y ?? undefined } : undefined,
    };
  });

export const tableSpecSchema = z.object({
  select: selectColumns,
  columns: z
    .array(columnName)
    .min(1)
    .max(40)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined)
    .describe('Columns to show, or null to show every column'),
  collapsed: z.boolean().optional(),
});

export const visualSpecSchema = z.object({
  spec: z.literal(1).describe('Spec version; always 1'),
  kpis: z.array(kpiSpecSchema).max(4).optional(),
  chart: chartSpecSchema,
  table: tableSpecSchema.optional(),
});

export type KpiSpec = z.infer<typeof kpiSpecSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type TableSpec = z.infer<typeof tableSpecSchema>;
export type VisualSpec = z.infer<typeof visualSpecSchema>;

/** File the spec is persisted as inside a version directory. */
export const SPEC_FILENAME = 'spec.json';
/** Id of the inert JSON block the runtime reads the spec from. */
export const SPEC_SCRIPT_ID = 'qti-spec';
/** Element the runtime renders into. */
export const SPEC_ROOT_ID = 'qti-chart-root';
/** The whole body of a spec visual — the runtime fills it. */
export const SPEC_BODY_HTML = `<div id="${SPEC_ROOT_ID}"></div>`;
/** The document bootstrap: the runtime never auto-mounts. */
export const SPEC_BOOTSTRAP_SCRIPT = 'window.qtiChart.mount();';

/** Minimal shape of a result set the spec is validated against. */
export interface SpecDataRecord {
  columns?: string[];
  rows?: Record<string, unknown>[];
}

/** Rows sampled when deciding whether a column is numeric. */
const SAMPLE_ROWS = 50;

/** A record's columns: the declared list, else the keys of its first row. */
export function columnsOf(record: SpecDataRecord): string[] {
  if (record.columns?.length) return record.columns;
  return Object.keys(record.rows?.[0] ?? {});
}

/**
 * `select` semantics: the FIRST record whose columns contain every listed name.
 * Same rule the runtime applies, so validation and rendering can never disagree.
 */
export function selectRecord(
  records: SpecDataRecord[],
  select: string[],
): SpecDataRecord | undefined {
  return (records ?? []).find((record) => {
    const columns = columnsOf(record);
    return select.every((name) => columns.includes(name));
  });
}

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

/**
 * `Number(...)` with the coercions the runtime itself applies, so validation
 * and rendering agree on what counts as a measure: SQL drivers hand numbers
 * back as strings (`"4"`, `"1,204"`, `"12%"`), while `true` is not a measure
 * even though `Number(true)` is 1.
 */
function toNumberLike(value: unknown): number {
  if (typeof value === 'boolean') return NaN;
  if (typeof value === 'string') return Number(value.replace(/[$,\s%]/g, ''));
  return Number(value);
}

/** Numeric-ish: every non-blank sampled value survives the coercion above. */
function isNumericColumn(record: SpecDataRecord, column: string): boolean {
  return (record.rows ?? [])
    .slice(0, SAMPLE_ROWS)
    .map((row) => row[column])
    .filter((value) => !isBlank(value))
    .every((value) => Number.isFinite(toNumberLike(value)));
}

/**
 * Check a spec against the exact rows the visual will render from, and report
 * every problem in plain language. An empty array means the spec is renderable;
 * anything else is fed straight back to the designer as a retry instruction.
 */
export function validateSpecAgainstData(
  spec: VisualSpec,
  records: SpecDataRecord[],
): string[] {
  const problems: string[] = [];
  const available =
    (records ?? [])
      .map((record, index) => `#${index + 1} [${columnsOf(record).join(', ')}]`)
      .join('; ') || '(no result sets)';

  const resolve = (
    select: string[],
    where: string,
  ): SpecDataRecord | undefined => {
    const record = selectRecord(records, select);
    if (!record) {
      problems.push(
        `${where}: select [${select.join(', ')}] matches no result set — available column sets: ${available}`,
      );
    }
    return record;
  };

  const requireColumn = (
    record: SpecDataRecord,
    column: string,
    where: string,
  ): boolean => {
    const columns = columnsOf(record);
    if (columns.includes(column)) return true;
    problems.push(
      `${where}: column "${column}" is not in the selected result set [${columns.join(', ')}]`,
    );
    return false;
  };

  const requireNumeric = (
    record: SpecDataRecord,
    column: string,
    where: string,
  ): void => {
    if (isNumericColumn(record, column)) return;
    problems.push(
      `${where}: column "${column}" is not numeric in the sampled rows`,
    );
  };

  const chart = spec.chart;
  const measures =
    chart.y === undefined ? [] : Array.isArray(chart.y) ? chart.y : [chart.y];
  if (XY_FORMS.has(chart.form)) {
    if (!chart.x)
      problems.push(`chart: form "${chart.form}" needs an x column`);
    if (!measures.length) {
      problems.push(`chart: form "${chart.form}" needs a y column`);
    }
  }
  if (chart.form === 'heatmap' && !chart.series) {
    problems.push('chart: a heatmap needs a series column for its second axis');
  }
  // The schema already resolves a `sort.by` column name that matches `x` or a
  // plotted measure to "x"/"y" (see the `chartSpecSchema` transform); whatever
  // is left here named neither the x column nor a y measure, so it is reported
  // as a data problem instead of a parse-time rejection.
  if (chart.sort && chart.sort.by !== 'x' && chart.sort.by !== 'y') {
    problems.push(
      `chart.sort.by: "${chart.sort.by}" is not "x", "y", the x column, or a plotted y column`,
    );
  }

  const chartRecord = resolve(chart.select, 'chart');
  if (chartRecord) {
    if (chart.x && requireColumn(chartRecord, chart.x, 'chart.x')) {
      // Only a scatter puts x on a value scale; every other form treats it as
      // a category or a time label.
      if (chart.form === 'scatter') {
        requireNumeric(chartRecord, chart.x, 'chart.x');
      }
    }
    for (const measure of measures) {
      if (requireColumn(chartRecord, measure, 'chart.y')) {
        requireNumeric(chartRecord, measure, 'chart.y');
      }
    }
    if (chart.series) requireColumn(chartRecord, chart.series, 'chart.series');
  }

  (spec.kpis ?? []).forEach((kpi, index) => {
    const where = `kpis[${index}] ("${kpi.label}")`;
    const record = resolve(kpi.select, where);
    if (!record) return;
    if (requireColumn(record, kpi.column, where) && kpi.agg !== 'count') {
      requireNumeric(record, kpi.column, where);
    }
  });

  if (spec.table) {
    const record = resolve(spec.table.select, 'table');
    if (record) {
      for (const column of spec.table.columns ?? []) {
        requireColumn(record, column, 'table.columns');
      }
    }
  }

  return problems;
}
