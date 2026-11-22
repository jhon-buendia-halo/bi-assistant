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
  answerBusinessQuestionInputSchema,
  clarificationAnswerSchema,
  clarifyingQuestionSchema,
} from './answer-business-question.schemas';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
} from './answer-business-question.steps';

import {
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  IMAGE_READER_AGENT_KEY,
  VISUALIZATION_AGENT_KEY,
} from '../agent-constants';
import { INSIGHTS_ANALYST_AGENT_KEY } from '../agents/insights-analyst-catalog';

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
];

/** Avery's tools, in order: her team's, then `ask_clarification`. */
export const ORCHESTRATOR_TOOL_NAMES: readonly string[] = [
  ...ORCHESTRATOR_TEAM.map((member) => member.tool),
  'ask_clarification',
];

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
    input: answerBusinessQuestionInputSchema,
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
        'Avery, the Chief of Staff, decides who on the team works on the question and calls them as her tools: Zoe reads the images, Olivia plans, Michael queries the data, Jessica writes the answer and Ryan charts it. She is the only one who talks to you.',
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
   * Jessica writes the answer; a short confirmation for Avery. `brief`:
   * Avery's request to her (the question restated to stand alone, what the
   * user already knows); it ends Jessica's request.
   */
  writeAnswer(brief?: string): Promise<string>;
  /** Ryan charts the answer's rows; what he built, or why not. */
  buildVisual(instruction: string): Promise<string>;
}
