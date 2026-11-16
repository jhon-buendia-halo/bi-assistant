import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { DATA_MAPPER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { MAP_DATA_INSTRUCTIONS } from '../workflows/recreate-dashboard.prompts';

/**
 * Daniel, Data Mapping Analyst (agents.md 1.1, 2.14, 5.18): the agent of
 * the Map data step of `map-dashboard-data`. He ties every column a
 * dashboard reads to a column of the run's datasets, or says what is
 * missing, from the catalog's names and types alone, in one model call,
 * with no tools and no memory. A System agent: the workflow calls him
 * through `mapDataWithModel`, which then checks every source he names
 * against the catalog; his job description is the shipped Map data
 * instructions or their in-app override (ADR-0026).
 */
export const dataMapperAgent = new Agent({
  id: 'data-mapper',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Data Mapper',
  description:
    "Maps the columns a dashboard reads to the columns of the datasets' entities, and says what is missing. No tools.",
  instructions: () =>
    agentInstructions(DATA_MAPPER_AGENT_KEY, MAP_DATA_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
