import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { ANALYSIS_PLANNER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { PLAN_INSTRUCTIONS } from '../workflows/qti-v2-turn.prompts';

/**
 * Olivia, Analysis Lead (agents.md 1.1, 5.11): the agent of the Plan step of
 * `qti-v2-turn`. She plans the analysis of one question (measures,
 * entities, scope, assumptions, whether to clarify first) in one model
 * call, with no tools and no memory. A System agent: the workflow calls
 * her through `planWithModel`; her job description is the shipped Plan
 * instructions or their in-app override (ADR-0026).
 */
export const analysisPlannerAgent = new Agent({
  id: 'questions-to-insights-v2-plan',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Questions to Insights v2: Plan',
  description:
    'Plans the analysis of one question: measures, entities, scope, assumptions, and whether to clarify first. No tools.',
  instructions: () =>
    agentInstructions(ANALYSIS_PLANNER_AGENT_KEY, PLAN_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
