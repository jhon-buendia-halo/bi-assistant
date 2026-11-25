import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { clarifyingQuestionOf } from './analysis.steps';
import {
  CONVERSATION_STEP_SCHEMAS,
  CONVERSATION_TURN_RUNTIME_KEY,
  INSIGHTS_LEAD_ENGINE_ID,
  INSIGHTS_LEAD_STEP_SCHEMAS,
  INSIGHTS_LEAD_STEPS,
  type ConversationTurnRuntime,
} from './conversation-turn.steps';
import {
  engineInputSchema,
  withContract,
  type ContractStepEntry,
} from './workflow-contract';

// One turn of a conversation with a built-in agent (plan Elena 1.3; agents.md
// 5.23): one agent step that runs the run's `ConversationTurnRuntime`.
// Avery's Orchestrate (her team as tools) and Elena's Answer (alone) are both
// built here. When the agent asks the user a question the step suspends the
// run (ADR-0043, api.md 138); resumed with the answer, the agent goes on
// with it. A snapshot is kept only while it waits.

/**
 * A conversation step's schemas: Avery's (`CONVERSATION_STEP_SCHEMAS`) or
 * Elena's, whose output also carries `attempts`. Typed as the wider one;
 * each step parses with its own, so Avery's output stays `{ answer }`.
 */
type StepSchemas = typeof INSIGHTS_LEAD_STEP_SCHEMAS;

type TurnParams = ExecuteFunctionParams<
  unknown,
  z.output<StepSchemas['input']>,
  z.output<StepSchemas['output']>,
  z.output<StepSchemas['resume']>,
  z.output<StepSchemas['suspend']>,
  DefaultEngineType
>;

/** The conversation step: the runtime's turn, suspending on its question. */
function conversationStep(
  step: ContractStepEntry,
  schemas: typeof CONVERSATION_STEP_SCHEMAS | StepSchemas,
) {
  const SCHEMAS = schemas as StepSchemas;
  return createStep({
    id: step.id,
    description: step.title,
    inputSchema: engineInputSchema(SCHEMAS.input),
    outputSchema: SCHEMAS.output,
    suspendSchema: SCHEMAS.suspend,
    resumeSchema: SCHEMAS.resume,
    execute: withContract(step.title, SCHEMAS, async (params: TurnParams) => {
      const runtime: ConversationTurnRuntime | undefined =
        params.requestContext.get(CONVERSATION_TURN_RUNTIME_KEY);
      if (!runtime) {
        throw new Error(`The ${step.title} step has no turn to run`);
      }
      // Resumed after the agent's question: it goes on with the answer.
      const asked = params.resumeData
        ? clarifyingQuestionOf(params.suspendData)
        : undefined;
      const answer = params.resumeData?.answer?.trim();
      const done = await runtime.turn({
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
      const output = {
        answer: done.answer,
        ...(done.attempts ? { attempts: done.attempts } : {}),
      };
      return done.stopped ? params.bail(output) : output;
    }),
  });
}

/**
 * A conversation's engine: `id` the registered workflow, `step` its one
 * agent step (Avery's Orchestrate, Elena's Answer).
 */
export function conversationTurnWorkflow(spec: {
  id: string;
  step: ContractStepEntry;
  description: string;
  /** The step's schemas; a conversation step's (Avery's) when absent. */
  schemas?: StepSchemas;
}) {
  const schemas = spec.schemas ?? CONVERSATION_STEP_SCHEMAS;
  return createWorkflow({
    id: spec.id,
    description: spec.description,
    inputSchema: schemas.input,
    outputSchema: schemas.output as StepSchemas['output'],
    options: {
      // Only a run that waits for the user's answer keeps a snapshot.
      shouldPersistSnapshot: ({ workflowStatus }) =>
        workflowStatus === 'suspended',
    },
  })
    .then(conversationStep(spec.step, schemas))
    .commit();
}

const [ANSWER] = INSIGHTS_LEAD_STEPS;

/** Elena's conversation (plan Elena 1.3): her one Answer step, alone. */
export const insightsLeadConversationWorkflow = conversationTurnWorkflow({
  id: INSIGHTS_LEAD_ENGINE_ID,
  step: ANSWER,
  schemas: INSIGHTS_LEAD_STEP_SCHEMAS,
  description:
    'A conversation with Elena, the Insights Lead: she answers from the data on her own, outside any workflow.',
});
