/**
 * Answer a Business Question (orchestrated) (workflows R45; agents.md
 * 5.22): the same question answered by a supervisor agent that will decide
 * at run time which agents to call (Zoe, Olivia, Michael, Jessica, Ryan),
 * instead of a fixed line of steps. Since 2026-11-20 it is an empty shell:
 * the input of Answer a Business Question and one placeholder step that
 * answers that the workflow is not built yet. Plain data and pure code, no
 * framework import; the Mastra workflow is ./orchestrated-answer.workflow.ts.
 */
import { z } from 'zod';
import { answerBusinessQuestionInputSchema } from './answer-business-question.schemas';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
} from './answer-business-question.steps';

/** The workflow's registry key and id. */
export const ORCHESTRATED_ANSWER_WORKFLOW_ID = 'orchestrated-answer';

/** The name the app shows for the workflow. */
export const ORCHESTRATED_ANSWER_WORKFLOW_NAME =
  'Answer a Business Question (orchestrated)';

/** The run's RequestContext key holding its `OrchestratedAnswerRuntime`. */
export const ORCHESTRATED_ANSWER_RUNTIME_KEY = 'orchestrated-answer-runtime';

/** What the placeholder step answers until the orchestrator is built. */
export const ORCHESTRATED_PLACEHOLDER_ANSWER =
  'This workflow is not built yet. Its orchestrator will decide which agents answer your question; until then, run Answer a Business Question.';

/** The placeholder step's input and output (agents.md 5.12 data contract). */
export const ORCHESTRATED_ANSWER_STEP_SCHEMAS = {
  orchestrate: {
    input: answerBusinessQuestionInputSchema,
    output: z.object({
      answer: z.string().describe("The run's answer."),
    }),
  },
} as const;

/** The steps, in catalogue order: one placeholder until it is built. */
export const ORCHESTRATED_ANSWER_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'orchestrate',
      title: 'Orchestrate',
      kind: 'code',
      summary:
        'Placeholder: the orchestrator that will choose which agents answer the question is not built yet. It answers that the workflow is not built yet. No LLM.',
      exits: [],
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
  /** The run's answer, written by code (the chat's answer text). */
  deliverAnswer(answer: string): Promise<void>;
}
