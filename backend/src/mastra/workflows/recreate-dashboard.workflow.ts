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
  savedMock,
  type RecreateDashboardRuntime,
} from './recreate-dashboard.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The Recreate a Dashboard workflow, defined in code (agents.md 5.17), on
// Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow):
//
//   load-image → read-dashboard → build-mock → save-mock
//
// Load image and Save mock are code. Read dashboard runs the Dashboard
// Reader over the uploaded image and returns the dashboard's blueprint;
// Build mock runs the Mock Builder over the blueprint and the image. A
// stopped run bails at the step it was stopped in, which ends the run as a
// success with that step's output (`stopped`).
//
// The run's runtime (functions on the RequestContext) holds the image's
// bytes and the built mock between steps, so no snapshot is ever written:
// the run never waits for the user.
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
  if (!runtime)
    throw new Error(`The ${title} step has no dashboard to work on`);
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
      const output = { ...params.inputData, ...read };
      return read.stopped ? params.bail(output) : output;
    },
  ),
});

const buildMockStep = createStep({
  id: STEP['build-mock'].id,
  description: STEP['build-mock'].title,
  inputSchema: engineInputSchema(SCHEMAS['build-mock'].input),
  outputSchema: SCHEMAS['build-mock'].output,
  execute: withContract(
    STEP['build-mock'].title,
    SCHEMAS['build-mock'],
    async (params: StepParams<(typeof SCHEMAS)['build-mock']>) => {
      const runtime = runtimeOf(params, STEP['build-mock'].title);
      const { question, image, blueprint } = params.inputData;
      const built = await runtime.buildMock({ question, image, blueprint });
      const output = { blueprint, ...built };
      return built.stopped ? params.bail(output) : output;
    },
  ),
});

const saveMockStep = createStep({
  id: STEP['save-mock'].id,
  description: STEP['save-mock'].title,
  inputSchema: engineInputSchema(SCHEMAS['save-mock'].input),
  outputSchema: SCHEMAS['save-mock'].output,
  execute: withContract(
    STEP['save-mock'].title,
    SCHEMAS['save-mock'],
    async (params: StepParams<(typeof SCHEMAS)['save-mock']>) => {
      const runtime = runtimeOf(params, STEP['save-mock'].title);
      const { blueprint } = params.inputData;
      const saved = await runtime.saveMock({ blueprint });
      return savedMock({ ...saved, blueprint });
    },
  ),
});

export const recreateDashboardWorkflow = createWorkflow({
  id: RECREATE_DASHBOARD_WORKFLOW_ID,
  description:
    'Recreate the dashboard of an uploaded image as an interactive mock: read its structure, build the mock on invented data and store it.',
  inputSchema: recreateDashboardInputSchema,
  outputSchema: recreateDashboardResultSchema,
  options: {
    // The run's input is validated against `recreateDashboardInputSchema`
    // before the first step (the input node has already checked it, api.md
    // 118).
    validateInputs: true,
    // The run never waits, and its runtime on the RequestContext (the
    // image, the mock) must never be serialised.
    shouldPersistSnapshot: () => false,
  },
})
  .then(loadImageStep)
  .then(readDashboardStep)
  .then(buildMockStep)
  .then(saveMockStep)
  .commit();
