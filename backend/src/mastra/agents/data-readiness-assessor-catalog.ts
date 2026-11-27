/**
 * Dana, the Data Readiness Assessor (plan data-readiness-assessor 2): tells
 * the requester whether the conversation's datasets are ready for one use,
 * in her own conversation outside any workflow. Plain data, so the services
 * can read it without loading the framework; the agent itself is built in
 * ./data-readiness-assessor.agent.ts.
 */

/** Her registry key (agents.md 1.2). */
export const DATA_READINESS_ASSESSOR_AGENT_KEY = 'data-readiness-assessor';

/** Her display name (job title). */
export const DATA_READINESS_ASSESSOR_NAME = 'Data Readiness Assessor';

/** Her description, as the hub shows it. */
export const DATA_READINESS_ASSESSOR_DESCRIPTION =
  "Assesses whether the conversation's datasets are ready for one use case: scopes the use with the requester, measures availability, quality, freshness, semantics, governance and AI fitness in code, quotes the rubric's verdict with its evidence and writes a prioritised remediation plan.";

/** Her tool-loop budget per turn. */
export const DATA_READINESS_ASSESSOR_MAX_STEPS = 20;

/**
 * Her tools, in the order her prompt lists them: the data kit,
 * `ask_clarification`, then `assess_readiness`.
 */
export const DATA_READINESS_ASSESSOR_TOOL_NAMES: readonly string[] = [
  'list_entities',
  'describe_entity',
  'run_readonly_sql',
  'sample_rows',
  'explore_result',
  'ask_clarification',
  'assess_readiness',
];
