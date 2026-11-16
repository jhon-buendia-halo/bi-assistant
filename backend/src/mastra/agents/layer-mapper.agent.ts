import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { LAYER_MAPPER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { LAYER_MAPPER_INSTRUCTIONS } from '../workflows/consumption-gap-analysis.prompts';

/**
 * Leo, Lineage Analyst (agents.md 1.1, 2.19, 5.20): the agent of the Map
 * requirements step of `consumption-gap-analysis`. For every field a
 * requirement reads he names the column that holds or computes it in each
 * layer of the medallion model, or says it is missing, from the catalogs'
 * names and types alone, in one model call, with no tools and no memory.
 * A System agent: the workflow calls him through `mapRequirementsWithModel`,
 * which checks every source he names against the catalogs; his job
 * description is the shipped instructions or their in-app override
 * (ADR-0026).
 */
export const layerMapperAgent = new Agent({
  id: 'layer-mapper',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Layer Mapper',
  description:
    'Maps the fields of requirements to the columns of the Landing, Normalized and Consumption layers. No tools.',
  instructions: () =>
    agentInstructions(LAYER_MAPPER_AGENT_KEY, LAYER_MAPPER_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
