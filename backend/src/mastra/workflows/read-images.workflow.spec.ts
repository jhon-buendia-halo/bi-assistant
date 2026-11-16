// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.branch()`, `.map()` and `.then()` with the engine's step events.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  READ_IMAGES_OUTCOME_ID,
  READ_IMAGES_RUNTIME_KEY,
  READ_IMAGES_STEP_ID,
  hasReferenceImages,
  readImagesOutcome,
  readImagesStep,
  type ReadImagesRuntime,
} from './read-images.workflow';
import { engineInputSchema } from './workflow-contract';

// A tiny workflow shaped as the three real ones start (agents.md 5.11):
// the branch to Read images as the first entry, the outcome map, then the
// first step, whose input defaults `imageNotes` and drops `images`.
const tinyInputSchema = z.object({
  question: z.string(),
  datasets: z.array(z.string()),
  images: z.array(z.string()).optional(),
});
const firstInputSchema = z.object({
  question: z.string(),
  datasets: z.array(z.string()),
  imageNotes: z.string().default(''),
});
const firstOutputSchema = z.object({
  question: z.string(),
  imageNotes: z.string(),
});

const nextStep = createStep({
  id: 'next',
  description: 'Next',
  inputSchema: engineInputSchema(firstInputSchema),
  outputSchema: firstOutputSchema,
  execute: async ({ inputData }) =>
    Promise.resolve({
      question: inputData.question,
      imageNotes: inputData.imageNotes,
    }),
});

const tinyWorkflow = createWorkflow({
  id: 'tiny',
  inputSchema: tinyInputSchema,
  outputSchema: firstOutputSchema,
})
  .branch([[hasReferenceImages, readImagesStep]])
  .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(nextStep)
  .commit();

interface StubEvent {
  type: string;
  payload?: { id?: string; status?: string; output?: unknown };
}

interface StubRun {
  stream(args: { inputData: unknown; requestContext: unknown }): {
    fullStream: AsyncIterable<StubEvent>;
    result: Promise<{ status: string; result?: unknown; error?: unknown }>;
  };
}

const workflow = tinyWorkflow as unknown as { createRun(): Promise<StubRun> };

async function run(
  inputData: Record<string, unknown>,
  runtime?: ReadImagesRuntime,
) {
  const requestContext = new RequestContext();
  if (runtime) requestContext.set(READ_IMAGES_RUNTIME_KEY, runtime);
  const output = (await workflow.createRun()).stream({
    inputData,
    requestContext,
  });
  const events: string[] = [];
  const outputs: Record<string, unknown> = {};
  for await (const event of output.fullStream) {
    const { id, status } = event.payload ?? {};
    if (!id) continue;
    events.push(`${id}:${status}`);
    if (status === 'success') outputs[id] = event.payload?.output;
  }
  return { events, outputs, result: await output.result };
}

const QUESTION = { question: 'Why did EMEA grow?', datasets: ['Sales'] };
const NOTES = '## Reference images\nThe user attached 2 images.';

describe('Read images on the stub (agents.md 2.15, 5.11; workflows R35)', () => {
  it('without images: skips the step, calls no model, and passes imageNotes ""', async () => {
    const readImages = jest.fn<
      ReturnType<ReadImagesRuntime['readImages']>,
      Parameters<ReadImagesRuntime['readImages']>
    >();
    for (const inputData of [QUESTION, { ...QUESTION, images: [] }]) {
      const { events, outputs, result } = await run(inputData, {
        readImages,
      });
      expect(events).toEqual([
        `${READ_IMAGES_OUTCOME_ID}:running`,
        `${READ_IMAGES_OUTCOME_ID}:success`,
        'next:running',
        'next:success',
      ]);
      expect(outputs[READ_IMAGES_OUTCOME_ID]).toEqual({
        ...inputData,
        imageNotes: '',
      });
      expect(result).toEqual({
        status: 'success',
        result: { question: QUESTION.question, imageNotes: '' },
      });
    }
    expect(readImages).not.toHaveBeenCalled();
  });

  it('with images: reads them once and hands the notes to the next step', async () => {
    const images = ['inputs/images/1.png', 'inputs/images/2.jpg'];
    const readImages = jest.fn<
      ReturnType<ReadImagesRuntime['readImages']>,
      Parameters<ReadImagesRuntime['readImages']>
    >(() =>
      Promise.resolve({ imageNotes: NOTES, imageCount: 2, stopped: false }),
    );
    const { events, outputs, result } = await run(
      { ...QUESTION, images },
      { readImages },
    );
    expect(readImages).toHaveBeenCalledTimes(1);
    expect(readImages).toHaveBeenCalledWith({
      question: QUESTION.question,
      images,
    });
    expect(events).toEqual([
      `${READ_IMAGES_STEP_ID}:running`,
      `${READ_IMAGES_STEP_ID}:success`,
      `${READ_IMAGES_OUTCOME_ID}:running`,
      `${READ_IMAGES_OUTCOME_ID}:success`,
      'next:running',
      'next:success',
    ]);
    expect(outputs[READ_IMAGES_STEP_ID]).toEqual({
      imageNotes: NOTES,
      imageCount: 2,
    });
    expect(result).toEqual({
      status: 'success',
      result: { question: QUESTION.question, imageNotes: NOTES },
    });
  });

  it('a stop passes no notes on and does not bail', async () => {
    const { events, result } = await run(
      { ...QUESTION, images: ['inputs/images/1.png'] },
      {
        readImages: () =>
          Promise.resolve({ imageNotes: '', imageCount: 0, stopped: true }),
      },
    );
    expect(events).toContain(`${READ_IMAGES_STEP_ID}:success`);
    expect(result).toEqual({
      status: 'success',
      result: { question: QUESTION.question, imageNotes: '' },
    });
  });

  it("fails the run with the model's own error", async () => {
    const { events, result } = await run(
      { ...QUESTION, images: ['inputs/images/1.png'] },
      { readImages: () => Promise.reject(new Error('model has no vision')) },
    );
    expect(events).toEqual([
      `${READ_IMAGES_STEP_ID}:running`,
      `${READ_IMAGES_STEP_ID}:failed`,
    ]);
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe('model has no vision');
  });

  it('fails when the run has images and no runtime', async () => {
    const { result } = await run({
      ...QUESTION,
      images: ['inputs/images/1.png'],
    });
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe(
      'The Read images step has no turn to run',
    );
  });
});
