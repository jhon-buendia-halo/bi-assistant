/**
 * Answer a Business Question (orchestrated) (workflows R45; agents.md
 * 5.22): the same question answered by Avery, the Chief of Staff, a
 * supervisor agent that decides at run time which agents to call (Zoe,
 * Olivia, Michael, Jessica, Ryan) as her tools, instead of a fixed line of
 * steps. She is the only agent the user talks to in it. One step,
 * Orchestrate. Plain data and pure code, no framework import; the Mastra
 * workflow is ./orchestrated-answer.workflow.ts.
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

import {
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  BI_ANALYST_AGENT_KEY,
  IMAGE_READER_AGENT_KEY,
  VISUALIZATION_AGENT_KEY,
} from '../agent-constants';
import { INSIGHTS_ANALYST_AGENT_KEY } from '../agents/insights-analyst-catalog';
import { BUILD_DASHBOARD_TOOL } from './bi-dashboard.schemas';
import { EXPORT_CONVERSATION_TOOL, type ExportContent } from './export-request';

/** The workflow's registry key and id. */
export const ORCHESTRATED_ANSWER_WORKFLOW_ID = 'orchestrated-answer';

/** The most model steps Avery takes in one turn. */
export const ORCHESTRATOR_MAX_STEPS = 16;

/**
 * Avery's team as her tools (agents.md 2.21): each tool of
 * mastra/tools/orchestrator.tools.ts and the agent it calls, in her order.
 */
export const ORCHESTRATOR_TEAM: readonly { tool: string; agent: string }[] = [
  { tool: 'read_reference_images', agent: IMAGE_READER_AGENT_KEY },
  { tool: 'plan_analysis', agent: ANALYSIS_PLANNER_AGENT_KEY },
  { tool: 'analyse_data', agent: INSIGHTS_ANALYST_AGENT_KEY },
  { tool: 'write_answer', agent: ANSWER_WRITER_AGENT_KEY },
  { tool: 'build_visual', agent: VISUALIZATION_AGENT_KEY },
  { tool: BUILD_DASHBOARD_TOOL, agent: BI_ANALYST_AGENT_KEY },
];

/**
 * Avery's tools, in order: her team's, then her own `export_conversation`
 * (agents.md 3.18, no teammate behind it) and `ask_clarification`.
 */
export const ORCHESTRATOR_TOOL_NAMES: readonly string[] = [
  ...ORCHESTRATOR_TEAM.map((member) => member.tool),
  EXPORT_CONVERSATION_TOOL,
  'ask_clarification',
];

/**
 * Answer a Business Question (Avery + Michael) (agents.md 5.23): Avery with
 * Michael alone, on this workflow's engine. Michael plans, queries and
 * writes the answer himself; she briefs him, reads it and closes.
 */
export const ORCHESTRATED_MICHAEL_WORKFLOW_ID = 'orchestrated-answer-michael';
export const ORCHESTRATED_MICHAEL_WORKFLOW_NAME =
  'Answer a Business Question (Avery + Michael)';

/** Michael answering on his own: the answer the user reads is his. */
export const MICHAEL_ANSWER_TOOL = 'answer_from_data';

/** An orchestrator's team and tools, as one of her workflows gives them. */
export interface OrchestratorTeamSpec {
  team: readonly { tool: string; agent: string }[];
  tools: readonly string[];
}

/** The workflows Avery runs, each with her team and tools, by workflow id. */
export const ORCHESTRATOR_TEAMS: Readonly<
  Record<string, OrchestratorTeamSpec>
> = {
  [ORCHESTRATED_ANSWER_WORKFLOW_ID]: {
    team: ORCHESTRATOR_TEAM,
    tools: ORCHESTRATOR_TOOL_NAMES,
  },
  [ORCHESTRATED_MICHAEL_WORKFLOW_ID]: {
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
  },
};

/**
 * The agent one of Avery's team tools calls, in any of her workflows
 * (`plan_analysis` → `analysis-planner`); undefined for any other tool.
 */
export function teammateOfTool(tool: string): string | undefined {
  for (const spec of Object.values(ORCHESTRATOR_TEAMS)) {
    const member = spec.team.find((m) => m.tool === tool);
    if (member) return member.agent;
  }
  return undefined;
}

/** Whether a workflow is one of Avery's (a conversation with her, R45). */
export function isOrchestratedWorkflow(id: string | undefined): boolean {
  return !!id && Object.hasOwn(ORCHESTRATOR_TEAMS, id);
}

