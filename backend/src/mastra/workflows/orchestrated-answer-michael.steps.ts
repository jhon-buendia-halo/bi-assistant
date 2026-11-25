/**
 * Answer a Business Question (Avery + Michael) (workflows R45; agents.md
 * 5.23): the question answered by Avery, the Chief of Staff, a supervisor
 * agent who calls her team as her tools: Michael, who plans, queries the
 * data and writes the answer, and Clara for a dashboard. She is the only
 * agent the user talks to in it. One step, Orchestrate. Plain data and pure
 * code, no framework import; the Mastra workflow is
 * ./orchestrated-answer-michael.workflow.ts.
 */
import { z } from 'zod';
import {
  questionInputSchema,
  clarificationAnswerSchema,
  clarifyingQuestionSchema,
} from './analysis.schemas';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
} from './workflow-contract';

import { BI_ANALYST_AGENT_KEY } from '../agent-constants';
import { INSIGHTS_ANALYST_AGENT_KEY } from '../agents/insights-analyst-catalog';
import { BUILD_DASHBOARD_TOOL } from './bi-dashboard.schemas';
import { EXPORT_CONVERSATION_TOOL, type ExportContent } from './export-request';

/** The workflow's registry key and id: its Mastra workflow's too. */
export const ORCHESTRATED_MICHAEL_WORKFLOW_ID = 'orchestrated-answer-michael';
export const ORCHESTRATED_MICHAEL_WORKFLOW_NAME =
  'Answer a Business Question (Avery + Michael)';

/** The most model steps Avery takes in one turn. */
export const ORCHESTRATOR_MAX_STEPS = 16;

/** Michael on his own: the answer the user reads is his. */
export const MICHAEL_ANSWER_TOOL = 'answer_from_data';

/** Avery's team and tools. */
export interface OrchestratorTeamSpec {
  team: readonly { tool: string; agent: string }[];
  tools: readonly string[];
}

/**
 * Avery's team as her tools (agents.md 2.21, 5.23): each team tool of
 * mastra/tools/orchestrator.tools.ts and the agent it calls, then her tools
 * in order: the team's, her own `export_conversation` (agents.md 3.18, no
 * teammate behind it) and `ask_clarification`.
 */
export const AVERY_TEAM: OrchestratorTeamSpec = {
  team: [
    { tool: MICHAEL_ANSWER_TOOL, agent: INSIGHTS_ANALYST_AGENT_KEY },
    { tool: BUILD_DASHBOARD_TOOL, agent: BI_ANALYST_AGENT_KEY },
  ],
  tools: [
    MICHAEL_ANSWER_TOOL,
    BUILD_DASHBOARD_TOOL,
    EXPORT_CONVERSATION_TOOL,
    'ask_clarification',
  ],
};

/**
 * The agent one of Avery's team tools calls (`answer_from_data` →
 * `insights-analyst`); undefined for any other tool.
 */
export function teammateOfTool(tool: string): string | undefined {
  return AVERY_TEAM.team.find((member) => member.tool === tool)?.agent;
}

/**
 * Avery's model and effort (agents.md 1.3): Opus 5.5 at high effort when the
 * saved model is served as a Claude model; the agents she calls run on the
 * team's step model (`TEAM_STEP_MODEL`, medium).
 */
export const ORCHESTRATOR_MODEL = {
  model: 'claude-opus-5-5',
  reasoningEffort: 'high',
} as const;

/** The step's input and output (agents.md 5.12 data contract). */
export const ORCHESTRATED_MICHAEL_STEP_SCHEMAS = {
  orchestrate: {
    input: questionInputSchema,
    output: z.object({
      answer: z.string().describe("The run's answer."),
    }),
    // Avery's question to the user: the run waits for the answer (api.md 138).
    suspend: clarifyingQuestionSchema,
    resume: clarificationAnswerSchema,
  },
} as const;

/** The steps, in catalogue order: Avery's one step (agents.md 5.23). */
export const ORCHESTRATED_MICHAEL_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'orchestrate',
      title: 'Orchestrate',
      kind: 'agent',
      summary:
        'Avery, the Chief of Staff, briefs Michael, who plans the analysis, queries the data and writes the answer; she reads it and closes. Clara builds a dashboard when you ask for one. She is the only one who talks to you.',
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
        { label: 'if it asks you a question', outcome: 'waits' },
      ],
    },
    ORCHESTRATED_MICHAEL_STEP_SCHEMAS.orchestrate,
  ),
];

/** The edges (api.md 117): Start → Orchestrate → End. */
export const ORCHESTRATED_MICHAEL_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'orchestrate', kind: 'next' },
  { from: 'orchestrate', to: 'end', kind: 'next' },
];

/** Avery's tools' RequestContext key: their `OrchestratorToolsRuntime`. */
export const ORCHESTRATOR_TOOLS_RUNTIME_KEY = 'orchestrator-tools-runtime';

/**
 * What Avery's tools call (mastra/tools/orchestrator.tools.ts). The team
 * never talks to the user in this workflow. Each answers Avery in a few
 * lines of text.
 */
export interface OrchestratorToolsRuntime {
  /** The tools Avery is offered in this run (`AVERY_TEAM.tools`). */
  tools: readonly string[];
  /**
   * Michael on his own: he plans from `brief`, queries and writes the
   * answer the user reads; his queries, the checks and that his answer is
   * written, for Avery.
   */
  answerFromData(brief: string): Promise<string>;
  /**
   * The run may build a dashboard (build_dashboard is offered): the user
   * asked for one (`asksForDashboard`) or the conversation has one.
   */
  buildsDashboard: boolean;
  /**
   * Clara builds the dashboard of `brief`, or changes the conversation's
   * into its next version; what she built, or why not, for Avery.
   */
  buildDashboard(brief: string): Promise<string>;
  /**
   * The run may export the conversation (export_conversation is offered):
   * the user's words ask for it (`asksForExport`).
   */
  exportsConversation: boolean;
  /**
   * Export the conversation with Avery's content (agents.md 3.18): what was
   * exported, or why not, for Avery.
   */
  exportConversation(content: ExportContent): Promise<string>;
}
