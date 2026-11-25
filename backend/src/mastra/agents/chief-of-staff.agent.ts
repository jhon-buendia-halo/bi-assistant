import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { stepModelFrom } from '../step-model';
import { askClarificationTool } from '../tools/clarification.tool';
import { orchestratorTools } from '../tools/orchestrator.tools';
import { catalogFrameworkSkills } from '../skill-sources';
import {
  ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
  withExportInstructions,
} from '../workflows/orchestrated-answer-michael.prompts';
import { CONVERSATION_EXPORT_SKILL } from '../workflows/export-request';
import {
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer-michael.steps';

/** The run's tools runtime on a call's context, when it is a run's. */
function runtimeOf(requestContext?: {
  get(key: string): unknown;
}): OrchestratorToolsRuntime | undefined {
  return requestContext?.get(ORCHESTRATOR_TOOLS_RUNTIME_KEY) as
    OrchestratorToolsRuntime | undefined;
}

/**
 * Her job description for the run (Avery + Michael, agents.md 5.23): the
 * shipped one, or its in-app override (ADR-0026). With the export gate open
 * (agents.md 2.21) its team line and rule are added; closed, the text is
 * what it was before the export.
 */
export function chiefOfStaffInstructions(requestContext?: {
  get(key: string): unknown;
}): string {
  const runtime = runtimeOf(requestContext);
  const base = agentInstructions(
    CHIEF_OF_STAFF_AGENT_KEY,
    ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
  );
  return runtime?.exportsConversation ? withExportInstructions(base) : base;
}

/**
 * Her skills for the call (agents.md 7.4): the router and playbooks, and
 * the export's format rules only while the export gate is open (Mastra
 * 1.66.0 hands the skills resolver the call's requestContext). With no run
 * (her agent page), every skill she can have.
 */
export function chiefOfStaffSkills(requestContext?: {
  get(key: string): unknown;
}) {
  const runtime = runtimeOf(requestContext);
  return catalogFrameworkSkills(CHIEF_OF_STAFF_AGENT_KEY).filter(
    (skill) =>
      !runtime ||
      runtime.exportsConversation ||
      skill.name !== CONVERSATION_EXPORT_SKILL,
  );
}

/**
 * Avery, Chief of Staff (agents.md 2.21, 5.23): the orchestrator of Answer a
 * Business Question (Avery + Michael) and the only agent the user talks to
 * in it. She calls the team as her tools (Michael, and Clara for a
 * dashboard; mastra/tools/orchestrator.tools.ts) and may ask the user one
 * question (`ask_clarification`). A System agent: the workflow's Orchestrate step
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
    "Orchestrates Answer a Business Question (Avery + Michael): briefs Michael on the user's question, checks his answer and hands back one answer.",
  instructions: ({ requestContext }) =>
    chiefOfStaffInstructions(requestContext),
  // Her router and playbooks, loaded on demand through Mastra's skill tools
  // (agents.md 7.4, ADR-0025); the export's rules with the gate open.
  skills: ({ requestContext }) => chiefOfStaffSkills(requestContext),
  model: async ({ requestContext }) =>
    resolveAgentModel(stepModelFrom(requestContext)?.model),
  tools: ({ requestContext }) => ({
    ...orchestratorTools(requestContext),
    ask_clarification: askClarificationTool,
  }),
});
