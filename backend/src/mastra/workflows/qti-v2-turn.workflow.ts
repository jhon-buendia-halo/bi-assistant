import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import { z } from 'zod';
import { analysePlanBlock } from './qti-v2-turn.prompts';
import {
  QTI_V2_TURN_STEP_SCHEMAS,
  analyseInputSchema,
  qtiV2TurnResultSchema,
  turnInputSchema,
  turnSummarySchema,
  writeAnswerInputSchema,
} from './qti-v2-turn.schemas';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  QTI_V2_TURN_STEPS,
  QTI_V2_TURN_WORKFLOW_ID,
  analysisLoopDone,
  catalogBlock,
  loadCatalog,
  receiveQuestion,
  validateAttempt,
  wrapUp,
  type QtiV2TurnRuntime,
} from './qti-v2-turn.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The turn of Questions to Insights v2 as a workflow defined in code
// (ADR-0034; agents.md 5.11), on Mastra's control flow
// (https://mastra.ai/docs/workflows/control-flow):
//
//   receive-question → load-catalog → plan → .branch()
//     needs clarification → clarify                     (the run ends)
//     clear → analysis-path:
//       .dountil(analysis-attempt: analyse → validate, ok or 2 attempts)
//       → .branch(not stopped → answer-path: write-answer → wrap-up)
//
// The nested workflows (`analysis-path`, `analysis-attempt`,
// `answer-path`) are not catalogue steps: the engine reports their steps as
// `<parent>.<child>.<step>`, and the session code reads the last segment.
// A step's bail ends only the sequence it is in, so a stopped Analyse ends
// its attempt, the loop's condition sees `stopped`, and the answer path is
// not taken (its steps end `skipped`).
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./qti-v2-turn.schemas.ts, and `withContract` validates its input
// before it runs and its output after, so a violation fails the step with
// `Contract violation in <Step title>…` and later steps do not run. The
// engine sees each step's declared input schema but never refuses with it
// (`engineInputSchema`), so that message is the one a run shows.

const STEP = Object.fromEntries(
  QTI_V2_TURN_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof QTI_V2_TURN_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS;

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

/** The run's turn, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): QtiV2TurnRuntime {
  const runtime = params.requestContext.get(QTI_V2_TURN_RUNTIME_KEY) as
    QtiV2TurnRuntime | undefined;
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
      catalog: await loadCatalog(inputData.datasets),
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
      const { plan, stopped } = await runtimeOf(params, STEP.plan.title).plan({
        question: inputData.question,
        catalog: inputData.catalog,
        catalogBlock: catalogBlock(inputData.catalog),
      });
      const output = {
        question: inputData.question,
        catalog: inputData.catalog,
        plan,
      };
      // A stopped turn ends here: nothing after Plan runs.
      return stopped ? params.bail(output) : output;
    },
  ),
});

const clarifyStep = createStep({
  id: STEP.clarify.id,
  description: STEP.clarify.title,
  inputSchema: engineInputSchema(SCHEMAS.clarify.input),
  outputSchema: SCHEMAS.clarify.output,
  execute: withContract(
    STEP.clarify.title,
    SCHEMAS.clarify,
    async (params: StepParams<(typeof SCHEMAS)['clarify']>) => {
      const asked = params.inputData.plan.clarification;
      if (!asked) throw new Error('The plan asked no clarifying question');
      await runtimeOf(params, STEP.clarify.title).clarify(asked);
      // The run ends on the question, as a clarifying question always has.
      return params.bail({ question: asked.question, options: asked.options });
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
      const attemptResult = await runtimeOf(params, STEP.analyse.title).analyse(
        {
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
        },
      );
      const outcome = {
        question: inputData.question,
        catalog: inputData.catalog,
        plan: inputData.plan,
        attempt,
        ...attemptResult,
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
      });
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

// One attempt of the analysis: the agent's turn, then the code checks.
const analysisAttemptWorkflow = createWorkflow({
  id: 'analysis-attempt',
  inputSchema: engineInputSchema(analyseInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: () => false },
})
  .then(analyseStep)
  .then(validateStep)
  .commit();

// The answer: written from the last attempt, then summed up.
const answerPathWorkflow = createWorkflow({
  id: 'answer-path',
  inputSchema: engineInputSchema(writeAnswerInputSchema),
  outputSchema: turnSummarySchema,
  options: { shouldPersistSnapshot: () => false },
})
  .then(writeAnswerStep)
  .then(wrapUpStep)
  .commit();

// The clear branch: the analysis, retried once when Validate fails, then
// the answer unless the turn was stopped.
const analysisPathWorkflow = createWorkflow({
  id: 'analysis-path',
  inputSchema: engineInputSchema(analyseInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: () => false },
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

export const qtiV2TurnWorkflow = createWorkflow({
  id: QTI_V2_TURN_WORKFLOW_ID,
  description:
    'One turn of Questions to Insights v2: receive the question, load the catalog, plan, then clarify, or analyse and validate (retried once) and write the answer.',
  inputSchema: turnInputSchema,
  outputSchema: qtiV2TurnResultSchema,
  options: {
    // The run's input is validated against `turnInputSchema` before the
    // first step (the input node has already checked it, api.md 118, 119).
    validateInputs: true,
    // The session document holds the turn's state; the run's runtime object
    // on the RequestContext must never be serialized.
    shouldPersistSnapshot: () => false,
  },
})
  .then(receiveQuestionStep)
  .then(loadCatalogStep)
  .then(planStep)
  .branch([
    [
      async ({ inputData }) =>
        Promise.resolve(inputData.plan.needsClarification === true),
      clarifyStep,
    ],
    [
      async ({ inputData }) =>
        Promise.resolve(inputData.plan.needsClarification !== true),
      analysisPathWorkflow,
    ],
  ])
  .commit();
