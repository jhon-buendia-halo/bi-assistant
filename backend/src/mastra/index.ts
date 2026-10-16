import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { assistantAgent } from './agents/assistant.agent';
import { evalJudgeAgent } from './agents/eval-judge.agent';
import { knowledgeBootstrapAgent } from './agents/knowledge-bootstrap.agent';
import { rfpAgent } from './agents/rfp.agent';
import { showcaseAgents } from './agents/showcase.agents';
import { sqlFixerAgent } from './agents/sql-fixer.agent';
import { sqlVerifierAgent } from './agents/sql-verifier.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { developerTraceExporters } from './developer-exporters';
import { mastraStorage } from './storage';
import { watchSessionWorkspaceRegistry } from './session-workspaces';
import { appSkills } from './app-skills';

// Validate every bundled skill before anything is served: a broken skill
// stops the backend here (agents.md 7.3).
appSkills();

// Canonical Mastra entry point — the backbone of the agentic harness. Agents
// (and later tools/workflows) are registered here; the NestJS MastraService
// wraps this instance for DI.
export const mastra = new Mastra({
  agents: {
    assistant: assistantAgent,
    visualization: visualizationAgent,
    'sql-fixer': sqlFixerAgent,
    'sql-verifier': sqlVerifierAgent,
    'assistant-eval-judge': evalJudgeAgent,
    'knowledge-bootstrap': knowledgeBootstrapAgent,
    rfp: rfpAgent,
    // Showcase agents (agents.md 2.9), Official cards that cannot chat.
    benchmarking: showcaseAgents.benchmarking,
    survey: showcaseAgents.survey,
    'lad-coe': showcaseAgents['lad-coe'],
    strategy: showcaseAgents.strategy,
  },
  storage: mastraStorage,
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
  observability: new Observability({
    configs: {
      local: {
        serviceName: 'questions-to-insights',
        // The local store always gets every trace; Phoenix is added only
        // when developer observability is on.
        exporters: [new MastraStorageExporter(), ...developerTraceExporters()],
        logging: {
          enabled: true,
          level: 'info',
        },
      },
    },
  }),
});

// The app backend and Studio are separate Mastra processes. Keep each
// registry aligned with the shared filesystem as sessions come and go.
export const sessionWorkspaceWatcher = watchSessionWorkspaceRegistry(mastra);
