import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import {
  DATA_READINESS_ASSESSMENT_STEP_SCHEMAS,
  assessmentResultSchema,
  assessmentRunInputSchema,
} from './data-readiness-assessment.schemas';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  DATA_READINESS_ASSESSMENT_STEPS,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  assessmentQuestion,
  assessmentSummary,
  type DataReadinessAssessmentRuntime,
} from './data-readiness-assessment.steps';
import {
  READ_IMAGES_OUTCOME_ID,
  hasReferenceImages,
  readImagesOutcome,
  readImagesStep,
} from './read-images.workflow';
import { engineInputSchema, withContract } from './workflow-contract';

// The Assess Data Readiness workflow, defined in code (agents.md 5.13;
// data-readiness R2), on Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow):
//
//   resolve-dataset → profile-source → score-readiness → save-report
//   → finding-rows → explain-report → wrap-up
//
// The first five steps are code: the deterministic engine owns every score
// (data-readiness R4), and Rows behind findings runs one read-only query
// per top finding, recorded as a source of the answer (roadmap 1.28.11).
// Explain report runs the Data Readiness Agent over the stored report. A stopped run bails at the step it was stopped in,
// which ends the run as a success with that step's output (`stopped`).
//
// The run's runtime (functions on the RequestContext) holds the profile
// and the scored report between steps, so no snapshot is ever written:
// the run never waits for the user.
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./data-readiness-assessment.schemas.ts, and `withContract`
// validates its input before it runs and its output after.

