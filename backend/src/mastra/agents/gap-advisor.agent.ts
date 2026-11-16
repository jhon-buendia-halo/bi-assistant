import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { GAP_ADVISOR_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { GAP_ADVISOR_INSTRUCTIONS } from '../workflows/consumption-gap-analysis.prompts';

/**
 * Nora, Data Modeling Advisor (agents.md 1.1, 2.20, 5.20): the agent of the
 * Recommend fixes step of `consumption-gap-analysis`. She proposes the model
 * changes that close the gaps the trace found, starting in the lowest layer
 * that has the data, in one model call, with no tools and no memory. A
 * System agent: the workflow calls her through `recommendFixesWithModel`,
 * which checks her fixes; her job description is the shipped instructions
 * or their in-app override (ADR-0026). Her fixes are proposals, never run.
 */
export const gapAdvisorAgent = new Agent({
  id: 'gap-advisor',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Gap Advisor',
  description:
    'Proposes the changes to a medallion model that close the gaps its Consumption layer has. No tools.',
  instructions: () =>
    agentInstructions(GAP_ADVISOR_AGENT_KEY, GAP_ADVISOR_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
