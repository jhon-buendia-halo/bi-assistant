import { createStep, createWorkflow } from '@mastra/core/workflows';
import {
  ORCHESTRATED_ANSWER_RUNTIME_KEY,
  ORCHESTRATED_ANSWER_STEP_SCHEMAS,
  ORCHESTRATED_ANSWER_STEPS,
  ORCHESTRATED_ANSWER_WORKFLOW_ID,
  ORCHESTRATED_PLACEHOLDER_ANSWER,
  type OrchestratedAnswerRuntime,
} from './orchestrated-answer.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// Answer a Business Question (orchestrated) as a workflow defined in code
// (workflows R45; agents.md 5.22): for now one placeholder step that writes
// the run's answer by code. The orchestrator (a supervisor agent that calls
// the other agents as its tools) replaces it once it is built.

const [ORCHESTRATE] = ORCHESTRATED_ANSWER_STEPS;
const SCHEMAS = ORCHESTRATED_ANSWER_STEP_SCHEMAS.orchestrate;

const orchestrateStep = createStep({
  id: ORCHESTRATE.id,
  description: ORCHESTRATE.title,
  inputSchema: engineInputSchema(SCHEMAS.input),
  outputSchema: SCHEMAS.output,
  execute: withContract(
    ORCHESTRATE.title,
    SCHEMAS,
    async ({
      requestContext,
    }: {
      inputData: unknown;
      requestContext: { get(key: string): unknown };
    }) => {
      const runtime = requestContext.get(ORCHESTRATED_ANSWER_RUNTIME_KEY) as
        OrchestratedAnswerRuntime | undefined;
      if (!runtime) throw new Error('The Orchestrate step has no turn to run');
      await runtime.deliverAnswer(ORCHESTRATED_PLACEHOLDER_ANSWER);
      return { answer: ORCHESTRATED_PLACEHOLDER_ANSWER };
    },
  ),
});

export const orchestratedAnswerWorkflow = createWorkflow({
  id: ORCHESTRATED_ANSWER_WORKFLOW_ID,
  description:
    'Answer a Business Question (orchestrated): a supervisor agent will choose which agents answer the question. Not built yet: one placeholder step.',
  inputSchema: SCHEMAS.input,
  outputSchema: SCHEMAS.output,
  // It never waits: nothing to resume, so no snapshot.
  options: { shouldPersistSnapshot: () => false },
})
  .then(orchestrateStep)
  .commit();
