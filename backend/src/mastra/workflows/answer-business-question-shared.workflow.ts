import { createStep, createWorkflow } from '@mastra/core/workflows';
import {
  answerBusinessQuestionInputSchema,
  answerBusinessQuestionResultSchema,
  catalogedQuestionSchema,
} from './answer-business-question.schemas';
import {
  exploreResultWorkflow,
  followedUp,
  interpretFollowUpStep,
  loadCatalogStep,
  persistWhileWaiting,
  questionPathWorkflow,
  receiveQuestionStep,
  type StepParams,
} from './answer-business-question.workflow';
import {
  ANSWER_BUSINESS_QUESTION_SHARED_WORKFLOW_ID,
  PUBLISH_RUN_CONTEXT_STEP,
  publishRunContext,
} from './answer-business-question-shared.steps';
import {
  READ_IMAGES_OUTCOME_ID,
  hasReferenceImages,
  readImagesOutcome,
  readImagesStep,
} from './read-images.workflow';
import { runContextOf } from './run-context';
import { engineInputSchema, withContract } from './workflow-contract';

// The experiment's variant of answer-business-question: the same chain, with
// Publish run context right after Load catalog. It writes the catalogue's
// columns and Read images' notes to the run's board (run-context.ts) and
// passes its input on unchanged. Not a catalogue workflow; run by the eval
// target only. The original's steps and nested workflows are reused as they
// are, so its own contract is untouched.

const PUBLISH_SCHEMAS = {
  input: catalogedQuestionSchema,
  output: catalogedQuestionSchema,
};

export const publishRunContextStep = createStep({
  id: PUBLISH_RUN_CONTEXT_STEP.id,
  description: PUBLISH_RUN_CONTEXT_STEP.title,
  inputSchema: engineInputSchema(PUBLISH_SCHEMAS.input),
  outputSchema: PUBLISH_SCHEMAS.output,
  execute: withContract(
    PUBLISH_RUN_CONTEXT_STEP.title,
    PUBLISH_SCHEMAS,
    async ({
      inputData,
      requestContext,
    }: StepParams<typeof PUBLISH_SCHEMAS>) => {
      const board = runContextOf(requestContext);
      if (!board) throw new Error('The run context is missing');
      publishRunContext(board, inputData);
      return Promise.resolve(inputData);
    },
  ),
});

export const answerBusinessQuestionSharedWorkflow = createWorkflow({
  id: ANSWER_BUSINESS_QUESTION_SHARED_WORKFLOW_ID,
  description:
    'Experiment: Answer a Business Question with a shared run context. The large context (columns, image notes, queries) is published once to a board and the agents read only what they need.',
  inputSchema: answerBusinessQuestionInputSchema,
  outputSchema: answerBusinessQuestionResultSchema,
  options: {
    validateInputs: true,
    shouldPersistSnapshot: persistWhileWaiting,
  },
})
  .branch([[hasReferenceImages, readImagesStep]])
  .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(receiveQuestionStep)
  .then(loadCatalogStep)
  .then(publishRunContextStep)
  .then(interpretFollowUpStep)
  .branch([
    [
      async ({ inputData }) => {
        const read = followedUp(inputData);
        return Promise.resolve(!read.stopped && !read.explore);
      },
      questionPathWorkflow,
    ],
    [
      async ({ inputData }) => {
        const read = followedUp(inputData);
        return Promise.resolve(!read.stopped && read.explore);
      },
      exploreResultWorkflow,
    ],
  ])
  .commit();
