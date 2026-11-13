/**
 * The user persona of each built-in agent (agents.md 1.1, api.md 33): the
 * human name, job title and domain the hub and the agent page show. The
 * Mastra agent keeps its technical `name` (traces, monitoring, workflow
 * steps); the model never sees the persona. Kept here, with no framework
 * import, so the catalogue and its tests can read it without Mastra.
 */

/**
 * The domain (specialty) an agent belongs to; the Agent Hub groups its cards
 * by domain, in this order (agents-evals R1). `general` is the domain of a
 * user agent whose owner chose none; no built-in agent is `general`.
 */
export const AGENT_DOMAINS = [
  'data-foundations',
  'analysis',
  'sql',
  'storytelling',
  'quality',
  'general',
] as const;

export type AgentDomain = (typeof AGENT_DOMAINS)[number];

/** The domain a user agent has when none was chosen. */
export const DEFAULT_AGENT_DOMAIN = 'general' satisfies AgentDomain;

/** True for a known domain id. */
export function isAgentDomain(value: unknown): value is AgentDomain {
  return (
    typeof value === 'string' &&
    (AGENT_DOMAINS as readonly string[]).includes(value)
  );
}

export interface AgentPersona {
  /** A human first name, shown as the agent's name. */
  name: string;
  /** The job title, shown under the name. */
  role: string;
  /** The specialty the hub groups the agent under. */
  domain: AgentDomain;
}

/** By registry key; every registered built-in agent has one. */
export const BUILTIN_AGENT_PERSONAS: Readonly<Record<string, AgentPersona>> = {
  assistant: { name: 'Emily', role: 'Data Analyst', domain: 'analysis' },
  'assistant-v2': {
    name: 'Michael',
    role: 'Insights Analyst',
    domain: 'analysis',
  },
  'data-readiness': {
    name: 'Sarah',
    role: 'Data Quality Analyst',
    domain: 'data-foundations',
  },
  visualization: {
    name: 'Ryan',
    role: 'Visualization Designer',
    domain: 'storytelling',
  },
  'sql-fixer': { name: 'David', role: 'SQL Developer', domain: 'sql' },
  'sql-verifier': { name: 'Rachel', role: 'SQL Reviewer', domain: 'sql' },
  'knowledge-bootstrap': {
    name: 'Kevin',
    role: 'Knowledge Engineer',
    domain: 'data-foundations',
  },
  'assistant-eval-judge': {
    name: 'Laura',
    role: 'QA Evaluator',
    domain: 'quality',
  },
  'analysis-planner': {
    name: 'Olivia',
    role: 'Analysis Lead',
    domain: 'analysis',
  },
  'answer-writer': {
    name: 'Jessica',
    role: 'Insights Writer',
    domain: 'storytelling',
  },
};

/** The persona of a built-in agent, or undefined for an unknown key. */
export function builtinAgentPersona(key: string): AgentPersona | undefined {
  return BUILTIN_AGENT_PERSONAS[key];
}
