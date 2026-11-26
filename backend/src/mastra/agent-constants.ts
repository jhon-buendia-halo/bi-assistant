/**
 * Step budget for one assistant turn — analysis often chains several schema +
 * SQL tool calls. Shared by `TurnOptions.agentContext` (a real chat turn)
 * and the assistant eval harness (`assistant.evals.ts`), so an eval measures
 * the agent under the same constraints production runs it with.
 *
 * Deliberately kept in its own file with no other imports: pulling in this
 * one number must not drag `@mastra/core/agent` (and its ESM-only transitive
 * deps, e.g. `@sindresorhus/slugify`) into modules — like
 * `SessionsService` — that Jest loads under CommonJS and that only need the
 * number, not the `Agent` class.
 */
export const ASSISTANT_MAX_STEPS = 15;

/**
 * The registry keys of the built-in agents shown as Official (api.md 33):
 * the agents a chat can run. Every other registered agent is a System agent
 * (`SYSTEM_AGENT_KEYS`). Kept here, with no framework import, so the
 * workflow catalogue and its drift tests can read them without Mastra.
 */
export const OFFICIAL_AGENT_KEYS: readonly string[] = [
  'assistant',
  'insights-analyst',
  // Elena, the Insights Lead: talked to directly in her own conversation
  // (plan Elena 2), not through a chat.
  'insights-lead',
];

/**
 * Olivia and Jessica, the planner and the writer (agents.md 5.11): System
 * agents of the library, each called in one model call without tools.
 */
export const ANALYSIS_PLANNER_AGENT_KEY = 'analysis-planner';
export const ANSWER_WRITER_AGENT_KEY = 'answer-writer';

/** The agent that explains a stored query step by step (agents.md 2.12). */
export const QUERY_EXPLAINER_AGENT_KEY = 'query-explainer';
/**
 * The agent that turns a user's words into a view (filters, sort, page) of
 * a stored query's result (agents.md 2.17).
 */
export const RESULT_EXPLORER_AGENT_KEY = 'result-explorer';

/**
 * Avery, the Chief of Staff: the orchestrator of Answer a Business Question
 * (orchestrated) and the only agent the user talks to in it (agents.md
 * 2.21, 5.22). A System agent: the workflow calls her.
 */
export const CHIEF_OF_STAFF_AGENT_KEY = 'chief-of-staff';
/** Her name: the Orchestrate step's agent. */
export const CHIEF_OF_STAFF_AGENT_NAME = 'Chief of Staff';

/**
 * Clara, the Business Intelligence Analyst: Avery's teammate behind
 * build_dashboard, who builds interactive dashboards on the user's real rows
 * (plan bi-dashboard). A System agent: Avery's run calls her.
 */
export const BI_ANALYST_AGENT_KEY = 'bi-analyst';

/** Ryan, the visual designer: Generate interactive visuals and Build visual (agents.md 5.11). */
export const VISUALIZATION_AGENT_KEY = 'visualization';

/** The registry keys of the System agents: the app calls them itself. */
export const SYSTEM_AGENT_KEYS: readonly string[] = [
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  QUERY_EXPLAINER_AGENT_KEY,
  RESULT_EXPLORER_AGENT_KEY,
  VISUALIZATION_AGENT_KEY,
  CHIEF_OF_STAFF_AGENT_KEY,
  BI_ANALYST_AGENT_KEY,
  'sql-fixer',
  'sql-verifier',
  'assistant-eval-judge',
  'knowledge-bootstrap',
];
