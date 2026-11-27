/**
 * Built-in agents the user talks to directly, outside any workflow: each
 * message is a run of the agent's own binding (ADR-0058, api.md 117).
 */
export const CONVERSATIONAL_AGENT_WORKFLOWS: readonly string[] = [
  'agent:insights-lead',
  'agent:data-readiness-assessor',
];

/** The localStorage key of the conversations panel's state, one for all agents. */
export const CONVERSATIONS_PANEL_KEY =
  'questions-to-insights:agent-conversations-panel';

/** The agent behind a conversational binding (`agent:insights-lead` is `insights-lead`). */
export function agentKeyOfBinding(workflowId: string): string {
  return workflowId.replace(/^agent:/, '');
}

export function bindingOfAgent(agentKey: string): string {
  return `agent:${agentKey}`;
}

export function isConversationalAgentWorkflow(workflowId: string): boolean {
  return CONVERSATIONAL_AGENT_WORKFLOWS.includes(workflowId);
}

/** One row of the conversations list (api.md 168). */
export interface ConversationSummary {
  id: string;
  title: string;
  datasets: string[];
  lastActivityAt: string;
  runCount: number;
  lastRunId: string;
  status: string;
  archivedAt?: string;
}
