import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { loadCatalog } from './answer-business-question.steps';
import {
  MAP_DASHBOARD_DATA_STEP_SCHEMAS,
  mapDashboardRunInputSchema,
  mapDashboardResultSchema,
} from './map-dashboard-data.schemas';
import {
  READ_IMAGES_OUTCOME_ID,
  hasReferenceImages,
  readImagesOutcome,
  readImagesStep,
} from './read-images.workflow';
import {
  MAP_DASHBOARD_DATA_RUNTIME_KEY,
  MAP_DASHBOARD_DATA_STEPS,
  MAP_DASHBOARD_DATA_WORKFLOW_ID,
  mapDashboardQuestion,
  renderedDashboard,
  type MapDashboardDataRuntime,
} from './map-dashboard-data.steps';
import {
  mappingExplanation,
  renderDashboardBundle,
} from './recreate-dashboard.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The Map a Dashboard to Data workflow, defined in code (agents.md 5.18),
// on Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow):
//
//   load-dashboard → load-dashboard-catalog → map-data → render-dashboard
//
// Load dashboard reads the saved dashboard (an artifact made by Recreate a
// Dashboard, 5.17). Load catalog lists the entities and columns of the
// run's datasets. Map data runs the Data Mapper over both and returns the
// mapping, checked against the catalog. Render dashboard draws the
// blueprint and its mapping with the fixed runtime (no model writes
// markup), stores it and writes the explanation. A stopped run bails at Map
// data, which ends the run as a success with that step's output
// (`stopped`).
//
// The run never waits for the user, and its runtime on the RequestContext
// is functions only, so no snapshot is ever written.
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./map-dashboard-data.schemas.ts, and `withContract` validates its
// input before it runs and its output after.

const STEP = Object.fromEntries(
  MAP_DASHBOARD_DATA_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof MAP_DASHBOARD_DATA_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = MAP_DASHBOARD_DATA_STEP_SCHEMAS;

/** What the engine hands the execute of a step with these schemas. */
type StepParams<S extends { input: z.ZodType; output: z.ZodType }> =
  ExecuteFunctionParams<
    unknown,
    z.output<S['input']>,
    z.output<S['output']>,
    unknown,
    unknown,
    DefaultEngineType
  >;

/** The run's runtime, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): MapDashboardDataRuntime {
  const runtime = params.requestContext.get(MAP_DASHBOARD_DATA_RUNTIME_KEY) as
    MapDashboardDataRuntime | undefined;
  if (!runtime) {
    throw new Error(`The ${title} step has no dashboard to work on`);
  }
  return runtime;
}

const loadDashboardStep = createStep({
  id: STEP['load-dashboard'].id,
  description: STEP['load-dashboard'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-dashboard'].input),
  outputSchema: SCHEMAS['load-dashboard'].output,
  execute: withContract(
    STEP['load-dashboard'].title,
    SCHEMAS['load-dashboard'],
    async (params: StepParams<(typeof SCHEMAS)['load-dashboard']>) => {
      const runtime = runtimeOf(params, STEP['load-dashboard'].title);
      const { artifact, datasets } = params.inputData;
      const loaded = await runtime.loadDashboard({ artifact });
      return {
        question: mapDashboardQuestion(params.inputData.question),
        datasets,
        artifactName: loaded.name,
        blueprint: loaded.blueprint,
        imageNotes: params.inputData.imageNotes,
      };
    },
  ),
});

const loadCatalogStep = createStep({
  id: STEP['load-dashboard-catalog'].id,
  description: STEP['load-dashboard-catalog'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-dashboard-catalog'].input),
  outputSchema: SCHEMAS['load-dashboard-catalog'].output,
  execute: withContract(
    STEP['load-dashboard-catalog'].title,
    SCHEMAS['load-dashboard-catalog'],
    async (params: StepParams<(typeof SCHEMAS)['load-dashboard-catalog']>) => ({
      ...params.inputData,
      // The dataset tools' own services: names and types, no rows.
      ...(await loadCatalog(params.inputData.datasets)),
    }),
  ),
});

const mapDataStep = createStep({
  id: STEP['map-data'].id,
  description: STEP['map-data'].title,
  inputSchema: engineInputSchema(SCHEMAS['map-data'].input),
  outputSchema: SCHEMAS['map-data'].output,
  execute: withContract(
    STEP['map-data'].title,
    SCHEMAS['map-data'],
    async (params: StepParams<(typeof SCHEMAS)['map-data']>) => {
      const runtime = runtimeOf(params, STEP['map-data'].title);
      const {
        question,
        datasets,
        artifactName,
        blueprint,
        catalog,
        columns,
        imageNotes,
      } = params.inputData;
      const mapped = await runtime.mapData({
        question,
        blueprint,
        catalog,
        columns,
        imageNotes,
      });
      const output = {
        datasets,
        artifactName,
        blueprint,
        mapping: mapped.mapping,
        entityCount: catalog.length,
        stopped: mapped.stopped,
      };
      return mapped.stopped ? params.bail(output) : output;
    },
  ),
});

const renderDashboardStep = createStep({
  id: STEP['render-dashboard'].id,
  description: STEP['render-dashboard'].title,
  inputSchema: engineInputSchema(SCHEMAS['render-dashboard'].input),
  outputSchema: SCHEMAS['render-dashboard'].output,
  execute: withContract(
    STEP['render-dashboard'].title,
    SCHEMAS['render-dashboard'],
    async (params: StepParams<(typeof SCHEMAS)['render-dashboard']>) => {
      const runtime = runtimeOf(params, STEP['render-dashboard'].title);
      const { datasets, artifactName, blueprint, mapping, entityCount } =
        params.inputData;
      const answer = mappingExplanation({
        blueprint,
        mapping,
        datasets,
        entityCount,
        artifactName,
      });
      const saved = await runtime.saveMappedDashboard({
        bundle: renderDashboardBundle(blueprint, mapping),
        answer,
      });
      return renderedDashboard({ ...saved, answer, blueprint, mapping });
    },
  ),
});

export const mapDashboardDataWorkflow = createWorkflow({
  id: MAP_DASHBOARD_DATA_WORKFLOW_ID,
  description:
    "Map a saved dashboard to the run's datasets: tie each widget and filter to the datasets' columns, draw the dashboard with what the data cannot feed marked, and explain the mapping.",
  inputSchema: mapDashboardRunInputSchema,
  outputSchema: mapDashboardResultSchema,
  options: {
    // The run's input is validated against `mapDashboardRunInputSchema` before
    // the first step (the input node has already checked it, api.md 118).
    validateInputs: true,
    // The run never waits, and its runtime on the RequestContext must never
    // be serialised.
    shouldPersistSnapshot: () => false,
  },
})
  // Reference images (agents.md 2.15, 5.18): Read images runs first only
  // when the run has images; the map passes the input on with its notes.
  .branch([[hasReferenceImages, readImagesStep]])
  .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(loadDashboardStep)
  .then(loadCatalogStep)
  .then(mapDataStep)
  .then(renderDashboardStep)
  .commit();
