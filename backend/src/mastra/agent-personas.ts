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
  /**
   * How the agent introduces itself, in the first person (agents.md 1.1):
   * one or two short sentences the hub card and the agent page show instead
   * of the technical description. The model never sees it.
   */
  intro: string;
}

/** By registry key; every registered built-in agent has one. */
export const BUILTIN_AGENT_PERSONAS: Readonly<Record<string, AgentPersona>> = {
  'insights-analyst': {
    name: 'Michael',
    role: 'Insights Analyst',
    domain: 'analysis',
    intro:
      'I dig into your datasets to answer the question we planned: I explore the tables, write the SQL and bring back the findings.',
  },
  'insights-lead': {
    name: 'Elena',
    role: 'Insights Lead',
    domain: 'analysis',
    intro:
      'Ask me a business question about your data. I query it, check every figure, build a dashboard when you want one and show how I got each answer.',
  },
  'chief-of-staff': {
    name: 'Avery',
    role: 'Chief of Staff',
    domain: 'analysis',
    intro:
      "I'm your one point of contact for a question: I decide who on the team works on it, brief them, check what they bring back and hand you one answer.",
  },
  visualization: {
    name: 'Ryan',
    role: 'Visualization Designer',
    domain: 'storytelling',
    intro:
      'I pick the chart that tells the story of a result at a glance, and say what to take away from it.',
  },
  'sql-fixer': {
    name: 'David',
    role: 'SQL Developer',
    domain: 'sql',
    intro:
      "Send me a query that failed and I'll read the database error, fix the SQL and try again.",
  },
  'assistant-eval-judge': {
    name: 'Laura',
    role: 'QA Evaluator',
    domain: 'quality',
    intro:
      "I grade the team's answers in evals: I compare what an agent did and said against the rubric, and explain the score.",
  },
  'bi-analyst': {
    name: 'Clara',
    role: 'Business Intelligence Analyst',
    domain: 'storytelling',
    intro:
      'Ask for a dashboard and I build it on your real data: filters, KPIs and charts that recompute as you click, ready to download.',
  },
  'query-explainer': {
    name: 'Hannah',
    role: 'Query Explainer',
    domain: 'sql',
    intro:
      'I explain a SQL query step by step in business words, with how many rows are left after each step.',
  },
  'result-explorer': {
    name: 'Nathan',
    role: 'Result Explorer',
    domain: 'analysis',
    intro:
      "Tell me how to narrow a result, like only Brazil or newest first, and I'll turn it into filters, a sort and a page.",
  },
};

/** The persona of a built-in agent, or undefined for an unknown key. */
export function builtinAgentPersona(key: string): AgentPersona | undefined {
  return BUILTIN_AGENT_PERSONAS[key];
}
