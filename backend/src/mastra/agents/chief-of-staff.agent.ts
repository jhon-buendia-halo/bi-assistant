import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { stepModelFrom } from '../step-model';
import { askClarificationTool } from '../tools/clarification.tool';
import { orchestratorTools } from '../tools/orchestrator.tools';
import { catalogFrameworkSkills } from '../skill-sources';
import { ORCHESTRATOR_INSTRUCTIONS } from '../workflows/orchestrated-answer.prompts';

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
  instructions: () =>
    agentInstructions(CHIEF_OF_STAFF_AGENT_KEY, ORCHESTRATOR_INSTRUCTIONS),
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
