import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { DASHBOARD_READER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { READ_DASHBOARD_INSTRUCTIONS } from '../workflows/recreate-dashboard.prompts';

/**
 * Grace, Dashboard Analyst (agents.md 1.1, 2.12, 5.17): the agent of the
 * Read dashboard step of `recreate-dashboard`. She looks at the image of a
 * dashboard and describes its layout, filters, widgets and the columns of
 * a mock dataset behind them, in one model call that carries the image,
 * with no tools and no memory. A System agent: the workflow calls her
 * through `readDashboardWithModel`; her job description is the shipped
 * Read dashboard instructions or their in-app override (ADR-0026). The
 * app's model must accept images.
 */
export const dashboardReaderAgent = new Agent({
  id: 'dashboard-reader',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Dashboard Reader',
  description:
    'Reads the image of a dashboard and describes its layout, filters, widgets and mock dataset. No tools.',
  instructions: () =>
    agentInstructions(DASHBOARD_READER_AGENT_KEY, READ_DASHBOARD_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
