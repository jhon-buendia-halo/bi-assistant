import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import { z } from 'zod';
import { analysePlanBlock } from './answer-business-question.prompts';
import {
  ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS,
  analyseInputSchema,
  answerBusinessQuestionInputSchema,
  planInputSchema,
  answerBusinessQuestionResultSchema,
  turnSummarySchema,
  dataQualityInputSchema,
} from './answer-business-question.schemas';
import {
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_STEPS,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  analysisLoopDone,
  catalogBlock,
  clarifyingQuestionOf,
  loadCatalog,
  planAfterAnswer,
  planCatalogBlock,
  planLoopDone,
  queriedTables,
  receiveQuestion,
  validateAttempt,
  wrapUp,
  type AnswerBusinessQuestionRuntime,
} from './answer-business-question.steps';
import {
  READ_IMAGES_OUTCOME_ID,
  hasReferenceImages,
  readImagesOutcome,
  readImagesStep,
} from './read-images.workflow';
import { engineInputSchema, withContract } from './workflow-contract';

// The turn of Insights Analyst as a workflow defined in code
// (ADR-0034; agents.md 5.11), on Mastra's control flow
// (https://mastra.ai/docs/workflows/control-flow) and suspend/resume
// (https://mastra.ai/docs/workflows/suspend-and-resume, ADR-0043):
//
//   .branch(the input has images → read-images) → read-images-outcome
//   → receive-question → load-catalog
//   → .dountil(plan-round: plan → .branch(needs clarification → clarify)
//              → plan-round-outcome, until a plan needs no clarification)
//   → .branch(not stopped → analysis-path:
//       .dountil(analysis-attempt: analyse → validate, ok or 2 attempts)
//       → .branch(not stopped → answer-path:
//           .branch(the run checks data quality → check-data-quality)
//           → quality-outcome → write-answer → wrap-up))
//
// Clarify suspends the run with the plan's question; resumed with the
// user's answer, it hands Plan's input back with the answer, and the loop
// runs Plan again (which never asks twice). Analyse suspends the run when
// the agent asks a clarifying question; resumed, it runs the agent again
// with the answer. A suspended run's path (`result.suspended`) is passed
// back unchanged to `run.resumeStream`.
//
// Read images (agents.md 2.15; workflows R35) describes the run's reference
// images once, before Receive question; its notes (`imageNotes`, `''`
// without images) travel in every step's data to Plan, Analyse and Write
// answer, so they survive a wait and a resume (the runtime is rebuilt
// empty on resume, and nested workflows cannot read a parent's steps).
//
// The nested workflows (`plan-round`, `analysis-path`, `analysis-attempt`,
// `answer-path`) and the mapping steps `plan-round-outcome` and
// `quality-outcome` are not catalogue steps: the engine reports their steps as
// `<parent>.<child>.<step>`, and the session code reads the last segment.
// A step's bail ends only the sequence it is in, so a stopped Analyse ends
// its attempt, the loop's condition sees `stopped`, and the answer path is
// not taken (its steps end `skipped`); a stopped Plan likewise ends its
// round with `stopped`, and no analysis runs.
//
// Mastra resumes a run from its persisted snapshot only, so a snapshot is
// written while the run is suspended and at no other time; the run's
// runtime (functions on the RequestContext) is handed in again on resume.
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./answer-business-question.schemas.ts, and `withContract` validates its input
// before it runs and its output after, so a violation fails the step with
// `Contract violation in <Step title>…` and later steps do not run. The
// engine sees each step's declared input schema but never refuses with it
// (`engineInputSchema`), so that message is the one a run shows.

