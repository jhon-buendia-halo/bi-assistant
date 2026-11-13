/**
 * The user persona of each built-in agent (agents.md 1.1, api.md 33): the
 * human name and job title the hub and the agent page show. The Mastra
 * agent keeps its technical `name` (traces, monitoring, workflow steps);
 * the model never sees the persona. Kept here, with no framework import,
 * so the catalogue and its tests can read it without Mastra.
 */
export interface AgentPersona {
  /** A human first name, shown as the agent's name. */
  name: string;
  /** The job title, shown under the name. */
  role: string;
}

/** By registry key; every registered built-in agent has one. */
export const BUILTIN_AGENT_PERSONAS: Readonly<Record<string, AgentPersona>> = {
  assistant: { name: 'Emily', role: 'Data Analyst' },
  'assistant-v2': { name: 'Michael', role: 'Insights Analyst' },
  'data-readiness': { name: 'Sarah', role: 'Data Quality Analyst' },
  visualization: { name: 'Ryan', role: 'Visualization Designer' },
  'sql-fixer': { name: 'David', role: 'SQL Developer' },
  'sql-verifier': { name: 'Rachel', role: 'SQL Reviewer' },
  'knowledge-bootstrap': { name: 'Kevin', role: 'Knowledge Engineer' },
  'assistant-eval-judge': { name: 'Laura', role: 'QA Evaluator' },
  'analysis-planner': { name: 'Olivia', role: 'Analysis Lead' },
  'answer-writer': { name: 'Jessica', role: 'Insights Writer' },
};

/** The persona of a built-in agent, or undefined for an unknown key. */
export function builtinAgentPersona(key: string): AgentPersona | undefined {
  return BUILTIN_AGENT_PERSONAS[key];
}
