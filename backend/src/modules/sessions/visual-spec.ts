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
  'pivot',
  'us-map',
] as const;

/** KPI tiles a spec may carry. */
export const SPEC_MAX_KPIS = 6;
/** Panels a dashboard spec may carry. */
export const SPEC_MAX_PANELS = 8;
/** A panel's width in the 12-column grid: narrowest, widest, and when omitted. */
export const SPEC_PANEL_SPAN = { min: 3, max: 12, default: 6 } as const;
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
  // `.nullish()` with no transform, here and on the fields below: a transform
  // would make the key required in the inferred type, breaking every caller
  // that builds a spec by hand. Readers treat null like an absent key.
  category: columnName
    .nullish()
    .describe(
      'Only with agg max, min or value: the column that names the row the figure comes from, shown before it ("FL · 262"); null otherwise',
    ),
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
  /** `by` is 'x', 'y' or a column name (resolved to 'x'/'y' where it matches one). */
  sort?: { by: string; dir: 'asc' | 'desc' };
  topN?: number;
  stacked?: boolean;
  labels?: boolean;
  format?: { y?: (typeof SPEC_FORMATS)[number] };
  xLabel?: string;
  yLabel?: string;
  /** `pivot` only; `undefined` reads as true. */
  totals?: boolean;
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
      .describe(
        'Column that splits the data into series, or null when there is none',
      ),
    sort: z
      .object({
        by: z
          .union([z.enum(['x', 'y']), columnName])
          .describe(
            '"x" or "y" to sort by that axis, or — since "by" reads as "by which column" — the exact column name being plotted; a measure column resolves to "y" and the x column resolves to "x"',
          ),
        dir: z.enum(['asc', 'desc']),
      })
      .optional()
      // `.catch(undefined)`: a malformed sort clause — `by` sent as `null` or
      // some other non-string (VDI diagnostics showed models doing exactly
      // this), `dir` outside "asc"/"desc", or `sort` itself sent as `null` —
      // is dropped instead of failing the whole spec. Sorting is a nice-to-
      // have the runtime works fine without, unlike `title`/`description`/
      // `chart`, which stay required. Validation-side only: `.catch()` does
      // not change the JSON schema shown to the model (confirmed against
      // `z.toJSONSchema`), so the model still sees `by`/`dir` as required
      // strings and only malformed responses take this path.
      .catch(undefined),
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
    totals: z
      .boolean()
      .nullish()
      .describe(
        'pivot only: draw the Total row (and the Total column when series is set); default true',
      ),
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
      const by =
        sort.by === x ? 'x' : measures.includes(sort.by) ? 'y' : sort.by;
      sort = { ...sort, by };
    }
    return {
      ...chart,
      x,
      y,
      series: chart.series ?? undefined,
      sort,
      format: chart.format ? { y: chart.format.y ?? undefined } : undefined,
      totals: chart.totals ?? undefined,
    };
  });

/** One chart of a dashboard: a titled card in the 12-column grid. */
export const panelSpecSchema = z.object({
  title: z.string().min(1).max(120).describe('Short panel heading'),
  span: z
    .number()
    .int()
    .min(SPEC_PANEL_SPAN.min)
    .max(SPEC_PANEL_SPAN.max)
    .nullish()
    .describe(
      'Width in a 12-column grid, 3 to 12; panels wrap in order. Null for the default, 6',
    ),
  chart: chartSpecSchema,
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

/**
 * A spec draws either one `chart` (a single visual) or `panels` (a dashboard
 * of several charts). Which of the two is present is checked by
 * `validateSpecAgainstData`, not here, so a spec with neither or both comes
 * back to the designer as a plain-language problem like every other one.
 */
export const visualSpecSchema = z.object({
  spec: z.literal(1).describe('Spec version; always 1'),
  kpis: z.array(kpiSpecSchema).max(SPEC_MAX_KPIS).optional(),
  chart: chartSpecSchema
    .nullish()
    .describe('The one chart of a single visual; null when panels is given'),
  panels: z
    .array(panelSpecSchema)
    .max(SPEC_MAX_PANELS)
    .nullish()
    .describe(
      'The charts of a dashboard, in reading order; null when chart is given',
    ),
  table: tableSpecSchema.optional(),
});

export type KpiSpec = z.infer<typeof kpiSpecSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type PanelSpec = z.infer<typeof panelSpecSchema>;
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

/**
 * Every chart a spec draws, with the name its problems are reported under:
 * `chart` for a single visual, `panels[i] ("<title>")` for a dashboard's.
 */
export function specCharts(
  spec: Pick<VisualSpec, 'chart' | 'panels'>,
): { where: string; title?: string; chart: ChartSpec }[] {
  if (spec.panels?.length) {
    return spec.panels.map((panel, index) => ({
      where: `panels[${index}] ("${panel.title}")`,
      title: panel.title,
      chart: panel.chart,
    }));
  }
  return spec.chart ? [{ where: 'chart', chart: spec.chart }] : [];
}
