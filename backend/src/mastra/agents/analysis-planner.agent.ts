import { ANALYSIS_PLANNER_AGENT_KEY } from '../agent-constants';
import { defineBuiltinAgent } from '../agent-factory';
import { PLAN_INSTRUCTIONS } from '../workflows/analysis.prompts';

/**
 * Olivia, Analysis Lead (agents.md 1.1, 5.11): a planner of the library. She
 * plans the analysis of one question (measures,
 * entities, scope, assumptions, whether to clarify first) in one model
 * call, with no tools and no memory. A System agent: the workflow calls
 * her through `planWithModel`; her job description is the shipped Plan
 * instructions or their in-app override (ADR-0026).
 */
export const analysisPlannerAgent = defineBuiltinAgent({
  key: ANALYSIS_PLANNER_AGENT_KEY,
  name: 'Analysis Planner',
  description:
    'Plans the analysis of one question: measures, entities, scope, assumptions, and whether to clarify first. No tools.',
  classes: ['single-step'],
  instructions: PLAN_INSTRUCTIONS,
  // A workflow may run its step agents on its own model (agents.md 1.3).
  model: 'step-model',
});