const STEP = Object.fromEntries(
  DATA_READINESS_ASSESSMENT_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof DATA_READINESS_ASSESSMENT_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = DATA_READINESS_ASSESSMENT_STEP_SCHEMAS;

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

/** The run's assessment, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): DataReadinessAssessmentRuntime {
  const runtime = params.requestContext.get(
    DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  ) as DataReadinessAssessmentRuntime | undefined;
  if (!runtime) throw new Error(`The ${title} step has no assessment to run`);
  return runtime;
}

const resolveDatasetStep = createStep({
  id: STEP['resolve-dataset'].id,
  description: STEP['resolve-dataset'].title,
  inputSchema: engineInputSchema(SCHEMAS['resolve-dataset'].input),
  outputSchema: SCHEMAS['resolve-dataset'].output,
  execute: withContract(
    STEP['resolve-dataset'].title,
    SCHEMAS['resolve-dataset'],
    async (params: StepParams<(typeof SCHEMAS)['resolve-dataset']>) => {
      const runtime = runtimeOf(params, STEP['resolve-dataset'].title);
      const target = await runtime.resolve({
        dataset: params.inputData.dataset,
      });
      return {
        question: assessmentQuestion(params.inputData.question),
        ...target,
        imageNotes: params.inputData.imageNotes,
      };
    },
  ),
});

const profileSourceStep = createStep({
  id: STEP['profile-source'].id,
  description: STEP['profile-source'].title,
  inputSchema: engineInputSchema(SCHEMAS['profile-source'].input),
  outputSchema: SCHEMAS['profile-source'].output,
  execute: withContract(
    STEP['profile-source'].title,
    SCHEMAS['profile-source'],
    async (params: StepParams<(typeof SCHEMAS)['profile-source']>) => {
      const runtime = runtimeOf(params, STEP['profile-source'].title);
      const profiled = await runtime.profile();
      const output = { ...params.inputData, ...profiled };
      return profiled.stopped ? params.bail(output) : output;
    },
  ),
});

const scoreReadinessStep = createStep({
  id: STEP['score-readiness'].id,
  description: STEP['score-readiness'].title,
  inputSchema: engineInputSchema(SCHEMAS['score-readiness'].input),
  outputSchema: SCHEMAS['score-readiness'].output,
  execute: withContract(
    STEP['score-readiness'].title,
    SCHEMAS['score-readiness'],
    async (params: StepParams<(typeof SCHEMAS)['score-readiness']>) => {
      const runtime = runtimeOf(params, STEP['score-readiness'].title);
      const {
        question,
        dataset,
        datasourceName,
        datasourceKind,
        tableCount,
        imageNotes,
      } = params.inputData;
      return Promise.resolve({
        question,
        dataset,
        datasourceName,
        datasourceKind,
        tableCount,
        imageNotes,
        ...runtime.score(),
      });
    },
  ),
});

const saveReportStep = createStep({
  id: STEP['save-report'].id,
  description: STEP['save-report'].title,
  inputSchema: engineInputSchema(SCHEMAS['save-report'].input),
  outputSchema: SCHEMAS['save-report'].output,
  execute: withContract(
    STEP['save-report'].title,
    SCHEMAS['save-report'],
    async (params: StepParams<(typeof SCHEMAS)['save-report']>) => {
      const runtime = runtimeOf(params, STEP['save-report'].title);
      const { reportId } = await runtime.save();
      return { ...params.inputData, reportId };
    },
  ),
});

const findingRowsStep = createStep({
  id: STEP['finding-rows'].id,
  description: STEP['finding-rows'].title,
  inputSchema: engineInputSchema(SCHEMAS['finding-rows'].input),
  outputSchema: SCHEMAS['finding-rows'].output,
  execute: withContract(
    STEP['finding-rows'].title,
    SCHEMAS['finding-rows'],
    async (params: StepParams<(typeof SCHEMAS)['finding-rows']>) => {
      const runtime = runtimeOf(params, STEP['finding-rows'].title);
      const found = await runtime.findingRows();
      const output = { ...params.inputData, ...found };
      return found.stopped ? params.bail(output) : output;
    },
  ),
});

const explainReportStep = createStep({
  id: STEP['explain-report'].id,
  description: STEP['explain-report'].title,
  inputSchema: engineInputSchema(SCHEMAS['explain-report'].input),
  outputSchema: SCHEMAS['explain-report'].output,
  execute: withContract(
    STEP['explain-report'].title,
    SCHEMAS['explain-report'],
    async (params: StepParams<(typeof SCHEMAS)['explain-report']>) => {
      const runtime = runtimeOf(params, STEP['explain-report'].title);
      const saved = params.inputData;
      const explained = await runtime.explain({
        question: saved.question,
        dataset: saved.dataset,
        reportId: saved.reportId,
        imageNotes: saved.imageNotes,
      });
      const output = {
        reportId: saved.reportId,
        overallScore: saved.overallScore,
        maturity: saved.maturity,
        findingCount: saved.findingCount,
        answer: explained.answer,
        stopped: explained.stopped,
      };
      return explained.stopped ? params.bail(output) : output;
    },
  ),
});

const wrapUpStep = createStep({
  id: STEP['wrap-up'].id,
  description: STEP['wrap-up'].title,
  inputSchema: engineInputSchema(SCHEMAS['wrap-up'].input),
  outputSchema: SCHEMAS['wrap-up'].output,
  execute: withContract(
    STEP['wrap-up'].title,
    SCHEMAS['wrap-up'],
    async (params: StepParams<(typeof SCHEMAS)['wrap-up']>) =>
      Promise.resolve(assessmentSummary(params.inputData)),
  ),
});

export const dataReadinessAssessmentWorkflow = createWorkflow({
  id: DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  description:
    'Assess one PostgreSQL or Databricks dataset: profile it, score it with the deterministic engine, store the report, look up the rows behind its findings and explain it.',
  inputSchema: assessmentRunInputSchema,
  outputSchema: assessmentResultSchema,
  options: {
    // The run's input is validated against `assessmentRunInputSchema` before
    // the first step (the input node has already checked it, api.md 118).
    validateInputs: true,
    // The run never waits, and its runtime on the RequestContext (the
    // profile, the report) must never be serialised.
    shouldPersistSnapshot: () => false,
  },
})
  // Reference images (agents.md 2.15, 5.13): Read images runs first only
  // when the run has images; the map passes the input on with its notes.
  .branch([[hasReferenceImages, readImagesStep]])
  .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(resolveDatasetStep)
  .then(profileSourceStep)
  .then(scoreReadinessStep)
  .then(saveReportStep)
  .then(findingRowsStep)
  .then(explainReportStep)
  .then(wrapUpStep)
  .commit();
