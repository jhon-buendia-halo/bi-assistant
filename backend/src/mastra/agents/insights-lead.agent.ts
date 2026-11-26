import { defineBuiltinAgent, servedPromptWithTools } from '../agent-factory';
import { frameworkSkills, skillSourcesFor } from '../agent-skill-sources';
import { agentSkillsFrom } from '../agent-skills';
import { selects, toolSelectionFrom } from '../agent-tools';
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
import {
  INSIGHTS_LEAD_ASK_RULE_START,
  INSIGHTS_LEAD_INSTRUCTIONS,
  INSIGHTS_LEAD_NO_CLARIFICATION_RULE,
} from '../workflows/insights-lead.prompts';
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
 * dataset tools and `explore_result` always (Michael's instances),
 * `sample_rows` and `ask_clarification` unless a user agent's selection
 * leaves them out (ADR-0059), `submit_dashboard` (Clara's) only with the
 * dashboard gate open, `export_conversation` only with the export gate open.
 */
export function insightsLeadTools(requestContext?: ContextLike) {
  const gates = gatesOf(requestContext);
  const selection = toolSelectionFrom(requestContext);
  return {
    list_entities: listEntitiesTool,
    describe_entity: describeEntityTool,
    ...(selects(selection, 'sample_rows')
      ? { sample_rows: sampleRowsTool }
      : {}),
    run_readonly_sql: runReadOnlySqlTool,
    explore_result: exploreResultTool,
    ...(selects(selection, 'ask_clarification')
      ? { ask_clarification: askClarificationTool }
      : {}),
    ...(!gates || gates.dashboard
      ? { submit_dashboard: submitDashboardTool }
      : {}),
    ...(!gates || gates.export
      ? { export_conversation: exportConversationTool }
      : {}),
  };
}

/**
 * Her on-demand skills for the call (agents.md 7.4): her catalogue,
 * filtered by the same gates as her tools (`dashboard-building` with the
 * dashboard gate open, `conversation-export` with the export gate open; all
 * of them with no run), then a user agent's in-app skills on the call
 * (ADR-0059), each replacing a catalogue skill of the same name.
 */
export function insightsLeadSkills(requestContext?: ContextLike) {
  const gates = gatesOf(requestContext);
  const own = agentSkillsFrom(requestContext) ?? [];
  const ownNames = new Set(own.map((skill) => skill.name));
  const gated = (name: string) =>
    !gates ||
    (name === DASHBOARD_BUILDING_SKILL
      ? gates.dashboard
      : name === CONVERSATION_EXPORT_SKILL
        ? gates.export
        : true);
  return frameworkSkills(
    skillSourcesFor(INSIGHTS_LEAD_AGENT_KEY, own).filter(
      (skill) => ownNames.has(skill.name) || gated(skill.name),
    ),
  );
}

/**
 * Her prompt as served: the shipped text or its in-app override
 * (ADR-0026), links resolved to plain mentions, with the `## Tools` section
 * generated from the call's tools inserted before `## Working rules`, so
 * the cue-fired repair rule stays last. Without `ask_clarification` (a user
 * agent's selection, ADR-0059) her asking rule becomes the no-clarification
 * rule, in place.
 */
export function insightsLeadInstructions(requestContext?: ContextLike): string {
  const tools = insightsLeadTools(requestContext);
  const served = servedPromptWithTools(
    INSIGHTS_LEAD_AGENT_KEY,
    INSIGHTS_LEAD_INSTRUCTIONS,
    tools,
  );
  if ('ask_clarification' in tools) return served;
  return served
    .split('\n')
    .map((line) =>
      line.startsWith(INSIGHTS_LEAD_ASK_RULE_START)
        ? INSIGHTS_LEAD_NO_CLARIFICATION_RULE
        : line,
    )
    .join('\n');
}

/**
 * Elena, the Insights Lead (plan Elena 2): answers the user's business
 * questions alone over the conversation's datasets, in a conversation
 * outside any workflow (a run of `agent:insights-lead`). An Official agent
 * with no memory: the run host sends the conversation as a transcript. Her
 * model is a user agent's override, else the step model on the call's
 * requestContext, else the saved model (agents.md 1.3). She also runs user
 * agents: their instructions, tools and skills come on the call (ADR-0059).
 */
export const insightsLeadAgent = defineBuiltinAgent({
  key: INSIGHTS_LEAD_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: INSIGHTS_LEAD_NAME,
  description: INSIGHTS_LEAD_DESCRIPTION,
  classes: ['person', 'data'],
  instructions: insightsLeadInstructions,
  // Loaded on demand through Mastra's skill tools (ADR-0025).
  skills: ({ requestContext }) => insightsLeadSkills(requestContext),
  // A user agent's model override wins over her routing (ADR-0059).
  model: 'override-or-step-model',
  tools: ({ requestContext }) => insightsLeadTools(requestContext),
});
