/**
 * Conversational bindings (plan Elena 1.2): each workflow id whose runs are
 * the messages of one conversation with a built-in agent. Avery's workflow
 * (her team) and Elena's own id (alone). Plain data, no framework import.
 */
import { CHIEF_OF_STAFF_AGENT_KEY } from './agent-constants';
import { INSIGHTS_ANALYST_AGENT_KEY } from './agents/insights-analyst-catalog';
import { INSIGHTS_LEAD_AGENT_KEY } from './agents/insights-lead-catalog';
import {
  INSIGHTS_LEAD_ENGINE_ID,
  INSIGHTS_LEAD_WORKFLOW_ID,
} from './workflows/conversation-turn.steps';
import { ORCHESTRATED_MICHAEL_WORKFLOW_ID } from './workflows/orchestrated-answer-michael.steps';

/** One conversational binding. */
export interface ConversationalBinding {
  /** The run's `workflowId`: `orchestrated-answer-michael` | `agent:insights-lead`. */
  workflowId: string;
  /** The registered Mastra workflow its turns run on. */
  engineId: string;
  /** Its one step. */
  stepId: 'orchestrate' | 'answer';
  /** Who the user talks to. */
  agentKey: string;
  /** The run host's agent (its session's `agentKey`). */
  hostAgentKey: string;
  /** `team`: a supervisor who calls her team as tools; `solo`: one agent. */
  kind: 'team' | 'solo';
  /** The export cover's author. */
  author: { name: string; role: string };
}

/** Every conversational binding, Avery's first. */
export const CONVERSATIONAL_BINDINGS: readonly ConversationalBinding[] = [
  {
    workflowId: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
    engineId: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
    stepId: 'orchestrate',
    agentKey: CHIEF_OF_STAFF_AGENT_KEY,
    hostAgentKey: INSIGHTS_ANALYST_AGENT_KEY,
    kind: 'team',
    author: { name: 'Avery', role: 'Chief of Staff' },
  },
  {
    workflowId: INSIGHTS_LEAD_WORKFLOW_ID,
    engineId: INSIGHTS_LEAD_ENGINE_ID,
    stepId: 'answer',
    agentKey: INSIGHTS_LEAD_AGENT_KEY,
    hostAgentKey: INSIGHTS_LEAD_AGENT_KEY,
    kind: 'solo',
    author: { name: 'Elena', role: 'Insights Lead' },
  },
];

/** The binding of a workflow id; undefined for any other id or none. */
export function conversationalBindingOf(
  workflowId?: string,
): ConversationalBinding | undefined {
  if (!workflowId) return undefined;
  return CONVERSATIONAL_BINDINGS.find(
    (binding) => binding.workflowId === workflowId,
  );
}

/** Whether a workflow's runs are the messages of a conversation. */
export function isConversationalWorkflow(workflowId?: string): boolean {
  return conversationalBindingOf(workflowId) !== undefined;
}
