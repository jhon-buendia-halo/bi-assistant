import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { assistantAgent } from './agents/assistant.agent';
import { analysisPlannerAgent } from './agents/analysis-planner.agent';
import { answerWriterAgent } from './agents/answer-writer.agent';
import { queryExplainerAgent } from './agents/query-explainer.agent';
import { resultExplorerAgent } from './agents/result-explorer.agent';
import { insightsAnalystAgent } from './agents/insights-analyst.agent';
import { dashboardReaderAgent } from './agents/dashboard-reader.agent';
import { dataMapperAgent } from './agents/data-mapper.agent';
import { gapAdvisorAgent } from './agents/gap-advisor.agent';
import { layerMapperAgent } from './agents/layer-mapper.agent';
import { requirementsAnalystAgent } from './agents/requirements-analyst.agent';
import { imageReaderAgent } from './agents/image-reader.agent';
import { dataReadinessAgent } from './agents/data-readiness.agent';
import { evalJudgeAgent } from './agents/eval-judge.agent';
import { knowledgeBootstrapAgent } from './agents/knowledge-bootstrap.agent';
import { sqlFixerAgent } from './agents/sql-fixer.agent';
import { sqlVerifierAgent } from './agents/sql-verifier.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { siteReviewerAgent } from './agents/site-reviewer.agent';
import { developerTraceExporters } from './developer-exporters';
import { mastraStorage } from './storage';
import { watchSessionWorkspaceRegistry } from './session-workspaces';
import { appSkills } from './app-skills';
import { agentTurnWorkflow } from './workflows/agent-turn.workflow';
import { askAgentWorkflow } from './workflows/ask-agent.workflow';
import { answerBusinessQuestionWorkflow } from './workflows/answer-business-question.workflow';
import { answerBusinessQuestionSharedWorkflow } from './workflows/answer-business-question-shared.workflow';
import { consumptionGapAnalysisWorkflow } from './workflows/consumption-gap-analysis.workflow';
import { dataReadinessAssessmentWorkflow } from './workflows/data-readiness-assessment.workflow';
import { mapDashboardDataWorkflow } from './workflows/map-dashboard-data.workflow';
import { recreateDashboardWorkflow } from './workflows/recreate-dashboard.workflow';
import { reviewWebsiteWorkflow } from './workflows/review-website.workflow';

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
    'data-readiness': dataReadinessAgent,
    // The agents of v2's Plan and Write answer steps (agents.md 2.11).
    'analysis-planner': analysisPlannerAgent,
    'answer-writer': answerWriterAgent,
    // The agents of Dashboard Image to Artifact's two model steps (agents.md 5.17).
    'dashboard-reader': dashboardReaderAgent,
    'data-mapper': dataMapperAgent,
    // The agents of Consumption Gap Analysis's model steps (agents.md 5.20).
    'requirements-analyst': requirementsAnalystAgent,
    'layer-mapper': layerMapperAgent,
    'gap-advisor': gapAdvisorAgent,
    // The agent of Read images, the optional first step of three workflows
    // (agents.md 2.15; workflows R35).
    'image-reader': imageReaderAgent,
    // The query inspector's explainer (agents.md 2.12).
    'query-explainer': queryExplainerAgent,
    // The query inspector's filter in words (agents.md 2.17).
    'result-explorer': resultExplorerAgent,
    // Review a Website's agent (agents.md 2.16, 5.19).
    'site-reviewer': siteReviewerAgent,
  },
  // The turn workflows (agents.md 1.2, 5.1): `answer-business-question`, the one
  // catalogue workflow (5.11, ADR-0034; api.md 118, 119), and `agent-turn`,
  // the engine of a turn bound to an agent (draft runs, evals and stored
  // sessions; 5.12, ADR-0040).
  workflows: {
    'agent-turn': agentTurnWorkflow,
    // A follow-up that asks one agent of Answer a Business Question (5.21).
    'ask-agent': askAgentWorkflow,
    'answer-business-question': answerBusinessQuestionWorkflow,
    // Experiment: the same turn with a shared run context (board). Not in
    // the catalogue; run by an eval target only.
    'answer-business-question-shared': answerBusinessQuestionSharedWorkflow,
    'data-readiness-assessment': dataReadinessAssessmentWorkflow,
    'recreate-dashboard': recreateDashboardWorkflow,
    'map-dashboard-data': mapDashboardDataWorkflow,
    'review-website': reviewWebsiteWorkflow,
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
