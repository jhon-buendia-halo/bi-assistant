/**
 * The data contract of the Map a Dashboard to Data workflow (agents.md
 * 5.18): the Zod schema of the workflow's input and of every step's input
 * and output. The one source of truth: the Mastra workflow
 * (./map-dashboard-data.workflow.ts) builds its steps from it, and the step
 * catalogue (./map-dashboard-data.steps.ts) derives each step's field names
 * and JSON Schema from it. The blueprint and the mapping are the shapes of
 * ./recreate-dashboard.schemas.ts. Zod only, no framework import, so Jest
 * and the catalogue can load it without Mastra.
 *
 * The flow: Load dashboard → Load catalog → Map data → Render dashboard.
 * Load dashboard reads the saved dashboard (an artifact) the run names,
 * Map data ties each widget to the columns of the run's datasets (the
 * mapping), and Render dashboard draws both with the fixed runtime. A step
 * passes on what the steps after it read, since the engine hands a step
 * only its previous step's output.
 */
import { z } from 'zod';
import {
  catalogEntitySchema,
  entityColumnsSchema,
} from './answer-business-question.schemas';
import {
  dashboardBlueprintSchema,
  dataMappingSchema,
} from './recreate-dashboard.schemas';

/** The workflow's input: the saved dashboard, the datasets, instructions. */
export const mapDashboardInputSchema = z.object({
  question: z
    .string()
    .describe("The user's instructions; by default, map the dashboard."),
  artifact: z.string().describe('The id of the saved dashboard to map.'),
  datasets: z
    .array(z.string())
    .describe('The datasets the dashboard is mapped to; at least one.'),
  imageNotes: z
    .string()
    .default('')
    .describe("Read images' notes; '' when the run has no images."),
});

/**
 * The run's own input (the workflow's input schema): the first step's input
 * plus the reference images' stored paths, which only Read images reads
 * (agents.md 5.11, 5.18).
 */
export const mapDashboardRunInputSchema = mapDashboardInputSchema.extend({
  images: z
    .array(z.string())
    .optional()
    .describe('Reference images: their stored paths.'),
});

/** What Load dashboard read from the artifact. */
export const loadedDashboardSchema = z.object({
  question: z.string().describe("The user's instructions."),
  datasets: z.array(z.string()).describe("The run's datasets."),
  artifactName: z.string().describe("The saved dashboard's name."),
  blueprint: dashboardBlueprintSchema.describe("The dashboard's structure."),
  imageNotes: z
    .string()
    .describe("Read images' notes; '' when the run has no images."),
});

/** What Load catalog read: the entities and columns to map to. */
export const loadedCatalogSchema = loadedDashboardSchema.extend({
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
  artifactName: z.string().describe("The saved dashboard's name."),
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
  widgetCount: z.number().describe('The widgets it holds.'),
  filterCount: z.number().describe('The filters it holds.'),
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
export const mapDashboardResultSchema = renderedDashboardSchema
  .partial()
  .extend({ stopped: z.boolean().optional() })
  .passthrough();

/** Every step's input and output schema, by step id, in catalogue order. */
export const MAP_DASHBOARD_DATA_STEP_SCHEMAS = {
  'load-dashboard': {
    input: mapDashboardInputSchema,
    output: loadedDashboardSchema,
  },
  'load-dashboard-catalog': {
    input: loadedDashboardSchema,
    output: loadedCatalogSchema,
  },
  'map-data': { input: loadedCatalogSchema, output: mappedDashboardSchema },
  'render-dashboard': {
    input: mappedDashboardSchema,
    output: renderedDashboardSchema,
  },
} as const;
