import type { Agent } from '@mastra/core/agent';
import type * as StepAgents from '../workflows/step-agents';
import type * as PlannerAgent from '../agents/analysis-planner.agent';
import type * as WriterAgent from '../agents/answer-writer.agent';
import type {
  AnalysisPlan,
  AnsweredClarification,
  BusinessAnswer,
} from '../workflows/analysis.steps';
import type { AssistantEvalSet, EvalTarget } from './assistant.evals';
import {
  isolatedCallTarget,
  type IsolatedCallOptions,
} from './isolated-call-target';

/**
 * The isolated-call targets of the agents whose step is one model call
 * (agents.md 8.1): Olivia's Plan and Jessica's Write answer. Each case
 * carries the call's input in its `input` field, typed below. The model
 * functions and the agents are required on first use, so the eval
 * catalogue loads without Mastra.
 */

/** The target ids (`AssistantEvalSet.target`, else the set's `agentKey`). */
export const ANALYSIS_PLANNER_EVAL_TARGET = 'analysis-planner';
export const ANSWER_WRITER_EVAL_TARGET = 'answer-writer';

const stepAgents = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../workflows/step-agents') as typeof StepAgents;

/**
 * Olivia's input (`planWithModel`): the question and the catalog block the
 * Plan step builds, optionally the conversation before the question
 * (`messages`, default the question alone) and Clarify's answered question.
 */
export interface PlannerEvalInput {
  question: string;
  catalogBlock: string;
  messages?: Parameters<typeof StepAgents.planWithModel>[0]['messages'];
  answered?: AnsweredClarification;
}

/** Jessica's input (`writeAnswerWithModel`): question, plan, queries, findings. */
export type WriterEvalInput = Parameters<
  typeof StepAgents.writeAnswerWithModel
>[0];

type Call<I, O> = (input: I, options: IsolatedCallOptions) => Promise<O>;

/** Olivia: the answer is the plan as JSON (`AnalysisPlan`). */
export function analysisPlannerEvalTarget(
  sets: AssistantEvalSet[],
  call: Call<PlannerEvalInput, { plan: AnalysisPlan; stopped: boolean }> = (
    input,
    options,
  ) =>
    stepAgents().planWithModel(
      { ...input, messages: input.messages ?? input.question },
      options,
    ),
  loadAgent: () => Agent = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../agents/analysis-planner.agent') as typeof PlannerAgent)
      .analysisPlannerAgent,
): EvalTarget {
  return isolatedCallTarget({
    agentKey: 'analysis-planner',
    sets,
    loadAgent,
    call,
    answerOf: (output) => output.plan,
  });
}

/** Jessica: the answer is `BusinessAnswer` as JSON (`headline`, `answer`, …). */
export function answerWriterEvalTarget(
  sets: AssistantEvalSet[],
  call: Call<WriterEvalInput, { answer: BusinessAnswer; stopped: boolean }> = (
    input,
    options,
  ) => stepAgents().writeAnswerWithModel(input, options),
  loadAgent: () => Agent = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../agents/answer-writer.agent') as typeof WriterAgent)
      .answerWriterAgent,
): EvalTarget {
  return isolatedCallTarget({
    agentKey: 'answer-writer',
    sets,
    loadAgent,
    call,
    answerOf: (output) => output.answer,
  });
}
