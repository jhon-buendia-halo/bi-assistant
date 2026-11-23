/**
 * Clara, Business Intelligence Analyst (plan bi-dashboard; agents.md, her
 * section in 2): the teammate Avery calls with build_dashboard to build an
 * interactive dashboard on the user's real rows. Plain data, so the
 * services and Jest can read it without loading the framework; the agent
 * itself is built in ./bi-analyst.agent.ts.
 */
import { BI_ANALYST_AGENT_KEY } from '../agent-constants';
import { SUBMIT_DASHBOARD_TOOL } from '../workflows/bi-dashboard.schemas';

export { BI_ANALYST_AGENT_KEY };

/** Her technical name: traces and Monitoring show it; the hub shows the persona. */
export const BI_ANALYST_NAME = 'Business Intelligence Analyst';

/** Her description, as the agent page shows it. */
export const BI_ANALYST_DESCRIPTION =
  "Builds an interactive dashboard on the user's real rows for Avery: explores the datasets, writes one data query at the widgets' grain and submits the dashboard bound to its columns.";

/** Her tool-loop budget per call (agents.md, her section in 2). */
export const BI_ANALYST_MAX_STEPS = 14;

/**
 * Her tools, in the order her prompt lists them: the dataset tools she
 * explores with, then the one that hands the dashboard to the host.
 */
export const BI_ANALYST_TOOL_NAMES: readonly string[] = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  SUBMIT_DASHBOARD_TOOL,
];
