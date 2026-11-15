import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { loadCatalog } from './answer-business-question.steps';
import {
  RECREATE_DASHBOARD_STEP_SCHEMAS,
  recreateDashboardInputSchema,
  recreateDashboardResultSchema,
} from './recreate-dashboard.schemas';
import {
  NO_SOURCE_ERROR,
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_STEPS,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  emptyBlueprint,
  mappingExplanation,
  recreateDashboardQuestion,
  renderDashboardBundle,
  renderedDashboard,
  type RecreateDashboardRuntime,
} from './recreate-dashboard.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The Recreate a Dashboard workflow, defined in code (agents.md 5.17), on
// Mastra's control flow (https://mastra.ai/docs/workflows/control-flow):
//
//   load-source
//   → .branch(the run has an image → read-dashboard) → .map
//   → load-dashboard-catalog → map-data → render-dashboard
//
// Load source finds the run's dashboard: the uploaded image, or the saved
// dashboard of an artifact. Only a run on an image takes the branch to Read
// dashboard, which runs the Dashboard Reader over the image and returns the
// dashboard as data (the blueprint); a run on an artifact already has it.
// The map hands Load catalog whichever of the two holds the blueprint.
// Load catalog lists the entities and columns of the run's datasets. Map
// data runs the Data Mapper over both and returns the mapping, checked
// against the catalog. Render dashboard draws the blueprint and its mapping
// with the fixed runtime (no model writes markup), stores it and writes the
// explanation.
//
// A stopped run ends at the step after the one it was stopped in: Read
// dashboard is inside a branch, where a bail would end the branch only, so
// it passes `stopped` on and Load catalog bails; Map data bails itself.
// Either ends the run as a success with that step's output (`stopped`).
//
// The run's runtime (functions on the RequestContext) holds the image's
// bytes, so no snapshot is ever written: the run never waits for the user.
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./recreate-dashboard.schemas.ts, and `withContract` validates its
// input before it runs and its output after.

const STEP = Object.fromEntries(
  RECREATE_DASHBOARD_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof RECREATE_DASHBOARD_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = RECREATE_DASHBOARD_STEP_SCHEMAS;

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
): RecreateDashboardRuntime {
  const runtime = params.requestContext.get(RECREATE_DASHBOARD_RUNTIME_KEY) as
    RecreateDashboardRuntime | undefined;
  if (!runtime) {
    throw new Error(`The ${title} step has no dashboard to work on`);
  }
  return runtime;
}

const loadSourceStep = createStep({
  id: STEP['load-source'].id,
  description: STEP['load-source'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-source'].input),
  outputSchema: SCHEMAS['load-source'].output,
  execute: withContract(
    STEP['load-source'].title,
    SCHEMAS['load-source'],
    async (params: StepParams<(typeof SCHEMAS)['load-source']>) => {
      const runtime = runtimeOf(params, STEP['load-source'].title);
      const { datasets } = params.inputData;
      const question = recreateDashboardQuestion(params.inputData.question);
      const artifact = params.inputData.artifact?.trim();
      const image = params.inputData.image?.trim();
      // A saved dashboard comes first: the image is then never read.
      if (artifact) {
        return {
          question,
          datasets,
          source: 'artifact' as const,
          image: '',
          blueprint: await runtime.loadArtifact({ artifact }),
          stopped: false,
        };
      }
      if (!image) throw new Error(NO_SOURCE_ERROR);
      await runtime.loadImage({ image });
      return {
        question,
        datasets,
        source: 'image' as const,
        image,
        blueprint: emptyBlueprint(),
        stopped: false,
      };
    },
  ),
});

const readDashboardStep = createStep({
  id: STEP['read-dashboard'].id,
  description: STEP['read-dashboard'].title,
  inputSchema: engineInputSchema(SCHEMAS['read-dashboard'].input),
  outputSchema: SCHEMAS['read-dashboard'].output,
  execute: withContract(
    STEP['read-dashboard'].title,
    SCHEMAS['read-dashboard'],
    async (params: StepParams<(typeof SCHEMAS)['read-dashboard']>) => {
      const runtime = runtimeOf(params, STEP['read-dashboard'].title);
      const { question, image } = params.inputData;
      const read = await runtime.readDashboard({ question, image });
      // Inside a branch: `stopped` is passed on, and Load catalog bails.
      return { ...params.inputData, ...read };
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
    async (params: StepParams<(typeof SCHEMAS)['load-dashboard-catalog']>) => {
      const { question, datasets, source, blueprint, stopped } =
        params.inputData;
      const passed = { question, datasets, source, blueprint, stopped };
      // Read dashboard was stopped: the run ends here, nothing is listed.
      if (stopped) return params.bail({ ...passed, catalog: [], columns: [] });
      // The dataset tools' own services: names and types, no rows.
      return { ...passed, ...(await loadCatalog(datasets)) };
    },
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
      const { question, datasets, source, blueprint, catalog, columns } =
        params.inputData;
      const mapped = await runtime.mapData({
        question,
        blueprint,
        catalog,
        columns,
      });
      const output = {
        datasets,
        source,
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
      const { datasets, source, blueprint, mapping, entityCount } =
        params.inputData;
      const answer = mappingExplanation({
        blueprint,
        mapping,
        datasets,
        entityCount,
        source,
      });
      const saved = await runtime.saveDashboard({
        bundle: renderDashboardBundle(blueprint, mapping),
        answer,
      });
      return renderedDashboard({ ...saved, answer, blueprint, mapping });
    },
  ),
});

export const recreateDashboardWorkflow = createWorkflow({
  id: RECREATE_DASHBOARD_WORKFLOW_ID,
  description:
    "Recreate a dashboard, from an uploaded image or a saved dashboard, as an interactive mock mapped to the run's datasets: read its structure, map it to the datasets' columns, draw it and explain the mapping.",
  inputSchema: recreateDashboardInputSchema,
  outputSchema: recreateDashboardResultSchema,
  options: {
    // The run's input is validated against `recreateDashboardInputSchema`
    // before the first step (the input node has already checked it, api.md
    // 118).
    validateInputs: true,
    // The run never waits, and its runtime on the RequestContext (the
    // image) must never be serialised.
    shouldPersistSnapshot: () => false,
  },
})
  .then(loadSourceStep)
  // Only a run on an image reads it; a saved dashboard is read already.
  .branch([
    [
      async ({ inputData }) => Promise.resolve(inputData.source === 'image'),
      readDashboardStep,
    ],
  ])
  .map(
    async (params) =>
      Promise.resolve(
        ((params.inputData as Record<string, unknown>)[
          STEP['read-dashboard'].id
        ] ?? params.getStepResult(loadSourceStep)) as z.output<
          (typeof SCHEMAS)['load-dashboard-catalog']['input']
        >,
      ),
    { id: 'dashboard-source-outcome' },
  )
  .then(loadCatalogStep)
  .then(mapDataStep)
  .then(renderDashboardStep)
  .commit();
