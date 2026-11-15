/**
 * The data contract of the Recreate a Dashboard workflow (agents.md 5.17):
 * the Zod schema of the workflow's input and of every step's input and
 * output. The one source of truth: the Mastra workflow
 * (./recreate-dashboard.workflow.ts) builds its steps from it, and the step
 * catalogue (./recreate-dashboard.steps.ts) derives each step's field names
 * and JSON Schema from it. Zod only, no framework import, so Jest and the
 * catalogue can load it without Mastra.
 *
 * The flow: Load image → Read dashboard → Load catalog → Map data → Render
 * dashboard. No model writes markup: Read dashboard returns the dashboard
 * as data (the blueprint), Map data ties each widget to the columns of the
 * run's datasets (the mapping), and Render dashboard draws both with a
 * fixed runtime. A step passes on what the steps after it read, since the
 * engine hands a step only its previous step's output. The image's bytes
 * stay with the run's runtime: a step names the image by its workspace
 * path.
 */
import { z } from 'zod';
import {
  catalogEntitySchema,
  entityColumnsSchema,
} from './answer-business-question.schemas';

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
 * What Read dashboard understood of the image: the dashboard as data. The
 * fixed runtime draws it, Map data maps it, and it is what a stored
 * dashboard artefact holds.
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

/** How well the run's datasets can feed one widget or filter. */
export const MAPPING_STATUSES = ['mapped', 'partial', 'unmapped'] as const;

/** One column of the mock dataset tied to a column of the run's datasets. */
export const fieldMappingSchema = z.object({
  field: z.string().describe("The blueprint's column."),
  dataset: z.string().describe('The dataset of the entity; empty for none.'),
  entity: z.string().describe('The entity (table) key; empty for none.'),
  column: z.string().describe("The entity's column; empty for none."),
  note: z
    .string()
    .describe('Why this column, or what is missing when there is none.'),
});

/** One widget's mapping. */
export const widgetMappingSchema = z.object({
  widgetId: z.string().describe("The widget's id in the blueprint."),
  status: z
    .enum(MAPPING_STATUSES)
    .describe(
      'mapped: every column it reads has a source; partial: some; unmapped: none.',
    ),
  fields: z
    .array(fieldMappingSchema)
    .describe('One entry per column it reads.'),
  reason: z.string().describe('How the datasets can, or cannot, feed it.'),
});

/** One filter's mapping. */
export const filterMappingSchema = z.object({
  filterId: z.string().describe("The filter's id in the blueprint."),
  status: z.enum(['mapped', 'unmapped']).describe('Whether it has a source.'),
  field: fieldMappingSchema.describe('The column it filters and its source.'),
});

/** What Map data found: the dashboard against the run's datasets. */
export const dataMappingSchema = z.object({
  approach: z
    .string()
    .describe('How the mapping was done, and the main entities it rests on.'),
  widgets: z.array(widgetMappingSchema).describe('One entry per widget.'),
  filters: z.array(filterMappingSchema).describe('One entry per filter.'),
  gaps: z
    .array(z.string())
    .describe('What the datasets lack to feed the whole dashboard.'),
});

/** The workflow's input: the run's instructions, its image and datasets. */
export const recreateDashboardInputSchema = z.object({
  question: z
    .string()
    .describe("The user's instructions; by default, recreate the dashboard."),
  image: z
    .string()
    .describe("The dashboard image's path in the run's workspace."),
  datasets: z
    .array(z.string())
    .describe('The datasets the dashboard is mapped to; at least one.'),
});

/** What Load image found. */
export const loadedImageSchema = recreateDashboardInputSchema.extend({
  mediaType: z.string().describe('image/png, image/jpeg or image/webp.'),
  sizeBytes: z.number().describe("The image's size in bytes."),
});

/** What Read dashboard understood. */
export const readDashboardSchema = z.object({
  question: z.string().describe("The user's instructions."),
  datasets: z.array(z.string()).describe("The run's datasets."),
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** What Load catalog read: the entities and columns to map to. */
export const loadedCatalogSchema = z.object({
  question: z.string().describe("The user's instructions."),
  datasets: z.array(z.string()).describe("The run's datasets."),
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  columns: z
    .array(entityColumnsSchema)
    .describe('The columns of each entity: at most 40 each and 400 in all.'),
});

/** What Map data found. */
export const mappedDashboardSchema = z.object({
  datasets: z.array(z.string()).describe("The run's datasets."),
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  mapping: dataMappingSchema.describe('The dashboard against the datasets.'),
  entityCount: z.number().describe('The entities it was mapped against.'),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** The run's result: the stored dashboard, its structure and its mapping. */
export const renderedDashboardSchema = z.object({
  visualId: z
    .string()
    .describe("The stored dashboard's id: a visual of the run."),
  title: z.string().describe("The dashboard's title."),
  widgetCount: z.number().describe('The widgets it recreates.'),
  filterCount: z.number().describe('The filters it recreates.'),
  mappedCount: z.number().describe('Widgets the datasets can feed.'),
  partialCount: z.number().describe('Widgets they can feed in part.'),
  unmappedCount: z.number().describe('Widgets they cannot feed.'),
  answer: z.string().describe("The run's answer: the mapping explained."),
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  mapping: dataMappingSchema.describe('The dashboard against the datasets.'),
});

/**
 * The run's result (the workflow's output): Render dashboard's output, or,
 * for a run stopped before it, the output of the step that stopped
 * (`stopped`).
 */
export const recreateDashboardResultSchema = renderedDashboardSchema
  .partial()
  .extend({ stopped: z.boolean().optional() })
  .passthrough();

/** Every step's input and output schema, by step id, in catalogue order. */
export const RECREATE_DASHBOARD_STEP_SCHEMAS = {
  'load-image': {
    input: recreateDashboardInputSchema,
    output: loadedImageSchema,
  },
  'read-dashboard': { input: loadedImageSchema, output: readDashboardSchema },
  'load-dashboard-catalog': {
    input: readDashboardSchema,
    output: loadedCatalogSchema,
  },
  'map-data': { input: loadedCatalogSchema, output: mappedDashboardSchema },
  'render-dashboard': {
    input: mappedDashboardSchema,
    output: renderedDashboardSchema,
  },
} as const;
