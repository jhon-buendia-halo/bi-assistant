/**
 * Read images as a Mastra step (agents.md 2.15, 5.11, 5.13, 5.18; workflows
 * R35): the only Read images file that imports `@mastra/core/workflows`.
 * Its catalogue entry, edges, runtime contract, branch condition and
 * outcome map are framework-free, in ./read-images.steps.ts, and are
 * re-exported here so a workflow takes all it needs from one place:
 *
 * ```ts
 * createWorkflow({ id, inputSchema, outputSchema, options })
 *   .branch([[hasReferenceImages, readImagesStep]])
 *   .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
 *   .then(<first step>)   // its input declares imageNotes: z.string().default('')
 *   …
 * ```
 *
 * The branch is the workflow's first entry, so its condition reads the
 * run's input. Without images the step is never started (the run shows it
 * `skipped`) and the map passes the input on with `imageNotes: ''`.
 */
import {
  createStep,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { READ_IMAGES_STEP_SCHEMAS } from './read-images.schemas';
import {
  READ_IMAGES_RUNTIME_KEY,
  READ_IMAGES_STEP_ID,
  READ_IMAGES_STEP_TITLE,
  type ReadImagesRuntime,
} from './read-images.steps';
import { engineInputSchema, withContract } from './workflow-contract';
import {
  clarificationAnswerSchema,
  clarifyingQuestionSchema,
} from './analysis.schemas';
import {
  interactiveStep,
  reviewQuestion,
} from './answer-business-question.review';

export {
  READ_IMAGES_OUTCOME_ID,
  READ_IMAGES_RUNTIME_KEY,
  READ_IMAGES_STEP_ID,
  hasReferenceImages,
  readImagesOutcome,
  type ReadImagesRuntime,
} from './read-images.steps';

const SCHEMAS = READ_IMAGES_STEP_SCHEMAS;

type ReadImagesParams = ExecuteFunctionParams<
  unknown,
  z.output<typeof SCHEMAS.input>,
  z.output<typeof SCHEMAS.output>,
  unknown,
  unknown,
  DefaultEngineType
>;

/**
 * The step's input schema as the engine sees it, typed as any workflow
 * input: Read images is the first branch of three workflows whose inputs
 * differ, and Mastra 1.66 types a branch step's input as the whole input
 * before it (`.branch` wants `Step<…, TPrevSchema, …>`). At run time it is
 * the declared schema (`engineInputSchema`), and `withContract` reads only
 * `question` and `images`, dropping the rest.
 */
const engineInput = engineInputSchema(
  SCHEMAS.input,
) as unknown as z.ZodType<any>;

/** The run's Read images runtime, or an error naming the step. */
function runtimeOf(requestContext: {
  get(key: string): unknown;
}): ReadImagesRuntime {
  const runtime = requestContext.get(READ_IMAGES_RUNTIME_KEY) as
    ReadImagesRuntime | undefined;
  if (!runtime) {
    throw new Error(`The ${READ_IMAGES_STEP_TITLE} step has no turn to run`);
  }
  return runtime;
}

/**
 * Read images (agents.md 2.15): the run's runtime (`READ_IMAGES_RUNTIME_KEY`)
 * loads the stored images and makes the Image Reader's one model call;
 * the step passes on `{ imageNotes, imageCount }`. A model error fails the
 * step and the run. A stop passes `''` on without a bail: a bail inside a
 * branch would end only this step, and the next model step sees the
 * aborted signal and ends the run. Its contract (`withContract`) refuses a
 * bad input or output naming `Read images`.
 */
export const readImagesStep = createStep({
  id: READ_IMAGES_STEP_ID,
  description: READ_IMAGES_STEP_TITLE,
  inputSchema: engineInput,
  outputSchema: SCHEMAS.output,
  // In an interactive run of Answer a Business Question (workflows R44)
  // Zoe may ask first, and her notes wait for the user's approval.
  suspendSchema: clarifyingQuestionSchema,
  resumeSchema: clarificationAnswerSchema,
  execute: withContract(
    READ_IMAGES_STEP_TITLE,
    SCHEMAS,
    async (params: ReadImagesParams) => {
      const { inputData, requestContext } = params;
      const runtime = runtimeOf(requestContext);
      const ended = await interactiveStep(
        params as never,
        runtime.interactive === true,
        {
          run: async ({ canAsk, answered, revision }) => {
            const read = await runtime.readImages({
              question: inputData.question,
              images: inputData.images,
              ...(canAsk ? { canAsk } : {}),
              ...(answered ? { answered } : {}),
              ...(revision ? { revision } : {}),
            });
            const output = {
              imageNotes: read.stopped ? '' : read.imageNotes,
              imageCount: read.stopped ? 0 : read.imageCount,
            };
            return {
              output,
              reply: output.imageNotes,
              stopped: read.stopped,
              ...(read.clarification
                ? { clarification: read.clarification }
                : {}),
            };
          },
          // Her notes go on to Nathan or Olivia.
          gate: (output) => ({
            question: reviewQuestion(
              'Zoe',
              'notes on your images',
              'the next agent',
            ),
            review: output.imageNotes || 'Zoe wrote no notes.',
          }),
        },
      );
      return ended.type === 'suspended' ? (ended.value as never) : ended.output;
    },
  ),
});
