import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import {
  RECREATE_DASHBOARD_STEP_SCHEMAS,
  recreateDashboardInputSchema,
  recreateDashboardResultSchema,
} from './recreate-dashboard.schemas';
import {
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_STEPS,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  recreateDashboardQuestion,
  renderDashboardBundle,
  savedDashboard,
  savedDashboardAnswer,
  type RecreateDashboardRuntime,
} from './recreate-dashboard.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The Recreate a Dashboard workflow, defined in code (agents.md 5.17), on
// Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow):
//
//   load-image → read-dashboard → save-dashboard
//
// Load image finds the uploaded image. Read dashboard runs the Dashboard
// Reader over it and returns the dashboard as data (the blueprint). Save
// dashboard draws the blueprint with the fixed runtime (no model writes
// markup), stores the drawing as a visual of the run and the blueprint as
// an artifact, which Map a Dashboard to Data (5.18) then takes. A stopped
// run bails at Read dashboard, which ends the run as a success with that
// step's output (`stopped`): nothing is saved.
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

const loadImageStep = createStep({
  id: STEP['load-image'].id,
  description: STEP['load-image'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-image'].input),
  outputSchema: SCHEMAS['load-image'].output,
  execute: withContract(
    STEP['load-image'].title,
    SCHEMAS['load-image'],
    async (params: StepParams<(typeof SCHEMAS)['load-image']>) => {
      const runtime = runtimeOf(params, STEP['load-image'].title);
      const { image } = params.inputData;
      const loaded = await runtime.loadImage({ image });
      return {
        question: recreateDashboardQuestion(params.inputData.question),
        image,
        ...loaded,
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
      const output = { question, ...read };
      return read.stopped ? params.bail(output) : output;
    },
  ),
});

const saveDashboardStep = createStep({
  id: STEP['save-dashboard'].id,
  description: STEP['save-dashboard'].title,
  inputSchema: engineInputSchema(SCHEMAS['save-dashboard'].input),
  outputSchema: SCHEMAS['save-dashboard'].output,
  execute: withContract(
    STEP['save-dashboard'].title,
    SCHEMAS['save-dashboard'],
    async (params: StepParams<(typeof SCHEMAS)['save-dashboard']>) => {
      const runtime = runtimeOf(params, STEP['save-dashboard'].title);
      const { blueprint } = params.inputData;
      const answer = (artifactName: string) =>
        savedDashboardAnswer({ blueprint, artifactName });
      const saved = await runtime.saveDashboard({
        blueprint,
        // No mapping yet: the dashboard alone, with no status marks.
        bundle: renderDashboardBundle(blueprint, null),
        answer,
      });
      return savedDashboard({
        ...saved,
        answer: answer(saved.artifactName),
        blueprint,
      });
    },
  ),
});

export const recreateDashboardWorkflow = createWorkflow({
  id: RECREATE_DASHBOARD_WORKFLOW_ID,
  description:
    'Recreate the dashboard of an uploaded image: read its structure, draw it as an interactive mock on invented data and save it as an artifact.',
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
  .then(loadImageStep)
  .then(readDashboardStep)
  .then(saveDashboardStep)
  .commit();
