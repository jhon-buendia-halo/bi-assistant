import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { assistantAgent } from './agents/assistant.agent';
import { assistantLegacyAgent } from './agents/assistant-legacy.agent';
import { evalJudgeAgent } from './agents/eval-judge.agent';
import { knowledgeBootstrapAgent } from './agents/knowledge-bootstrap.agent';
import { sqlFixerAgent } from './agents/sql-fixer.agent';
import { queryFixerAgent } from './agents/query-fixer.agent';
import { queryVerifierAgent } from './agents/query-verifier.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { mastraStorage } from './storage';
import { watchSessionWorkspaceRegistry } from './session-workspaces';

// Canonical Mastra entry point — the backbone of the agentic harness. Agents
// (and later tools/workflows) are registered here; the NestJS MastraService
// wraps this instance for DI.
export const mastra = new Mastra({
  agents: {
    assistant: assistantAgent,
    // Pre-ADR-0007 assistant, kept only for the eval harness's `legacy` vs
    // `model` comparison (roadmap 1.2.2 §7) — never exposed on a user-facing
    // surface.
    'assistant-legacy': assistantLegacyAgent,
    visualization: visualizationAgent,
    // Runtime repair of a *compiled* statement that fails to execute — still
    // needed as a safety net under the logical query layer (ADR-0007 §6).
    'sql-fixer': sqlFixerAgent,
    // Compile/semantic repair at the logical level — replaces `sql-verifier`
    // (removed; nothing else depended on it) for `query_entities`'s one
    // automatic retry.
    'query-fixer': queryFixerAgent,
    // Careful mode's independent second opinion, now at the logical level.
    'query-verifier': queryVerifierAgent,
    'assistant-eval-judge': evalJudgeAgent,
    'knowledge-bootstrap': knowledgeBootstrapAgent,
  },
  storage: mastraStorage,
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
  observability: new Observability({
    configs: {
      local: {
        serviceName: 'questions-to-insights',
        exporters: [new MastraStorageExporter()],
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
