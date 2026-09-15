import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { assistantAgent } from './agents/assistant.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { mastraStorage } from './storage';
import { watchProjectWorkspaceRegistry } from './project-workspaces';

// Canonical Mastra entry point — the backbone of the agentic harness. Agents
// (and later tools/workflows) are registered here; the NestJS MastraService
// wraps this instance for DI.
export const mastra = new Mastra({
  agents: {
    assistant: assistantAgent,
    visualization: visualizationAgent,
  },
  storage: mastraStorage,
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});

// The app backend and Studio are separate Mastra processes. Keep each
// registry aligned with the shared filesystem as projects come and go.
export const projectWorkspaceWatcher = watchProjectWorkspaceRegistry(mastra);
