import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { assistantAgent } from './agents/assistant.agent';
import { analysisPlannerAgent } from './agents/analysis-planner.agent';
import { answerWriterAgent } from './agents/answer-writer.agent';
import { chiefOfStaffAgent } from './agents/chief-of-staff.agent';
import { biAnalystAgent } from './agents/bi-analyst.agent';
import { queryExplainerAgent } from './agents/query-explainer.agent';
import { resultExplorerAgent } from './agents/result-explorer.agent';
import { insightsAnalystAgent } from './agents/insights-analyst.agent';
import { insightsLeadAgent } from './agents/insights-lead.agent';
import { gapAdvisorAgent } from './agents/gap-advisor.agent';
import { layerMapperAgent } from './agents/layer-mapper.agent';
import { requirementsAnalystAgent } from './agents/requirements-analyst.agent';
import { evalJudgeAgent } from './agents/eval-judge.agent';
import { knowledgeBootstrapAgent } from './agents/knowledge-bootstrap.agent';
import { sqlFixerAgent } from './agents/sql-fixer.agent';
import { sqlVerifierAgent } from './agents/sql-verifier.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { EVAL_RUN_CONTEXT_KEY } from './evals/eval-trace-marker';
import { EvalRunMarker } from './evals/eval-run-scope';
import { developerTraceExporters } from './developer-exporters';
import { mastraStorage } from './storage';
import { watchSessionWorkspaceRegistry } from './session-workspaces';
import { appSkills } from './app-skills';
import { agentTurnWorkflow } from './workflows/agent-turn.workflow';
import { orchestratedMichaelWorkflow } from './workflows/orchestrated-answer-michael.workflow';
import { insightsLeadConversationWorkflow } from './workflows/conversation-turn.workflow';
import { consumptionGapAnalysisWorkflow } from './workflows/consumption-gap-analysis.workflow';

// Validate every bundled skill before anything is served: a broken skill
// stops the backend here (agents.md 7.3).
appSkills();

// Canonical Mastra entry point — the backbone of the agentic harness. Agents
// (and later tools/workflows) are registered here; the NestJS MastraService
// wraps this instance for DI.
export const mastra = new Mastra({
  agents: {
    assistant: assistantAgent,
    'insights-analyst': insightsAnalystAgent,
    visualization: visualizationAgent,
    'sql-fixer': sqlFixerAgent,
    'sql-verifier': sqlVerifierAgent,
    'assistant-eval-judge': evalJudgeAgent,
    'knowledge-bootstrap': knowledgeBootstrapAgent,
    // Olivia and Jessica, the planner and the writer (agents.md 2.11): in the
    // library, their model calls run by their evals.
    'analysis-planner': analysisPlannerAgent,
    'answer-writer': answerWriterAgent,
    // Avery, the orchestrator of Answer a Business Question (Avery + Michael).
    'chief-of-staff': chiefOfStaffAgent,
    // Clara, Avery's teammate behind build_dashboard (plan bi-dashboard).
    'bi-analyst': biAnalystAgent,
    // Elena, the Insights Lead, alone in her own conversation (plan Elena 2).
    'insights-lead': insightsLeadAgent,
    // The agents of Consumption Gap Analysis's model steps (agents.md 5.20).
    'requirements-analyst': requirementsAnalystAgent,
    'layer-mapper': layerMapperAgent,
    'gap-advisor': gapAdvisorAgent,
    // The query inspector's explainer (agents.md 2.12).
    'query-explainer': queryExplainerAgent,
    // The query inspector's filter in words (agents.md 2.17).
    'result-explorer': resultExplorerAgent,
  },
  // The turn workflows (agents.md 1.2, 5.1): each catalogue workflow under
  // its own id (5.12; api.md 118, 119), and `agent-turn`, the engine of a
  // turn bound to an agent (draft runs, evals and stored sessions; 5.12,
  // ADR-0040).
  workflows: {
    'agent-turn': agentTurnWorkflow,
    // Answer a Business Question (Avery + Michael) (5.23).
    'orchestrated-answer-michael': orchestratedMichaelWorkflow,
    'insights-lead-conversation': insightsLeadConversationWorkflow,
    'consumption-gap-analysis': consumptionGapAnalysisWorkflow,
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
        // Writes the eval marker into the metadata of every span started
        // inside an eval run's scope, whatever its request context; the key
        // also copies the marker from a case's own request context (ADR-0054).
        spanOutputProcessors: [new EvalRunMarker()],
        requestContextKeys: [EVAL_RUN_CONTEXT_KEY],
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
