import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { SITE_REVIEWER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { SITE_REVIEWER_INSTRUCTIONS } from '../workflows/review-website.prompts';

/**
 * Iris, Website Reviewer (agents.md 1.1, 2.15, 5.19): the agent of Review a
 * Website. In phase 1 no step of the workflow calls her (every finding is
 * measured in the browser); she answers what the user asks about a run's
 * report. A System agent with no tools; her job description is the shipped
 * instructions or their in-app override (ADR-0026).
 */
export const siteReviewerAgent = new Agent({
  id: SITE_REVIEWER_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Site Reviewer',
  description:
    'Explains a website review: its measured findings, what to fix first and how. No tools.',
  instructions: () =>
    agentInstructions(SITE_REVIEWER_AGENT_KEY, SITE_REVIEWER_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
