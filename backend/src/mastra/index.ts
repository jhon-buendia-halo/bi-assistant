import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { assistantAgent } from './agents/assistant.agent';
import { assistantV2Agent } from './agents/assistant-v2.agent';
import { dataReadinessAgent } from './agents/data-readiness.agent';
import { evalJudgeAgent } from './agents/eval-judge.agent';
import { knowledgeBootstrapAgent } from './agents/knowledge-bootstrap.agent';
import { rfpAgent } from './agents/rfp.agent';
import { sqlFixerAgent } from './agents/sql-fixer.agent';
import { sqlVerifierAgent } from './agents/sql-verifier.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { developerTraceExporters } from './developer-exporters';
import { mastraStorage } from './storage';
import { watchSessionWorkspaceRegistry } from './session-workspaces';
import { appSkills } from './app-skills';
import { agentTurnWorkflow } from './workflows/agent-turn.workflow';
import { deepAnalysisWorkflow } from './workflows/deep-analysis.workflow';
import { qtiV2TurnWorkflow } from './workflows/qti-v2-turn.workflow';
import { seqTextDemoWorkflow } from './workflows/seq-text-demo.workflow';

// Validate every bundled skill before anything is served: a broken skill
// stops the backend here (agents.md 7.3).
appSkills();

// Canonical Mastra entry point — the backbone of the agentic harness. Agents
// (and later tools/workflows) are registered here; the NestJS MastraService
// wraps this instance for DI.
export const mastra = new Mastra({
  agents: {
    assistant: assistantAgent,
    'assistant-v2': assistantV2Agent,
    visualization: visualizationAgent,
    'sql-fixer': sqlFixerAgent,
    'sql-verifier': sqlVerifierAgent,
    'assistant-eval-judge': evalJudgeAgent,
    'knowledge-bootstrap': knowledgeBootstrapAgent,
    rfp: rfpAgent,
    'data-readiness': dataReadinessAgent,
  },
  // The turn workflows (agents.md 1.2, 5.1): the code-defined ones
  // (5.11, ADR-0034) and `agent-turn`, the one engine of every one-step
  // workflow (5.12, ADR-0040), and the run workflows, which run once on a
  // typed input (5.13; api.md 118).
  workflows: {
    'agent-turn': agentTurnWorkflow,
    'qti-v2-turn': qtiV2TurnWorkflow,
    'seq-text-demo': seqTextDemoWorkflow,
    'deep-analysis': deepAnalysisWorkflow,
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
