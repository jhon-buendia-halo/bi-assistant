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

/** The Data Readiness Agent's tool-loop budget per turn (agents.md 2.10). */
export const DATA_READINESS_MAX_STEPS = 10;

/** The Data Readiness Agent's registry key (agents.md 2.10, ADR-0031). */
export const DATA_READINESS_AGENT_KEY = 'data-readiness';

/** Its name: the Explain report step's agent (agents.md 5.13). */
export const DATA_READINESS_AGENT_NAME = 'Data Readiness Agent';

/**
 * The registry keys of the built-in agents shown as Official (api.md 33):
 * the agents a chat can run. Every other registered agent is a System agent
 * (`SYSTEM_AGENT_KEYS`). Kept here, with no framework import, so the
 * workflow catalogue and its drift tests can read them without Mastra.
 */
export const OFFICIAL_AGENT_KEYS: readonly string[] = [
  'assistant',
  'insights-analyst',
  'data-readiness',
];

/**
 * The agents of the two model-only steps of `answer-business-question` (agents.md 5.11):
 * Plan and Write answer. System agents: the workflow calls them.
 */
export const ANALYSIS_PLANNER_AGENT_KEY = 'analysis-planner';
export const ANSWER_WRITER_AGENT_KEY = 'answer-writer';

/**
 * The agents of Read dashboard, the model step of `recreate-dashboard`
 * (agents.md 5.17), and of Map data, the model step of `map-dashboard-data`
 * (5.18). System agents: the workflows call them.
 */
export const DASHBOARD_READER_AGENT_KEY = 'dashboard-reader';
/** Its name: the Read dashboard step's agent. */
export const DASHBOARD_READER_AGENT_NAME = 'Dashboard Reader';
export const DATA_MAPPER_AGENT_KEY = 'data-mapper';
/** Its name: the Map data step's agent. */
export const DATA_MAPPER_AGENT_NAME = 'Data Mapper';
/** The agent that explains a stored query step by step (agents.md 2.12). */
export const QUERY_EXPLAINER_AGENT_KEY = 'query-explainer';
/**
 * The agent of Read images, the optional first step of Answer a Business
 * Question, Assess Data Readiness and Map a Dashboard to Data (agents.md
 * 2.15; workflows R35): it describes the run's reference images as text.
 * A System agent: the workflows call it.
 */
export const IMAGE_READER_AGENT_KEY = 'image-reader';
/** Its name: the Read images step's agent. */
export const IMAGE_READER_AGENT_NAME = 'Image Reader';

/** The registry keys of the System agents: the app calls them itself. */
export const SYSTEM_AGENT_KEYS: readonly string[] = [
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  DASHBOARD_READER_AGENT_KEY,
  DATA_MAPPER_AGENT_KEY,
  IMAGE_READER_AGENT_KEY,
  QUERY_EXPLAINER_AGENT_KEY,
  'visualization',
  'sql-fixer',
  'sql-verifier',
  'assistant-eval-judge',
  'knowledge-bootstrap',
];
