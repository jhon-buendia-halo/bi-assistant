import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  AGENT_TURN_RUNTIME_KEY,
  AGENT_TURN_STEPS,
  AGENT_TURN_WORKFLOW_ID,
  type AgentTurnRuntime,
} from './agent-turn.steps';

// The engine of every one-step workflow (ADR-0040; agents.md 5.1, 5.12): one
// `answer` step that runs the session's agent turn. The session code picks
// the agent and hands the turn over on the run's RequestContext, so nothing
// is registered per agent or per user agent.

const [ANSWER] = AGENT_TURN_STEPS;

const turnInput = z.object({
  question: z.string(),
  datasets: z.array(z.string()),
});

// The `analyseOutcome` of qti-v2-turn: what the agent's tool calls were,
// and whether the turn was stopped (Stop or a clarifying question).
const answerOutcome = z.object({
  calls: z.array(
    z.object({
      tool: z.string(),
      rowCount: z.number().optional(),
      failed: z.boolean(),
    }),
  ),
  stopped: z.boolean(),
});

const answerStep = createStep({
  id: ANSWER.id,
  description: ANSWER.title,
  inputSchema: turnInput,
  outputSchema: answerOutcome,
  execute: async (params) => {
    const runtime = params.requestContext.get<
      string,
      AgentTurnRuntime | undefined
    >(AGENT_TURN_RUNTIME_KEY);
    if (!runtime) throw new Error('The Answer step has no turn to run');
    const outcome = await runtime.answer();
    // A stopped turn ends the run here, as v2's Analyse step does.
    return outcome.stopped ? params.bail(outcome) : outcome;
  },
});

export const agentTurnWorkflow = createWorkflow({
  id: AGENT_TURN_WORKFLOW_ID,
  description:
    "One turn of an agent's one-step workflow: the agent answers with its tools.",
  inputSchema: turnInput,
  outputSchema: answerOutcome,
  // The session document holds the turn's state; the run's runtime object
  // on the RequestContext must never be serialized.
  options: { shouldPersistSnapshot: () => false },
})
  .then(answerStep)
  .commit();
