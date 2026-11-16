/**
 * The model call of Read images (agents.md 2.15; workflows R35): Zoe, the
 * Image Reader (`image-reader`), on the app's model (`resolveAgentModel`),
 * with her own editable instructions, no tools and no memory, in one call
 * that carries every reference image of the run, with structured output by
 * JSON prompt injection. The run's turn calls it through
 * `ReadImagesRuntime` (`MastraService.readImages`).
 */
import { imageReaderAgent } from '../agents/image-reader.agent';
import {
  noteExchange,
  replyText,
  stoppedBy,
  type StepModelOptions,
} from './answer-business-question.agents';
import { readImagesRequest } from './read-images.prompts';
import { imageDescriptionsSchema } from './read-images.schemas';
import {
  imageDescriptionsOf,
  renderImageNotes,
  type ReadImagesOutcome,
} from './read-images.steps';
import {
  imagesMessage,
  replyFailure,
  tunedOptions,
  type StepImage,
} from './recreate-dashboard.agents';

/** The most tokens the Image Reader's reply takes. */
const READ_IMAGES_OUTPUT_TOKENS = 4000;

/** What a stopped call, or one without images, passes on. */
function noNotes(stopped: boolean): ReadImagesOutcome {
  return { imageNotes: '', imageCount: 0, stopped };
}

/**
 * Read images' call (agents.md 2.15): one user message with the request's
 * text (`readImagesRequest`) and one image part per image, in order; the
 * reply read leniently (`imageDescriptionsOf`) and rendered as the notes
 * (`renderImageNotes`). The exchange is recorded as text only, never an
 * image's bytes. A model error rejects with the model's own error, which
 * fails the step and the run. A stopped turn reads nothing and records
 * nothing (`{ imageNotes: '', imageCount: 0, stopped: true }`). Without
 * images no model is called.
 */
export async function readImagesWithModel(
  input: { question: string; images: readonly StepImage[] },
  options: StepModelOptions,
): Promise<ReadImagesOutcome> {
  if (!input.images.length) return noNotes(false);
  const request = readImagesRequest({
    question: input.question,
    imageCount: input.images.length,
  });
  try {
    const result = await imageReaderAgent.generate(
      imagesMessage(request, input.images),
      {
        ...(await tunedOptions(options, READ_IMAGES_OUTPUT_TOKENS)),
        structuredOutput: {
          schema: imageDescriptionsSchema,
          jsonPromptInjection: 'inline',
          // A reply off the schema is read leniently (`imageDescriptionsOf`).
          errorStrategy: 'warn',
        },
      },
    );
    const reply = result as {
      object?: unknown;
      text?: string;
      error?: unknown;
    };
    if (stoppedBy(options)) return noNotes(true);
    const failure = replyFailure(reply.error);
    if (failure) throw failure;
    await noteExchange(options, request, replyText(reply.object, reply.text));
    const descriptions = imageDescriptionsOf(
      reply.object ?? reply.text,
      input.images.length,
    );
    return {
      imageNotes: renderImageNotes(descriptions),
      imageCount: descriptions.length,
      stopped: false,
    };
  } catch (error) {
    if (stoppedBy(options)) return noNotes(true);
    throw error;
  }
}
