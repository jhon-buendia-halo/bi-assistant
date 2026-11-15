import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { assistantAgent } from './agents/assistant.agent';
import { analysisPlannerAgent } from './agents/analysis-planner.agent';
import { answerWriterAgent } from './agents/answer-writer.agent';
import { queryExplainerAgent } from './agents/query-explainer.agent';
import { insightsAnalystAgent } from './agents/insights-analyst.agent';
import { dataReadinessAgent } from './agents/data-readiness.agent';
import { evalJudgeAgent } from './agents/eval-judge.agent';
import { knowledgeBootstrapAgent } from './agents/knowledge-bootstrap.agent';
import { sqlFixerAgent } from './agents/sql-fixer.agent';
import { sqlVerifierAgent } from './agents/sql-verifier.agent';
import { visualizationAgent } from './agents/visualization.agent';
import { developerTraceExporters } from './developer-exporters';
import { mastraStorage } from './storage';
import { watchSessionWorkspaceRegistry } from './session-workspaces';
import { appSkills } from './app-skills';
import { agentTurnWorkflow } from './workflows/agent-turn.workflow';
import { answerBusinessQuestionWorkflow } from './workflows/answer-business-question.workflow';
import { dataReadinessAssessmentWorkflow } from './workflows/data-readiness-assessment.workflow';

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
    // The query inspector's explainer (agents.md 2.12).
    'query-explainer': queryExplainerAgent,
  },
  // The turn workflows (agents.md 1.2, 5.1): `answer-business-question`, the one
  // catalogue workflow (5.11, ADR-0034; api.md 118, 119), and `agent-turn`,
  // the engine of a turn bound to an agent (draft runs, evals and stored
  // sessions; 5.12, ADR-0040).
  workflows: {
    'agent-turn': agentTurnWorkflow,
    'answer-business-question': answerBusinessQuestionWorkflow,
    'data-readiness-assessment': dataReadinessAssessmentWorkflow,
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