const STEP = Object.fromEntries(
  ANSWER_BUSINESS_QUESTION_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS;

/** What the engine hands the execute of a step with these schemas. */
type StepParams<
  S extends {
    input: z.ZodType;
    output: z.ZodType;
    suspend?: z.ZodType;
    resume?: z.ZodType;
  },
> = ExecuteFunctionParams<
  unknown,
  z.output<S['input']>,
  z.output<S['output']>,
  S['resume'] extends z.ZodType ? z.output<S['resume']> : unknown,
  S['suspend'] extends z.ZodType ? z.output<S['suspend']> : unknown,
  DefaultEngineType
>;

/**
 * Snapshots are written only while a run waits for an answer: Mastra
 * resumes a run from its snapshot (ADR-0043), and nothing else needs one.
 */
const persistWhileWaiting = ({ workflowStatus }: { workflowStatus: string }) =>
  workflowStatus === 'suspended';

/** The run's turn, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): AnswerBusinessQuestionRuntime {
  const runtime = params.requestContext.get(
    ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ) as AnswerBusinessQuestionRuntime | undefined;
  if (!runtime) throw new Error(`The ${title} step has no turn to run`);
  return runtime;
}

const receiveQuestionStep = createStep({
  id: STEP['receive-question'].id,
  description: STEP['receive-question'].title,
  inputSchema: engineInputSchema(SCHEMAS['receive-question'].input),
  outputSchema: SCHEMAS['receive-question'].output,
  execute: withContract(
    STEP['receive-question'].title,
    SCHEMAS['receive-question'],
    async ({ inputData }: StepParams<(typeof SCHEMAS)['receive-question']>) =>
      Promise.resolve({
        question: receiveQuestion(inputData.question),
        datasets: inputData.datasets,
        imageNotes: inputData.imageNotes,
      }),
  ),
});

const loadCatalogStep = createStep({
  id: STEP['load-catalog'].id,
  description: STEP['load-catalog'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-catalog'].input),
  outputSchema: SCHEMAS['load-catalog'].output,
  execute: withContract(
    STEP['load-catalog'].title,
    SCHEMAS['load-catalog'],
    async ({ inputData }: StepParams<(typeof SCHEMAS)['load-catalog']>) => ({
      question: inputData.question,
      ...(await loadCatalog(inputData.datasets)),
      imageNotes: inputData.imageNotes,
    }),
  ),
});

const planStep = createStep({
  id: STEP.plan.id,
  description: STEP.plan.title,
  inputSchema: engineInputSchema(SCHEMAS.plan.input),
  outputSchema: SCHEMAS.plan.output,
  execute: withContract(
    STEP.plan.title,
    SCHEMAS.plan,
    async (params: StepParams<(typeof SCHEMAS)['plan']>) => {
      const { inputData } = params;
      const answered = inputData.clarification;
      const { plan, stopped } = await runtimeOf(params, STEP.plan.title).plan({
        question: inputData.question,
        catalog: inputData.catalog,
        // Plan sees each entity's columns, so its measures and its
        // clarifying options rest on what the data can compute.
        catalogBlock: planCatalogBlock(inputData.catalog, inputData.columns),
        ...(answered ? { clarification: answered } : {}),
        imageNotes: inputData.imageNotes,
      });
      const output = {
        question: inputData.question,
        catalog: inputData.catalog,
        // After an answer, Plan never asks again.
        plan: planAfterAnswer(plan, answered),
        imageNotes: inputData.imageNotes,
      };
      // A stopped turn ends here: nothing after Plan runs.
      return stopped ? params.bail({ ...output, stopped: true }) : output;
    },
  ),
});

const clarifyStep = createStep({
  id: STEP.clarify.id,
  description: STEP.clarify.title,
  inputSchema: engineInputSchema(SCHEMAS.clarify.input),
  outputSchema: SCHEMAS.clarify.output,
  suspendSchema: SCHEMAS.clarify.suspend,
  resumeSchema: SCHEMAS.clarify.resume,
  execute: withContract(
    STEP.clarify.title,
    SCHEMAS.clarify,
    async (params: StepParams<(typeof SCHEMAS)['clarify']>) => {
      const asked = params.inputData.plan.clarification;
      if (!asked) throw new Error('The plan asked no clarifying question');
      const answer = params.resumeData?.answer?.trim();
      // The run waits for the user's answer (api.md 138).
      if (!answer) {
        return params.suspend({
          question: asked.question,
          options: asked.options,
        });
      }
      // Back to Plan: its own input (the plan round's), with the answer.
      const planInput = planInputSchema.parse(params.getInitData());
      return {
        question: planInput.question,
        catalog: planInput.catalog,
        columns: planInput.columns,
        imageNotes: planInput.imageNotes,
        clarification: { ...asked, answer },
      };
    },
  ),
});

const analyseStep = createStep({
  id: STEP.analyse.id,
  description: STEP.analyse.title,
  inputSchema: engineInputSchema(SCHEMAS.analyse.input),
  outputSchema: SCHEMAS.analyse.output,
  execute: withContract(
    STEP.analyse.title,
    SCHEMAS.analyse,
    async (params: StepParams<(typeof SCHEMAS)['analyse']>) => {
      const { inputData } = params;
      const previous = inputData.attempt ?? 0;
      const attempt = previous + 1;
      // Resumed after the agent's clarifying question: it goes on with the
      // user's answer, in the same attempt.
      const asked = params.resumeData
        ? clarifyingQuestionOf(params.suspendData)
        : undefined;
      const answer = params.resumeData?.answer?.trim();
      const { clarification, ...attemptResult } = await runtimeOf(
        params,
        STEP.analyse.title,
      ).analyse({
        question: inputData.question,
        catalog: inputData.catalog,
        catalogBlock: catalogBlock(inputData.catalog),
        plan: inputData.plan,
        attempt,
        planBlock: analysePlanBlock(
          inputData.plan,
          previous && inputData.findings
            ? { attempt: previous, findings: inputData.findings }
            : undefined,
        ),
        ...(asked && answer ? { answered: { ...asked, answer } } : {}),
        imageNotes: inputData.imageNotes,
      });
      // The agent asked the user: the run waits for the answer (api.md 138).
      if (clarification && !attemptResult.stopped) {
        return params.suspend({
          question: clarification.question,
          options: clarification.options,
        });
      }
      const outcome = {
        question: inputData.question,
        catalog: inputData.catalog,
        plan: inputData.plan,
        attempt,
        ...attemptResult,
        imageNotes: inputData.imageNotes,
      };
      // A stopped turn ends the attempt: the loop ends, no answer is written.
      return outcome.stopped ? params.bail(outcome) : outcome;
    },
  ),
});

const validateStep = createStep({
  id: STEP.validate.id,
  description: STEP.validate.title,
  inputSchema: engineInputSchema(SCHEMAS.validate.input),
  outputSchema: SCHEMAS.validate.output,
  execute: withContract(
    STEP.validate.title,
    SCHEMAS.validate,
    async ({ inputData }: StepParams<(typeof SCHEMAS)['validate']>) => {
      const { ok, findings } = validateAttempt(inputData);
      return Promise.resolve({
        ok,
        attempt: inputData.attempt,
        findings,
        question: inputData.question,
        catalog: inputData.catalog,
        plan: inputData.plan,
        calls: inputData.calls,
        queries: inputData.queries,
        imageNotes: inputData.imageNotes,
      });
    },
  ),
});

/** Whether the run checks data quality: its runtime says so (the input). */
function checksDataQuality(requestContext: unknown): boolean {
  const context = requestContext as { get(key: string): unknown } | undefined;
  const runtime = context?.get(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY) as
    AnswerBusinessQuestionRuntime | undefined;
  return runtime?.checksDataQuality === true;
}

// Optional: the engine assesses the tables the queries read, and Sarah
// picks the findings that affect the answer; they reach Write answer as
// findings. A check that cannot run says so in a finding: it never fails
// the run. A stop leaves the findings as they were (Write answer stops).
const checkDataQualityStep = createStep({
  id: STEP['check-data-quality'].id,
  description: STEP['check-data-quality'].title,
  inputSchema: engineInputSchema(SCHEMAS['check-data-quality'].input),
  outputSchema: SCHEMAS['check-data-quality'].output,
  execute: withContract(
    STEP['check-data-quality'].title,
    SCHEMAS['check-data-quality'],
    async (params: StepParams<(typeof SCHEMAS)['check-data-quality']>) => {
      const { inputData } = params;
      const runtime = runtimeOf(params, STEP['check-data-quality'].title);
      if (!runtime.checkDataQuality) {
        throw new Error('The Check data quality step has no check to run');
      }
      const checked = await runtime.checkDataQuality({
        question: inputData.question,
        queries: inputData.queries,
        tables: queriedTables(inputData.queries, inputData.catalog),
      });
      return {
        question: inputData.question,
        plan: inputData.plan,
        queries: inputData.queries,
        findings: checked.stopped
          ? inputData.findings
          : [...inputData.findings, ...checked.findings],
        calls: inputData.calls,
        imageNotes: inputData.imageNotes,
        dataQuality: checked.dataQuality,
      };
    },
  ),
});

const writeAnswerStep = createStep({
  id: STEP['write-answer'].id,
  description: STEP['write-answer'].title,
  inputSchema: engineInputSchema(SCHEMAS['write-answer'].input),
  outputSchema: SCHEMAS['write-answer'].output,
  execute: withContract(
    STEP['write-answer'].title,
    SCHEMAS['write-answer'],
    async (params: StepParams<(typeof SCHEMAS)['write-answer']>) => {
      const { inputData } = params;
      const { answer, stopped } = await runtimeOf(
        params,
        STEP['write-answer'].title,
      ).writeAnswer({
        question: inputData.question,
        plan: inputData.plan,
        queries: inputData.queries,
        findings: inputData.findings,
        imageNotes: inputData.imageNotes,
      });
      const output = { ...answer, calls: inputData.calls };
      // A stopped turn ends here: Wrap up does not run.
      return stopped ? params.bail(output) : output;
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
    async ({ inputData }: StepParams<(typeof SCHEMAS)['wrap-up']>) =>
      Promise.resolve(wrapUp(inputData.calls, inputData.answer)),
  ),
});

/** Any object: what the loop and the branches pass between nested workflows. */
const passOn = z.record(z.string(), z.unknown());

// One round of planning: Plan, then Clarify when the plan needs it (the run
// waits for the answer there). The round ends with Plan's output, or with
// Clarify's (Plan's input with the answer), which sends the loop round again.
const planRoundWorkflow = createWorkflow({
  id: 'plan-round',
  inputSchema: engineInputSchema(planInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  .then(planStep)
  .branch([
    [
      async ({ inputData }) =>
        Promise.resolve(
          inputData.stopped !== true &&
            inputData.plan.needsClarification === true,
        ),
      clarifyStep,
    ],
  ])
  .map(
    async (params) =>
      Promise.resolve(
        ((params.inputData as Record<string, unknown>)['clarify'] ??
          params.getStepResult(planStep)) as Record<string, unknown>,
      ),
    { id: 'plan-round-outcome' },
  )
  .commit();

// One attempt of the analysis: the agent's turn, then the code checks.
const analysisAttemptWorkflow = createWorkflow({
  id: 'analysis-attempt',
  inputSchema: engineInputSchema(analyseInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  .then(analyseStep)
  .then(validateStep)
  .commit();

// The answer: written from the last attempt, then summed up.
const answerPathWorkflow = createWorkflow({
  id: 'answer-path',
  // Write answer's input and the catalog Check data quality reads.
  inputSchema: engineInputSchema(dataQualityInputSchema),
  outputSchema: turnSummarySchema,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  // Check data quality when the run asks for it (its input's
  // `checkDataQuality`); either way Write answer gets Write answer's input.
  .branch([
    [
      async ({ requestContext }) =>
        Promise.resolve(checksDataQuality(requestContext)),
      checkDataQualityStep,
    ],
  ])
  .map(
    async (params) =>
      Promise.resolve(
        ((params.inputData as Record<string, unknown>)['check-data-quality'] ??
          params.getInitData()) as Record<string, unknown>,
      ),
    { id: 'quality-outcome' },
  )
  .then(writeAnswerStep)
  .then(wrapUpStep)
  .commit();

// The clear branch: the analysis, retried once when Validate fails, then
// the answer unless the turn was stopped.
const analysisPathWorkflow = createWorkflow({
  id: 'analysis-path',
  inputSchema: engineInputSchema(analyseInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  .dountil(analysisAttemptWorkflow, async ({ inputData }) =>
    Promise.resolve(analysisLoopDone(inputData as Record<string, unknown>)),
  )
  .branch([
    [
      async ({ inputData }) =>
        Promise.resolve(
          (inputData as Record<string, unknown>)['stopped'] !== true,
        ),
      answerPathWorkflow,
    ],
  ])
  .commit();

export const answerBusinessQuestionWorkflow = createWorkflow({
  id: ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  description:
    'One turn of Insights Analyst: receive the question, load the catalog, plan (asking the user first when the question is ambiguous), then analyse and validate (retried once) and write the answer.',
  inputSchema: answerBusinessQuestionInputSchema,
  outputSchema: answerBusinessQuestionResultSchema,
  options: {
    // The run's input is validated against
    // `answerBusinessQuestionInputSchema` before the first step (the input
    // node has already checked it, api.md 118, 119).
    validateInputs: true,
    // The session document holds the turn's state. Only a suspended run is
    // snapshotted (for its resume); the run's runtime object on the
    // RequestContext is functions only, so nothing of it is kept.
    shouldPersistSnapshot: persistWhileWaiting,
  },
})
  // Reference images (agents.md 2.15, 5.11): Read images runs first only
  // when the run has images; the map passes the input on with its notes.
  .branch([[hasReferenceImages, readImagesStep]])
  .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(receiveQuestionStep)
  .then(loadCatalogStep)
  .dountil(planRoundWorkflow, async ({ inputData }) =>
    Promise.resolve(planLoopDone(inputData as Record<string, unknown>)),
  )
  .branch([
    [
      async ({ inputData }) => {
        const planned = inputData as Record<string, unknown>;
        return Promise.resolve(
          planned['stopped'] !== true &&
            (planned['plan'] as { needsClarification?: unknown } | undefined)
              ?.needsClarification !== true,
        );
      },
      analysisPathWorkflow,
    ],
  ])
  .commit();
