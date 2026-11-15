import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { MOCK_BUILDER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { BUILD_MOCK_INSTRUCTIONS } from '../workflows/recreate-dashboard.prompts';

/**
 * Lucas, Prototype Developer (agents.md 1.1, 2.13, 5.17): the agent of the
 * Build mock step of `recreate-dashboard`. He writes the HTML, CSS and
 * JavaScript of an interactive mock from the Dashboard Reader's
 * description and the image, on invented data, in one model call, with no
 * tools and no memory. A System agent: the workflow calls him through
 * `buildMockWithModel`; his job description is the shipped Build mock
 * instructions or their in-app override (ADR-0026).
 */
export const mockBuilderAgent = new Agent({
  id: 'mock-builder',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Mock Builder',
  description:
    'Writes an interactive HTML, CSS and JavaScript mock of a described dashboard, on invented data. No tools.',
  instructions: () =>
    agentInstructions(MOCK_BUILDER_AGENT_KEY, BUILD_MOCK_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
