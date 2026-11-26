import { INSIGHTS_ANALYST_AGENT_KEY } from '../../mastra/agents/insights-analyst-catalog';

/**
 * Built-in agents whose sessions run over the datasets the user picks, as a
 * plain session's do (BA-320): Insights Analyst. They declare no
 * dataset, so the hub shows no datasets and no requirement for them, and
 * `POST /sessions` with their key validates the name and datasets of the
 * request as for a session without an agent, then binds the session to the
 * agent by its registry key (ADR-0028).
 */
export const PICKED_DATASETS_AGENT_KEYS: readonly string[] = [
  INSIGHTS_ANALYST_AGENT_KEY,
];

/** Whether a session bound to built-in `key` runs over picked datasets. */
export function runsOnPickedDatasets(key: string): boolean {
  return PICKED_DATASETS_AGENT_KEYS.includes(key);
}
