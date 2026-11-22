import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { stepModelFrom } from '../step-model';
import { askClarificationTool } from '../tools/clarification.tool';
import { orchestratorTools } from '../tools/orchestrator.tools';
import { catalogFrameworkSkills } from '../skill-sources';
import {
  ORCHESTRATOR_INSTRUCTIONS,
  ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
} from '../workflows/orchestrated-answer.prompts';
import {
  MICHAEL_ANSWER_TOOL,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer.steps';

/**
 * Her job description for the run: with Michael alone (Avery + Michael,
 * agents.md 5.23) the shipped one for her team of one; else her whole
 * team's, or its in-app override (ADR-0026).
 */
export function chiefOfStaffInstructions(requestContext?: {
  get(key: string): unknown;
}): string {
  const runtime = requestContext?.get(ORCHESTRATOR_TOOLS_RUNTIME_KEY) as
    OrchestratorToolsRuntime | undefined;
  return runtime?.tools.includes(MICHAEL_ANSWER_TOOL)
    ? ORCHESTRATOR_MICHAEL_INSTRUCTIONS
    : agentInstructions(CHIEF_OF_STAFF_AGENT_KEY, ORCHESTRATOR_INSTRUCTIONS);
}

/**
 * Avery, Chief of Staff (agents.md 2.21, 5.22): the orchestrator of Answer a
 * Business Question (orchestrated) and the only agent the user talks to in
 * it. She calls the team as her tools (Zoe, Olivia, Michael, Jessica, Ryan;
 * mastra/tools/orchestrator.tools.ts) and may ask the user one question
 * (`ask_clarification`). A System agent: the workflow's Orchestrate step
 * streams her; her job description is the shipped instructions or their
 * in-app override (ADR-0026). Her model is the workflow's orchestrator model
 * on the call's requestContext (Opus 5.5 at high effort when the saved
 * model is a Claude model), else the saved model.
 */
export const chiefOfStaffAgent = new Agent({
  id: CHIEF_OF_STAFF_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Chief of Staff',
  description:
    "Orchestrates Answer a Business Question (orchestrated): decides which agents work on the user's question, briefs them and hands back one answer.",
  instructions: ({ requestContext }) =>
    chiefOfStaffInstructions(requestContext),
  // Her router and playbooks, loaded on demand through Mastra's skill tools
  // (agents.md 7.4, ADR-0025).
  skills: () => catalogFrameworkSkills(CHIEF_OF_STAFF_AGENT_KEY),
  model: async ({ requestContext }) =>
    resolveAgentModel(stepModelFrom(requestContext)?.model),
  tools: ({ requestContext }) => ({
    ...orchestratorTools(requestContext),
    ask_clarification: askClarificationTool,
  }),
});
