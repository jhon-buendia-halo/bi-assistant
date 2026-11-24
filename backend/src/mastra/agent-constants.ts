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
 * The agent that turns a user's words into a view (filters, sort, page) of
 * a stored query's result (agents.md 2.17).
 */
export const RESULT_EXPLORER_AGENT_KEY = 'result-explorer';
/**
 * The agent of Read images, the optional first step of Answer a Business
 * Question, Assess Data Readiness and Map a Dashboard to Data (agents.md
 * 2.15; workflows R35): it describes the run's reference images as text.
 * A System agent: the workflows call it.
 */
export const IMAGE_READER_AGENT_KEY = 'image-reader';
/** Its name: the Read images step's agent. */
export const IMAGE_READER_AGENT_NAME = 'Image Reader';
/** The agent of Review a Website (agents.md 2.16, 5.19). */
export const SITE_REVIEWER_AGENT_KEY = 'site-reviewer';
/** Its name. */
export const SITE_REVIEWER_AGENT_NAME = 'Site Reviewer';

/**
 * The agents of the three model steps of `consumption-gap-analysis`
 * (agents.md 2.18 to 2.20, 5.20): Derive (and Confirm) requirements, Map
 * requirements and Recommend fixes. System agents: the workflow calls them.
 */
export const REQUIREMENTS_ANALYST_AGENT_KEY = 'requirements-analyst';
/** Its name: the Derive requirements step's agent. */
export const REQUIREMENTS_ANALYST_AGENT_NAME = 'Requirements Analyst';
export const LAYER_MAPPER_AGENT_KEY = 'layer-mapper';
/** Its name: the Map requirements step's agent. */
export const LAYER_MAPPER_AGENT_NAME = 'Layer Mapper';
export const GAP_ADVISOR_AGENT_KEY = 'gap-advisor';
/** Its name: the Recommend fixes step's agent. */
export const GAP_ADVISOR_AGENT_NAME = 'Gap Advisor';

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
  DASHBOARD_READER_AGENT_KEY,
  DATA_MAPPER_AGENT_KEY,
  IMAGE_READER_AGENT_KEY,
  QUERY_EXPLAINER_AGENT_KEY,
  RESULT_EXPLORER_AGENT_KEY,
  SITE_REVIEWER_AGENT_KEY,
  REQUIREMENTS_ANALYST_AGENT_KEY,
  LAYER_MAPPER_AGENT_KEY,
  GAP_ADVISOR_AGENT_KEY,
  VISUALIZATION_AGENT_KEY,
  CHIEF_OF_STAFF_AGENT_KEY,
  BI_ANALYST_AGENT_KEY,
  'sql-fixer',
  'sql-verifier',
  'assistant-eval-judge',
  'knowledge-bootstrap',
];
