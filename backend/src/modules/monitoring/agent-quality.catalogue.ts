import { builtinAgentPersona } from '../../mastra/agent-personas';
import { EVAL_SETS, evalSetAgentKey } from '../../mastra/evals/eval-sets';
import { AGENT_QUALITY_CATALOGUE, type QualityAgent } from './agent-quality';

export { AGENT_QUALITY_CATALOGUE };

/**
 * The built-in agents that have at least one eval set, with persona and sets
 * as plain data (a set's agent is its `agentKey`).
 */
export function buildAgentQualityCatalogue(): QualityAgent[] {
  const agents = new Map<string, QualityAgent>();
  for (const set of EVAL_SETS) {
    const key = evalSetAgentKey(set);
    const persona = builtinAgentPersona(key);
    if (!persona) continue;
    let agent = agents.get(key);
    if (!agent) {
      agent = {
        key,
        agentId: key,
        name: persona.name,
        role: persona.role ?? '',
        sets: [],
      };
      agents.set(key, agent);
    }
    agent.sets.push({
      id: set.id,
      name: set.name,
      caseIds: set.cases.map((c) => c.id),
    });
  }
  return [...agents.values()];
}
