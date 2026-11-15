/**
 * The data contract of the Recreate a Dashboard workflow (agents.md 5.17): the Zod schema of the workflow's input and of every
 * step's input and output. The one source of truth: the Mastra workflow
 * (./recreate-dashboard.workflow.ts) builds its steps from it, and the step
 * catalogue (./recreate-dashboard.steps.ts) derives each step's field names
 * and JSON Schema from it. Zod only, no framework import, so Jest and the
 * catalogue can load it without Mastra.
 *
 * The flow: Load image → Read dashboard → Build mock → Save mock. A step
 * passes on what the steps after it read, since the engine hands a step
 * only its previous step's output. The image's bytes and the mock's
 * HTML, CSS and JavaScript stay with the run's runtime, never in a step's
 * output: a step names the image by its workspace path.
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

/** One control of the dashboard that narrows what its widgets show. */
export const blueprintFilterSchema = z.object({
  id: z.string().describe('A short kebab-case id, unique among filters.'),
  label: z.string().describe('The label the dashboard shows.'),
  kind: z.enum(BLUEPRINT_FILTER_KINDS).describe('The control.'),
  options: z
    .array(z.string())
    .describe('The options read from the image, or plausible ones.'),
});

/** One widget of the dashboard. */
export const blueprintWidgetSchema = z.object({
  id: z.string().describe('A short kebab-case id, unique among widgets.'),
  title: z.string().describe('The title the dashboard shows.'),
  kind: z.enum(BLUEPRINT_WIDGET_KINDS).describe('What the widget draws.'),
  position: z
    .string()
    .describe('Where it sits and how wide it is, in the layout grid.'),
  description: z
    .string()
    .describe('What it shows: measure, breakdown, units and time grain.'),
  fields: z
    .array(z.string())
    .describe('The columns of the mock dataset it reads.'),
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
  type: z
    .enum(['string', 'number', 'date', 'boolean'])
    .describe('The column type.'),
  description: z.string().describe('What it holds and its plausible values.'),
});

/**
 * What Read dashboard understood of the image: the structure the mock is
 * built from, and what later steps of the workflow work on.
 */
export const dashboardBlueprintSchema = z.object({
  title: z.string().describe("The dashboard's title."),
  summary: z.string().describe('What the dashboard is for, in a sentence.'),
  theme: z
    .string()
    .describe('Light or dark, the accent and series colours, the density.'),
  layout: z
    .string()
    .describe('The grid: rows, columns and which widget sits where.'),
  filters: z.array(blueprintFilterSchema).describe('Its controls.'),
  widgets: z.array(blueprintWidgetSchema).describe('Its widgets, in order.'),
  columns: z
    .array(blueprintColumnSchema)
    .describe('The columns of one mock dataset every widget can read.'),
});

/** The workflow's input: the run's instructions and its image. */
export const recreateDashboardInputSchema = z.object({
  question: z
    .string()
    .describe("The user's instructions; by default, recreate the dashboard."),
  image: z
    .string()
    .describe("The dashboard image's path in the run's workspace."),
});

/** What Load image found. */
export const loadedImageSchema = recreateDashboardInputSchema.extend({
  mediaType: z.string().describe('image/png, image/jpeg or image/webp.'),
  sizeBytes: z.number().describe("The image's size in bytes."),
});

/** What Read dashboard understood. */
export const readDashboardSchema = loadedImageSchema.extend({
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** What Build mock wrote; the mock itself stays with the run. */
export const builtMockSchema = z.object({
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  title: z.string().describe("The mock's title."),
  description: z.string().describe('What the mock shows and how to use it.'),
  codeBytes: z.number().describe('The size of its HTML, CSS and JavaScript.'),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** The run's result: the stored mock and the structure it was built from. */
export const savedMockSchema = z.object({
  visualId: z.string().describe("The stored mock's id: a visual of the run."),
  title: z.string().describe("The mock's title."),
  widgetCount: z.number().describe('The widgets it recreates.'),
  filterCount: z.number().describe('The filters it recreates.'),
  answer: z.string().describe("The run's answer."),
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
});

/**
 * The run's result (the workflow's output): Save mock's output, or, for a
 * run stopped before it, the output of the step that stopped (`stopped`).
 */
export const recreateDashboardResultSchema = savedMockSchema
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
  'build-mock': { input: readDashboardSchema, output: builtMockSchema },
  'save-mock': { input: builtMockSchema, output: savedMockSchema },
} as const;
