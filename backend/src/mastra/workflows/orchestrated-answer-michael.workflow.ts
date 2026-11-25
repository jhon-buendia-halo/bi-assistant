import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { clarifyingQuestionOf } from './analysis.steps';
import {
  ORCHESTRATED_MICHAEL_RUNTIME_KEY,
  ORCHESTRATED_MICHAEL_STEP_SCHEMAS,
  ORCHESTRATED_MICHAEL_STEPS,
  ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  type OrchestratedMichaelRuntime,
} from './orchestrated-answer-michael.steps';
import { engineInputSchema, withContract } from './workflow-contract';

// Answer a Business Question (Avery + Michael) as a workflow defined in code
// (workflows R45; agents.md 5.23): one step, Orchestrate, where Avery, the
// Chief of Staff, calls the team as her tools. When she asks the user a
// question the step suspends the run (ADR-0043, api.md 138); resumed with
// the answer, she goes on with it. A snapshot is kept only while it waits.

const [ORCHESTRATE] = ORCHESTRATED_MICHAEL_STEPS;
const SCHEMAS = ORCHESTRATED_MICHAEL_STEP_SCHEMAS.orchestrate;

type OrchestrateParams = ExecuteFunctionParams<
  unknown,
  z.output<typeof SCHEMAS.input>,
  z.output<typeof SCHEMAS.output>,
  z.output<typeof SCHEMAS.resume>,
  z.output<typeof SCHEMAS.suspend>,
  DefaultEngineType
>;

const orchestrateStep = createStep({
  id: ORCHESTRATE.id,
  description: ORCHESTRATE.title,
  inputSchema: engineInputSchema(SCHEMAS.input),
  outputSchema: SCHEMAS.output,
  suspendSchema: SCHEMAS.suspend,
  resumeSchema: SCHEMAS.resume,
  execute: withContract(
    ORCHESTRATE.title,
    SCHEMAS,
    async (params: OrchestrateParams) => {
      const runtime: OrchestratedMichaelRuntime | undefined =
        params.requestContext.get(ORCHESTRATED_MICHAEL_RUNTIME_KEY);
      if (!runtime) throw new Error('The Orchestrate step has no turn to run');
      // Resumed after Avery's question: she goes on with the user's answer.
      const asked = params.resumeData
        ? clarifyingQuestionOf(params.suspendData)
        : undefined;
      const answer = params.resumeData?.answer?.trim();
      const done = await runtime.orchestrate({
        question: params.inputData.question,
        ...(asked && answer
          ? {
              answered: {
                question: asked.question,
                options: asked.options,
                answer,
              },
            }
          : {}),
      });
      if (done.clarification && !done.stopped) {
        return params.suspend({
          question: done.clarification.question,
          options: done.clarification.options,
        });
      }
      const output = { answer: done.answer };
      return done.stopped ? params.bail(output) : output;
    },
  ),
});

export const orchestratedMichaelWorkflow = createWorkflow({
  id: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  description:
    'Answer a Business Question (Avery + Michael): Avery, the Chief of Staff, briefs Michael, who answers from the data, and is the only one who talks to the user.',
  inputSchema: SCHEMAS.input,
  outputSchema: SCHEMAS.output,
  options: {
    // Only a run that waits for the user's answer keeps a snapshot.
    shouldPersistSnapshot: ({ workflowStatus }) =>
      workflowStatus === 'suspended',
  },
})
  .then(orchestrateStep)
  .commit();
