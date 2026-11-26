/**
 * The dashboard as data (the blueprint): what a stored dashboard artifact
 * holds (data-model 3.18), what the fixed runtime
 * (./dashboard-blueprint.runtime.ts) draws, and what Consumption Gap
 * Analysis and the BI Analyst's dashboards build on. Zod only, no framework
 * import, so Jest and the catalogue can load it without Mastra.
 */
import { z } from 'zod';

/** The kinds of control a dashboard filters with. */
export const BLUEPRINT_FILTER_KINDS = [
  'select',
  'multi-select',
  'date-range',
  'search',
  'toggle',
  'tabs',
  'other',
] as const;

/** The kinds of widget a dashboard shows. */
export const BLUEPRINT_WIDGET_KINDS = [
  'kpi',
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'table',
  'scatter',
  'heatmap',
  'map',
  'gauge',
  'funnel',
  'text',
  'other',
] as const;

/** How a measure folds the rows of its column. */
export const BLUEPRINT_AGGREGATIONS = [
  'sum',
  'avg',
  'count',
  'min',
  'max',
] as const;

/** How a measure's value is written. */
export const BLUEPRINT_FORMATS = [
  'number',
  'currency',
  'percent',
  'compact',
] as const;

/** The types of a mock dataset's column. */
export const BLUEPRINT_COLUMN_TYPES = [
  'string',
  'number',
  'date',
  'boolean',
] as const;

/** One control of the dashboard that narrows what its widgets show. */
export const blueprintFilterSchema = z.object({
  id: z.string().describe('A short kebab-case id, unique among filters.'),
  label: z.string().describe('The label the dashboard shows.'),
  kind: z.enum(BLUEPRINT_FILTER_KINDS).describe('The control.'),
  column: z
    .string()
    .describe('The column of the mock dataset it filters; empty for none.'),
  options: z
    .array(z.string())
    .describe('The options read from the image, or plausible ones.'),
});

/** One figure a widget shows: a column folded by an aggregation. */
export const blueprintMeasureSchema = z.object({
  label: z.string().describe('The name the dashboard gives the figure.'),
  column: z.string().describe('The numeric column of the mock dataset.'),
  aggregation: z.enum(BLUEPRINT_AGGREGATIONS).describe('How rows fold.'),
  format: z.enum(BLUEPRINT_FORMATS).describe('How the value is written.'),
  unit: z.string().describe('A unit or currency symbol; empty for none.'),
  total: z
    .number()
    .nullable()
    .describe(
      'The figure over all the data as the image shows it, when readable.',
    ),
});

/** One widget of the dashboard. */
export const blueprintWidgetSchema = z.object({
  id: z.string().describe('A short kebab-case id, unique among widgets.'),
  title: z.string().describe('The title the dashboard shows.'),
  kind: z.enum(BLUEPRINT_WIDGET_KINDS).describe('What the widget draws.'),
  span: z
    .number()
    .describe('Its width in a 12-column grid, 2 to 12; widgets wrap in order.'),
  measures: z
    .array(blueprintMeasureSchema)
    .describe('The figures it shows; one for a KPI, a pie or a donut.'),
  dimension: z
    .string()
    .describe('The column it breaks the measures down by; empty for none.'),
  description: z
    .string()
    .describe('What it shows: measure, breakdown, units and time grain.'),
  observed: z
    .string()
    .describe('The values, labels and ranges readable in the image.'),
  filteredBy: z
    .array(z.string())
    .describe('The ids of the filters that change it.'),
});

/** One column of the mock dataset behind the dashboard. */
export const blueprintColumnSchema = z.object({
  name: z.string().describe('A snake_case column name.'),
  type: z.enum(BLUEPRINT_COLUMN_TYPES).describe('The column type.'),
  description: z.string().describe('What it holds.'),
  values: z
    .array(z.string())
    .describe(
      'A string column: its categories, in display order. A date column: its periods, in order (for example Jan to Dec). Else empty.',
    ),
  min: z.number().nullable().describe('A number column: a plausible low.'),
  max: z.number().nullable().describe('A number column: a plausible high.'),
});

/** The look of the dashboard. */
export const blueprintThemeSchema = z.object({
  mode: z.enum(['light', 'dark']).describe('Light or dark.'),
  accent: z.string().describe('The accent colour, as #rrggbb.'),
  palette: z
    .array(z.string())
    .describe('The series colours in order, as #rrggbb.'),
});

/**
 * The dashboard as data. The fixed runtime draws it, and it is what a
 * stored dashboard artefact holds.
 */
export const dashboardBlueprintSchema = z.object({
  title: z.string().describe("The dashboard's title."),
  summary: z.string().describe('What the dashboard is for, in a sentence.'),
  theme: blueprintThemeSchema.describe('Its look.'),
  layout: z
    .string()
    .describe('The grid in words: rows, and which widget sits where.'),
  filters: z.array(blueprintFilterSchema).describe('Its controls.'),
  widgets: z
    .array(blueprintWidgetSchema)
    .describe('Its widgets, in reading order.'),
  columns: z
    .array(blueprintColumnSchema)
    .describe('The columns of one mock dataset every widget can read.'),
});

export type DashboardBlueprint = z.output<typeof dashboardBlueprintSchema>;
