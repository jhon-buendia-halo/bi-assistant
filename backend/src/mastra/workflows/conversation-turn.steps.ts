/**
 * One turn of a conversation with a built-in agent (plan Elena 1.2): Avery's
 * Orchestrate and Elena's Answer share its step schemas and runtime. Plain
 * data and pure code, no framework import.
 */
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
} from './workflow-contract';
import { ORCHESTRATED_MICHAEL_STEP_SCHEMAS } from './orchestrated-answer-michael.steps';

/** The run's RequestContext key holding its `ConversationTurnRuntime`. */
export const CONVERSATION_TURN_RUNTIME_KEY = 'conversation-turn-runtime';

/** What the session code hands a conversation's run on its RequestContext. */
export interface ConversationTurnRuntime {
  /**
   * The agent's turn: the run's answer, whether the user stopped it, and a
   * question the agent asks the user as `clarification` (the step waits for
   * the answer, then runs the turn again with it as `answered`).
   */
  turn(input: {
    question: string;
    answered?: { question: string; options: string[]; answer: string };
  }): Promise<{
    answer: string;
    stopped: boolean;
    clarification?: { question: string; options: string[] };
  }>;
}

/**
 * A conversation step's input, output, suspend and resume (agents.md 5.12):
 * Avery's Orchestrate's, shared so her contract hash is unchanged.
 */
export const CONVERSATION_STEP_SCHEMAS =
  ORCHESTRATED_MICHAEL_STEP_SCHEMAS.orchestrate;

/** Elena's binding id: her own conversation, outside any workflow. */
export const INSIGHTS_LEAD_WORKFLOW_ID = 'agent:insights-lead';

/** The registered Mastra workflow her turns run on. */
export const INSIGHTS_LEAD_ENGINE_ID = 'insights-lead-conversation';

/** Her one step, Answer. */
export const INSIGHTS_LEAD_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'answer',
      title: 'Answer',
      kind: 'agent',
      summary:
        'Elena, the Insights Lead, queries your data, checks every figure and writes the answer. She builds a dashboard or exports the conversation when you ask.',
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
        { label: 'if it asks you a question', outcome: 'waits' },
      ],
    },
    CONVERSATION_STEP_SCHEMAS,
  ),
];

/** The edges (api.md 117): Start → Answer → End. */
export const INSIGHTS_LEAD_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'answer', kind: 'next' },
  { from: 'answer', to: 'end', kind: 'next' },
];

/**
 * The requestContext key of a turn's gates: which of the agent's gated tools
 * (`submit_dashboard`, `export_conversation`) it is offered.
 */
export const CONVERSATION_GATES_CONTEXT_KEY = 'conversation-gates';

/** A turn's gates, under `CONVERSATION_GATES_CONTEXT_KEY`. */
export interface ConversationGates {
  dashboard: boolean;
  export: boolean;
}
