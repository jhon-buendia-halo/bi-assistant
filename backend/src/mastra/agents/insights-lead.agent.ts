import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { resolveLinks } from '../agent-links';
import { resolveAgentModel } from '../model-resolver';
import { catalogFrameworkSkills } from '../skill-sources';
import { stepModelFrom } from '../step-model';
import { withToolSection } from '../tool-section';
import { askClarificationTool } from '../tools/clarification.tool';
import { submitDashboardTool } from '../tools/dashboard.tools';
import {
  describeEntityTool,
  listEntitiesTool,
  runReadOnlySqlTool,
  sampleRowsTool,
} from '../tools/dataset.tools';
import { exportConversationTool } from '../tools/export.tools';
import { exploreResultTool } from '../tools/explore-result.tool';
import {
  CONVERSATION_GATES_CONTEXT_KEY,
  type ConversationGates,
} from '../workflows/conversation-turn.steps';
import { CONVERSATION_EXPORT_SKILL } from '../workflows/export-request';
import { INSIGHTS_LEAD_INSTRUCTIONS } from '../workflows/insights-lead.prompts';
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_DESCRIPTION,
  INSIGHTS_LEAD_NAME,
} from './insights-lead-catalog';

export {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_MAX_STEPS,
} from './insights-lead-catalog';

/** Her skill for a dashboard, offered with the dashboard gate open. */
export const DASHBOARD_BUILDING_SKILL = 'dashboard-building';

/** A call's RequestContext, as her resolvers read it. */
interface ContextLike {
  get(key: string): unknown;
}

/**
 * The turn's gates (plan Elena 2.3); undefined with no run (her agent page,
 * the tool details), where everything she can have is listed.
 */
function gatesOf(requestContext?: ContextLike): ConversationGates | undefined {
  return requestContext?.get(CONVERSATION_GATES_CONTEXT_KEY) as
    ConversationGates | undefined;
}

/**
 * Her tools for the call, in the order of `INSIGHTS_LEAD_TOOL_NAMES`: the
 * dataset tools, `explore_result` and `ask_clarification` always (Michael's
 * instances), `submit_dashboard` (Clara's) only with the dashboard gate
 * open, `export_conversation` only with the export gate open.
 */
export function insightsLeadTools(requestContext?: ContextLike) {
  const gates = gatesOf(requestContext);
  return {
    list_entities: listEntitiesTool,
    describe_entity: describeEntityTool,
    sample_rows: sampleRowsTool,
    run_readonly_sql: runReadOnlySqlTool,
    explore_result: exploreResultTool,
    ask_clarification: askClarificationTool,
    ...(!gates || gates.dashboard
      ? { submit_dashboard: submitDashboardTool }
      : {}),
    ...(!gates || gates.export
      ? { export_conversation: exportConversationTool }
      : {}),
  };
}

/**
 * Her on-demand skills for the call (agents.md 7.4), filtered by the same
 * gates as her tools: `dashboard-building` with the dashboard gate open,
 * `conversation-export` with the export gate open; all of them with no run.
 */
export function insightsLeadSkills(requestContext?: ContextLike) {
  const gates = gatesOf(requestContext);
  return catalogFrameworkSkills(INSIGHTS_LEAD_AGENT_KEY).filter(
    (skill) =>
      !gates ||
      (skill.name === DASHBOARD_BUILDING_SKILL
        ? gates.dashboard
        : skill.name === CONVERSATION_EXPORT_SKILL
          ? gates.export
          : true),
  );
}

/**
 * Her prompt as served: the shipped text or its in-app override
 * (ADR-0026), links resolved to plain mentions, with the `## Tools` section
 * generated from the call's tools inserted before `## Working rules`, so
 * the cue-fired repair rule stays last.
 */
export function insightsLeadInstructions(requestContext?: ContextLike): string {
  return withToolSection(
    resolveLinks(
      agentInstructions(INSIGHTS_LEAD_AGENT_KEY, INSIGHTS_LEAD_INSTRUCTIONS),
    ),
    insightsLeadTools(requestContext),
  );
}

/**
 * Elena, the Insights Lead (plan Elena 2): answers the user's business
 * questions alone over the conversation's datasets, in a conversation
 * outside any workflow (a run of `agent:insights-lead`). An Official agent
 * with no memory: the run host sends the conversation as a transcript. Her
 * model is the step model on the call's requestContext, else the saved
 * model (agents.md 1.3).
 */
export const insightsLeadAgent = new Agent({
  id: INSIGHTS_LEAD_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: INSIGHTS_LEAD_NAME,
  description: INSIGHTS_LEAD_DESCRIPTION,
  instructions: ({ requestContext }) =>
    insightsLeadInstructions(requestContext),
  // Loaded on demand through Mastra's skill tools (ADR-0025).
  skills: ({ requestContext }) => insightsLeadSkills(requestContext),
  model: async ({ requestContext }) =>
    resolveAgentModel(stepModelFrom(requestContext)?.model),
  tools: ({ requestContext }) => insightsLeadTools(requestContext),
});
