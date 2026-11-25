/**
 * Elena, the Insights Lead (plan Elena 2): answers business questions over
 * the conversation's datasets on her own, in a conversation outside any
 * workflow. Plain data, so the services can read it without loading the
 * framework; the agent itself is built in ./insights-lead.agent.ts.
 */

/** Her registry key (agents.md 1.2). */
export const INSIGHTS_LEAD_AGENT_KEY = 'insights-lead';

/** Her display name (job title). */
export const INSIGHTS_LEAD_NAME = 'Insights Lead';

/** Her description, as the hub shows it. */
export const INSIGHTS_LEAD_DESCRIPTION =
  "Answers business questions over the conversation's datasets on her own: queries them with read-only SQL, checks the results, builds and versions the conversation's dashboard and exports the conversation when asked.";

/** Her tool-loop budget per turn. */
export const INSIGHTS_LEAD_MAX_STEPS = 24;

/**
 * Her tools, in the order her prompt lists them: the dataset tools,
 * `explore_result`, `ask_clarification`, then the gated `submit_dashboard`
 * and `export_conversation`.
 */
export const INSIGHTS_LEAD_TOOL_NAMES: readonly string[] = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'explore_result',
  'ask_clarification',
  'submit_dashboard',
  'export_conversation',
];
