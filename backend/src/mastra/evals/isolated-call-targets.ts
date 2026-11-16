import type { Agent } from '@mastra/core/agent';
import type * as StepAgents from '../workflows/answer-business-question.agents';
import type * as ReadImagesAgents from '../workflows/read-images.agents';
import type * as PlannerAgent from '../agents/analysis-planner.agent';
import type * as WriterAgent from '../agents/answer-writer.agent';
import type * as ImageReaderAgent from '../agents/image-reader.agent';
import type * as ReadinessAgent from '../agents/data-readiness.agent';
import type {
  AnalysisPlan,
  AnsweredClarification,
  BusinessAnswer,
} from '../workflows/answer-business-question.steps';
import type { ReadImagesOutcome } from '../workflows/read-images.steps';
import type { AssistantEvalSet, EvalTarget } from './assistant.evals';
import { loadEvalImages } from './eval-images';
import {
  caseInputOf,
  isolatedCallTarget,
  type IsolatedCallOptions,
} from './isolated-call-target';

/**
 * The isolated-call targets of the agents whose step is one model call
 * (agents.md 8.1): Olivia's Plan, Jessica's Write answer, Zoe's Read images
 * and Sarah's Check data quality. Each case carries the call's input in its
 * `input` field, typed below. The model functions and the agents are
 * required on first use, so the eval catalogue loads without Mastra.
 */

/** The target ids (`AssistantEvalSet.target`, else the set's `agentKey`). */
export const ANALYSIS_PLANNER_EVAL_TARGET = 'analysis-planner';
export const ANSWER_WRITER_EVAL_TARGET = 'answer-writer';
export const IMAGE_READER_EVAL_TARGET = 'image-reader';
export const DATA_QUALITY_CHECK_EVAL_TARGET =
  'data-readiness:check-data-quality';

/* eslint-disable @typescript-eslint/no-require-imports */
const stepAgents = () =>
  require('../workflows/answer-business-question.agents') as typeof StepAgents;
const readImagesAgents = () =>
  require('../workflows/read-images.agents') as typeof ReadImagesAgents;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Olivia's input (`planWithModel`): the question and the catalog block the
 * Plan step builds, optionally the conversation before the question
 * (`messages`, default the question alone), Clarify's answered question
 * and Read images' notes.
 */
export interface PlannerEvalInput {
  question: string;
  catalogBlock: string;
  messages?: Parameters<typeof StepAgents.planWithModel>[0]['messages'];
  answered?: AnsweredClarification;
  imageNotes?: string;
}

/** Jessica's input (`writeAnswerWithModel`): question, plan, queries, findings. */
export type WriterEvalInput = Parameters<
  typeof StepAgents.writeAnswerWithModel
>[0];

/** Sarah's Check data quality input (`checkDataQualityWithModel`). */
export type DataQualityEvalInput = Parameters<
  typeof StepAgents.checkDataQualityWithModel
>[0];

/**
 * Zoe's input (`readImagesWithModel`): the run's question and the file
 * names of its reference images in `__fixtures__/images/`, in order.
 */
export interface ImageReaderEvalInput {
  question: string;
  images: string[];
}

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

/** Zoe: the answer is `{ imageNotes, imageCount }` as JSON. */
export function imageReaderEvalTarget(
  sets: AssistantEvalSet[],
  call: Call<
    { question: string; images: Awaited<ReturnType<typeof loadEvalImages>> },
    ReadImagesOutcome
  > = (input, options) => readImagesAgents().readImagesWithModel(input, options),
  loadAgent: () => Agent = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../agents/image-reader.agent') as typeof ImageReaderAgent)
      .imageReaderAgent,
): EvalTarget {
  return isolatedCallTarget({
    agentKey: 'image-reader',
    sets,
    loadAgent,
    call,
    inputOf: async (evalCase) => {
      const input = caseInputOf<ImageReaderEvalInput>(evalCase);
      return {
        question: input.question,
        images: await loadEvalImages(input.images),
      };
    },
    answerOf: (output) => ({
      imageNotes: output.imageNotes,
      imageCount: output.imageCount,
    }),
  });
}

/**
 * Sarah's Check data quality call (her step agent, no tools): the answer is
 * `{ issues }` as JSON, each issue `{ finding, impact }` with `finding`
 * the 1-based number of an input finding. On Sarah's page, next to her
 * chat set.
 */
export function dataQualityCheckEvalTarget(
  sets: AssistantEvalSet[],
  call: Call<
    DataQualityEvalInput,
    { issues: { finding: number; impact: string }[]; stopped: boolean }
  > = (input, options) => stepAgents().checkDataQualityWithModel(input, options),
  loadAgent: () => Agent = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../agents/data-readiness.agent') as typeof ReadinessAgent)
      .dataReadinessStepAgent,
): EvalTarget {
  return isolatedCallTarget({
    agentKey: 'data-readiness',
    sets,
    loadAgent,
    call,
    answerOf: (output) => ({ issues: output.issues }),
  });
}
