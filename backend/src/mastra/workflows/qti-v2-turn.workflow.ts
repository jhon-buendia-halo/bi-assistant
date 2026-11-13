import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import {
  QTI_V2_TURN_STEP_SCHEMAS,
  turnInputSchema,
  turnSummarySchema,
} from './qti-v2-turn.schemas';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  QTI_V2_TURN_STEPS,
  QTI_V2_TURN_WORKFLOW_ID,
  catalogBlock,
  loadCatalog,
  receiveQuestion,
  wrapUp,
  type QtiV2TurnRuntime,
} from './qti-v2-turn.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// The turn of Questions to Insights v2 as a workflow defined in code
// (ADR-0034; agents.md 5.11): two deterministic steps, the agent, and a
// deterministic wrap-up, always in this order. Example steps until the
// real ones are defined.
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./qti-v2-turn.schemas.ts, and `withContract` validates its input
// before it runs and its output after, so a violation fails the step with
// `Contract violation in <Step title>…` and later steps do not run. The
// engine sees each step's declared input schema but never refuses with it
// (`engineInputSchema`), so that message is the one a run shows.

const [RECEIVE, LOAD, ANALYSE, WRAP_UP] = QTI_V2_TURN_STEPS;
const RECEIVE_SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS['receive-question'];
const LOAD_SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS['load-catalog'];
const ANALYSE_SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS.analyse;
const WRAP_UP_SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS['wrap-up'];

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

const receiveQuestionStep = createStep({
  id: RECEIVE.id,
  description: RECEIVE.title,
  inputSchema: engineInputSchema(RECEIVE_SCHEMAS.input),
  outputSchema: RECEIVE_SCHEMAS.output,
  execute: withContract(
    RECEIVE.title,
    RECEIVE_SCHEMAS,
    async ({ inputData }: StepParams<typeof RECEIVE_SCHEMAS>) =>
      Promise.resolve({
        question: receiveQuestion(inputData.question),
        datasets: inputData.datasets,
      }),
  ),
});

const loadCatalogStep = createStep({
  id: LOAD.id,
  description: LOAD.title,
  inputSchema: engineInputSchema(LOAD_SCHEMAS.input),
  outputSchema: LOAD_SCHEMAS.output,
  execute: withContract(
    LOAD.title,
    LOAD_SCHEMAS,
    async ({ inputData }: StepParams<typeof LOAD_SCHEMAS>) => ({
      question: inputData.question,
      catalog: await loadCatalog(inputData.datasets),
    }),
  ),
});

const analyseStep = createStep({
  id: ANALYSE.id,
  description: ANALYSE.title,
  inputSchema: engineInputSchema(ANALYSE_SCHEMAS.input),
  outputSchema: ANALYSE_SCHEMAS.output,
  execute: withContract(
    ANALYSE.title,
    ANALYSE_SCHEMAS,
    async (params: StepParams<typeof ANALYSE_SCHEMAS>) => {
      const { inputData, requestContext } = params;
      const runtime = requestContext.get<string, QtiV2TurnRuntime | undefined>(
        QTI_V2_TURN_RUNTIME_KEY,
      );
      if (!runtime) throw new Error('The Analyse step has no turn to run');
      const outcome = await runtime.analyse({
        question: inputData.question,
        catalog: inputData.catalog,
        catalogBlock: catalogBlock(inputData.catalog),
      });
      // A stopped turn ends here: Wrap up does not run.
      return outcome.stopped ? params.bail(outcome) : outcome;
    },
  ),
});

const wrapUpStep = createStep({
  id: WRAP_UP.id,
  description: WRAP_UP.title,
  inputSchema: engineInputSchema(WRAP_UP_SCHEMAS.input),
  outputSchema: WRAP_UP_SCHEMAS.output,
  execute: withContract(
    WRAP_UP.title,
    WRAP_UP_SCHEMAS,
    async ({ inputData }: StepParams<typeof WRAP_UP_SCHEMAS>) =>
      Promise.resolve(wrapUp(inputData.calls)),
  ),
});

export const qtiV2TurnWorkflow = createWorkflow({
  id: QTI_V2_TURN_WORKFLOW_ID,
  description:
    'One turn of Questions to Insights v2: receive the question, load the catalog, analyse with the agent, wrap up.',
  inputSchema: turnInputSchema,
  outputSchema: turnSummarySchema,
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
  .then(analyseStep)
  .then(wrapUpStep)
  .commit();
