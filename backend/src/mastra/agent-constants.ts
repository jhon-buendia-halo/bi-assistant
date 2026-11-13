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

/**
 * The registry keys of the built-in agents shown as Official (api.md 33):
 * the agents a chat can run. Every other registered agent is a System agent
 * (`SYSTEM_AGENT_KEYS`). Kept here, with no framework import, so the
 * workflow catalogue and its drift tests can read them without Mastra.
 */
export const OFFICIAL_AGENT_KEYS: readonly string[] = [
  'assistant',
  'assistant-v2',
  'data-readiness',
];

/**
 * The agents of the two model-only steps of `qti-v2-turn` (agents.md 5.11):
 * Plan and Write answer. System agents: the workflow calls them.
 */
export const ANALYSIS_PLANNER_AGENT_KEY = 'analysis-planner';
export const ANSWER_WRITER_AGENT_KEY = 'answer-writer';

/** The registry keys of the System agents: the app calls them itself. */
export const SYSTEM_AGENT_KEYS: readonly string[] = [
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  'visualization',
  'sql-fixer',
  'sql-verifier',
  'assistant-eval-judge',
  'knowledge-bootstrap',
];
