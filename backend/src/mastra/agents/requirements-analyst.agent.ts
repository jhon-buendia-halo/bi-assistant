import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { REQUIREMENTS_ANALYST_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { REQUIREMENTS_ANALYST_INSTRUCTIONS } from '../workflows/consumption-gap-analysis.prompts';

/**
 * Rosa, Requirements Analyst (agents.md 1.1, 2.18, 5.20): the agent of the
 * Derive requirements step of `consumption-gap-analysis`, and of Confirm
 * requirements when the user gives feedback. She turns business questions
 * into the fields each must read, in business words, in one model call,
 * with no tools and no memory. A System agent: the workflow calls her
 * through `deriveRequirementsWithModel` and `reviseRequirementsWithModel`;
 * her job description is the shipped instructions or their in-app override
 * (ADR-0026).
 */
export const requirementsAnalystAgent = new Agent({
  id: 'requirements-analyst',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Requirements Analyst',
  description:
    'Turns business questions into the data requirements a model must meet. No tools.',
  instructions: () =>
    agentInstructions(
      REQUIREMENTS_ANALYST_AGENT_KEY,
      REQUIREMENTS_ANALYST_INSTRUCTIONS,
    ),
  model: async () => resolveAgentModel(),
});