/** Avery's team and tools in a workflow; her whole team for any other id. */
export function orchestratorTeamOf(
  id: string | undefined,
): OrchestratorTeamSpec {
  return id && Object.hasOwn(ORCHESTRATOR_TEAMS, id)
    ? ORCHESTRATOR_TEAMS[id]
    : ORCHESTRATOR_TEAMS[ORCHESTRATED_ANSWER_WORKFLOW_ID];
}

/** The name the app shows for the workflow. */
export const ORCHESTRATED_ANSWER_WORKFLOW_NAME =
  'Answer a Business Question (orchestrated)';

/**
 * Avery's model and effort (agents.md 1.3): Opus 5.5 at high effort when the
 * saved model is served as a Claude model; the agents she calls run on
 * Answer a Business Question's model (medium).
 */
export const ORCHESTRATOR_MODEL = {
  model: 'claude-opus-5-5',
  reasoningEffort: 'high',
} as const;

/** The run's RequestContext key holding its `OrchestratedAnswerRuntime`. */
export const ORCHESTRATED_ANSWER_RUNTIME_KEY = 'orchestrated-answer-runtime';

/** The step's input and output (agents.md 5.12 data contract). */
export const ORCHESTRATED_ANSWER_STEP_SCHEMAS = {
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

/** The steps, in catalogue order: Avery's one step. */
export const ORCHESTRATED_ANSWER_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'orchestrate',
      title: 'Orchestrate',
      kind: 'agent',
      summary:
        'Avery, the Chief of Staff, decides who on the team works on the question and calls them as her tools: Zoe reads the images, Olivia plans, Michael queries the data, Jessica writes the answer and Ryan charts it; Clara builds a dashboard when you ask for one. She is the only one who talks to you.',
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
        { label: 'if it asks you a question', outcome: 'waits' },
      ],
    },
    ORCHESTRATED_ANSWER_STEP_SCHEMAS.orchestrate,
  ),
];

/**
 * Answer a Business Question (Avery + Michael)'s steps (agents.md 5.23): the
 * same Orchestrate step on the same engine, told for her team of one.
 */
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
    ORCHESTRATED_ANSWER_STEP_SCHEMAS.orchestrate,
  ),
];

/** The edges (api.md 117): Start → Orchestrate → End. */
export const ORCHESTRATED_ANSWER_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'orchestrate', kind: 'next' },
  { from: 'orchestrate', to: 'end', kind: 'next' },
];

/** What the session code hands the run on its RequestContext. */
export interface OrchestratedAnswerRuntime {
  /**
   * Avery's turn (agents.md 5.22): she calls the team as her tools and the
   * run's answer is Jessica's written answer (else Avery's own words). A
   * question she asks the user comes back as `clarification`: the step
   * waits for the answer, then runs her again with it (`answered`).
   */
  orchestrate(input: {
    question: string;
    answered?: { question: string; options: string[]; answer: string };
  }): Promise<{
    answer: string;
    stopped: boolean;
    clarification?: { question: string; options: string[] };
  }>;
}

/** Avery's tools' RequestContext key: their `OrchestratorToolsRuntime`. */
export const ORCHESTRATOR_TOOLS_RUNTIME_KEY = 'orchestrator-tools-runtime';

/**
 * What Avery's tools call (mastra/tools/orchestrator.tools.ts): the same
 * calls Answer a Business Question's steps make, without their gates (the
 * team never talks to the user in this workflow). Each answers Avery in a
 * few lines of text.
 */
export interface OrchestratorToolsRuntime {
  /** The tools Avery is offered in this run: her workflow's (`orchestratorTeamOf`). */
  tools: readonly string[];
  /** The run has reference images (read_reference_images is useful). */
  hasImages: boolean;
  /** The run builds a visual (build_visual is offered). */
  buildsVisual: boolean;
  /** Zoe reads the run's images; her notes, or why there are none. */
  readImages(): Promise<string>;
  /**
   * Olivia's plan in words, with her clarifying question when she has one.
   * `brief`: Avery's request to her (the question restated to stand alone,
   * then what the plan must cover); it ends Olivia's request.
   */
  plan(brief?: string): Promise<string>;
  /** Michael's analysis for `brief`: each query, its rows and the checks. */
  analyse(brief: string): Promise<string>;
  /**
   * Michael on his own (Avery + Michael): he plans from `brief`, queries and
   * writes the answer the user reads; his queries, the checks and that his
   * answer is written, for Avery.
   */
  answerFromData(brief: string): Promise<string>;
  /**
   * Jessica writes the answer; a short confirmation for Avery. `brief`:
   * Avery's request to her (the question restated to stand alone, what the
   * user already knows); it ends Jessica's request.
   */
  writeAnswer(brief?: string): Promise<string>;
  /** Ryan charts the answer's rows; what he built, or why not. */
  buildVisual(instruction: string): Promise<string>;
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
