/**
 * Insights Analyst (BA-320; agents.md, its section in 2): the
 * business data analyst built up next to the `assistant`. Plain data, so the
 * services can read it without loading the framework; the agent itself is
 * built in ./insights-analyst.agent.ts.
 */

/** Its registry key (agents.md 1.2). */
export const INSIGHTS_ANALYST_AGENT_KEY = 'insights-analyst';

/** Its display name; a session bound to it stores it as `agentName`. */
export const INSIGHTS_ANALYST_NAME = 'Insights Analyst';

/** Its description, as the hub and its code-defined workflow show it. */
export const INSIGHTS_ANALYST_DESCRIPTION =
  'A business data analyst: answers questions over the datasets you pick with read-only SQL, checks its results and explains how it got them.';

/** Where its prompt, shipped or overridden, must start (api.md 103). */
export const INSIGHTS_ANALYST_IDENTITY_START = 'You are Questions to Insights';

/** Its tool-loop budget per turn (agents.md, its section in 2). */
export const INSIGHTS_ANALYST_MAX_STEPS = 15;

/**
 * Its tools, in the order its prompt lists them: the assistant's dataset
 * tools, then its clarification tool.
 */
export const INSIGHTS_ANALYST_TOOL_NAMES: readonly string[] = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'ask_clarification',
];
