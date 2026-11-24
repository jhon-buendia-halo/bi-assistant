import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { ANALYSIS_PLANNER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { stepModelFrom } from '../step-model';
import { PLAN_INSTRUCTIONS } from '../workflows/answer-business-question.prompts';

/**
 * Olivia, Analysis Lead (agents.md 1.1, 5.11): the agent of the Plan step of
 * `answer-business-question`. She plans the analysis of one question (measures,
 * entities, scope, assumptions, whether to clarify first) in one model
 * call, with no tools and no memory. A System agent: the workflow calls
 * her through `planWithModel`; her job description is the shipped Plan
 * instructions or their in-app override (ADR-0026).
 */
export const analysisPlannerAgent = new Agent({
  id: 'analysis-planner',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Analysis Planner',
  description:
    'Plans the analysis of one question: measures, entities, scope, assumptions, and whether to clarify first. No tools.',
  instructions: () =>
    agentInstructions(ANALYSIS_PLANNER_AGENT_KEY, PLAN_INSTRUCTIONS),
  // A workflow may run its step agents on its own model (agents.md 1.3).
  model: async ({ requestContext }) =>
    resolveAgentModel(stepModelFrom(requestContext)?.model),
});
