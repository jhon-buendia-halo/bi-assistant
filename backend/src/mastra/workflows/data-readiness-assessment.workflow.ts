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
  READ_IMAGES_STEP_ID,
  READ_IMAGES_STEP_TITLE,
} from './read-images.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The Assess Data Readiness workflow, defined in code (agents.md 5.13;
// data-readiness R2), on Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow):
//
//   resolve-dataset → profile-source → score-readiness
//   → [read-images, only with images] → save-report → explain-report
//   → finding-rows → wrap-up
//
// The code steps own every score (data-readiness R4). Independent work runs
// at the same time on this linear graph, one step at a time: Resolve
// dataset starts Zoe's reading of the reference images (after its free
// refusal), which runs while the dataset is profiled and scored, and Read
// images awaits it, so a model error fails the run before anything is
// stored. Save report starts the rows behind findings, one read-only query
// per top finding (roadmap 1.28.11), which run while Explain report runs
// the Data Readiness Agent over the stored report; Rows behind findings
// takes them, and the turn puts their sources ahead of the agent's. A
// stopped run bails at the step it was stopped in, which ends the run as a
// success with that step's output (`stopped`).
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
      const { question, dataset, images } = params.inputData;
      // The free refusal first: a dataset that cannot be assessed costs
      // no model call.
      const target = await runtime.resolve({ dataset });
      // Zoe reads the images meanwhile, with the run's own question.
      if (images?.length) runtime.startImageNotes({ question, images });
      return { question: assessmentQuestion(question), ...target };
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
      const { question, dataset, datasourceName, datasourceKind, tableCount } =
        params.inputData;
      return Promise.resolve({
        question,
        dataset,
        datasourceName,
        datasourceKind,
        tableCount,
        ...runtime.score(),
      });
    },
  ),
});

/** Read images' schemas in this workflow (agents.md 2.15, 5.13). */
const IMAGES_SCHEMAS = SCHEMAS[READ_IMAGES_STEP_ID];

/**
 * Read images' input schema as the engine sees it, typed as any input:
 * Mastra 1.66 types a branch step's input as the whole output before it.
 * At run time it is the declared (empty) schema.
 */
const readinessImagesInput = engineInputSchema(
  IMAGES_SCHEMAS.input,
) as unknown as z.ZodType<any>;

/**
 * Read images, this workflow's own (agents.md 2.15, 5.13): it awaits the
 * notes Zoe has been writing since Resolve dataset. A model error fails
 * the step and the run, before Save report stores anything. A stop passes
 * `stopped` on without a bail (a bail inside a branch ends only this
 * step): Save report then bails, storing nothing.
 */
const readinessImagesStep = createStep({
  id: READ_IMAGES_STEP_ID,
  description: READ_IMAGES_STEP_TITLE,
  inputSchema: readinessImagesInput,
  outputSchema: IMAGES_SCHEMAS.output,
  execute: withContract(
    READ_IMAGES_STEP_TITLE,
    IMAGES_SCHEMAS,
    async (params: StepParams<typeof IMAGES_SCHEMAS>) => {
      const read = await runtimeOf(params, READ_IMAGES_STEP_TITLE).imageNotes();
      return {
        imageNotes: read.stopped ? '' : read.imageNotes,
        imageCount: read.stopped ? 0 : read.imageCount,
        stopped: read.stopped,
      };
    },
  ),
});

/** The branch's condition: Resolve dataset started Zoe's notes. */
function readsImages(params: {
  requestContext: { get(key: string): unknown };
}): Promise<boolean> {
  const runtime = params.requestContext.get(
    DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  ) as DataReadinessAssessmentRuntime | undefined;
  return Promise.resolve(runtime?.readsImages() ?? false);
}

/**
 * The `.map()` after the branch (`READ_IMAGES_OUTCOME_ID`): Score
 * readiness's output with Read images' notes and stop, or `''` and `false`
 * when the branch was not taken (its `inputData` is then `{}`).
 */
function readinessImagesOutcome(params: {
  inputData: unknown;
  getStepResult: (step: unknown) => unknown;
}): Promise<Record<string, unknown>> {
  const read = (params.inputData as Record<string, unknown> | undefined)?.[
    READ_IMAGES_STEP_ID
  ] as { imageNotes?: unknown; stopped?: unknown } | undefined;
  const scored = params.getStepResult(scoreReadinessStep) as
    Record<string, unknown> | undefined;
  return Promise.resolve({
    ...(scored ?? {}),
    imageNotes: typeof read?.imageNotes === 'string' ? read.imageNotes : '',
    stopped: read?.stopped === true,
  });
}

const saveReportStep = createStep({
  id: STEP['save-report'].id,
  description: STEP['save-report'].title,
  inputSchema: engineInputSchema(SCHEMAS['save-report'].input),
  outputSchema: SCHEMAS['save-report'].output,
  execute: withContract(
    STEP['save-report'].title,
    SCHEMAS['save-report'],
    async (params: StepParams<(typeof SCHEMAS)['save-report']>) => {
      const { stopped, ...scored } = params.inputData;
      // Stopped while Read images waited: nothing is stored.
      if (stopped) {
        return params.bail({ ...scored, reportId: '', stopped: true });
      }
      const runtime = runtimeOf(params, STEP['save-report'].title);
      const { reportId } = await runtime.save();
      // The rows behind its findings, looked up while the agent explains.
      runtime.startFindingRows();
      return { ...scored, reportId, stopped: false };
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
  .then(resolveDatasetStep)
  .then(profileSourceStep)
  .then(scoreReadinessStep)
  // Reference images (agents.md 2.15, 5.13): Read images awaits Zoe's
  // notes only when Resolve dataset started them; the map passes the
  // scores on with the notes.
  .branch([[readsImages, readinessImagesStep]])
  .map(readinessImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(saveReportStep)
  .then(explainReportStep)
  .then(findingRowsStep)
  .then(wrapUpStep)
  .commit();
