import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
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

// The turn of Questions to Insights v2 as a workflow defined in code
// (ADR-0034; agents.md 5.11): two deterministic steps, the agent, and a
// deterministic wrap-up, always in this order. Example steps until the
// real ones are defined.

const [RECEIVE, LOAD, ANALYSE, WRAP_UP] = QTI_V2_TURN_STEPS;

const turnInput = z.object({
  question: z.string(),
  datasets: z.array(z.string()),
});

const catalogEntity = z.object({
  entity: z.string(),
  dataset: z.string(),
  datasourceId: z.string().nullable(),
  datasourceKind: z.string().nullable(),
  columnCount: z.number().nullable(),
});

const analyseOutcome = z.object({
  calls: z.array(
    z.object({
      tool: z.string(),
      rowCount: z.number().optional(),
      failed: z.boolean(),
    }),
  ),
  stopped: z.boolean(),
});

const turnSummary = z.object({
  sqlQueries: z.number(),
  failedQueries: z.number(),
  rows: z.number(),
});

const receiveQuestionStep = createStep({
  id: RECEIVE.id,
  description: RECEIVE.title,
  inputSchema: turnInput,
  outputSchema: turnInput,
  execute: async ({ inputData }) =>
    Promise.resolve({
      question: receiveQuestion(inputData.question),
      datasets: inputData.datasets,
    }),
});

const loadCatalogStep = createStep({
  id: LOAD.id,
  description: LOAD.title,
  inputSchema: turnInput,
  outputSchema: z.object({
    question: z.string(),
    catalog: z.array(catalogEntity),
  }),
  execute: async ({ inputData }) => ({
    question: inputData.question,
    catalog: await loadCatalog(inputData.datasets),
  }),
});

const analyseStep = createStep({
  id: ANALYSE.id,
  description: ANALYSE.title,
  inputSchema: z.object({
    question: z.string(),
    catalog: z.array(catalogEntity),
  }),
  outputSchema: analyseOutcome,
  execute: async (params) => {
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
});

const wrapUpStep = createStep({
  id: WRAP_UP.id,
  description: WRAP_UP.title,
  inputSchema: analyseOutcome,
  outputSchema: turnSummary,
  execute: async ({ inputData }) => Promise.resolve(wrapUp(inputData.calls)),
});

export const qtiV2TurnWorkflow = createWorkflow({
  id: QTI_V2_TURN_WORKFLOW_ID,
  description:
    'One turn of Questions to Insights v2: receive the question, load the catalog, analyse with the agent, wrap up.',
  inputSchema: turnInput,
  outputSchema: turnSummary,
  // The session document holds the turn's state; the run's runtime object
  // on the RequestContext must never be serialized.
  options: { shouldPersistSnapshot: () => false },
})
  .then(receiveQuestionStep)
  .then(loadCatalogStep)
  .then(analyseStep)
  .then(wrapUpStep)
  .commit();
