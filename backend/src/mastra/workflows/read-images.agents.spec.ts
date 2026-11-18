/**
 * Read images' model call (agents.md 2.15; workflows R35): one message with
 * the request's text and every image, the exchange recorded as text only,
 * the reply read leniently, a stop and a model error. The agents are
 * stubbed: Jest cannot load Mastra's ESM.
 */
const generate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/image-reader.agent', () => ({
  imageReaderAgent: { generate: (...args: unknown[]) => generate(...args) },
}));
jest.mock('../agents/dashboard-reader.agent', () => ({
  dashboardReaderAgent: {},
}));
jest.mock('../agents/data-mapper.agent', () => ({ dataMapperAgent: {} }));
jest.mock('../agents/analysis-planner.agent', () => ({
  analysisPlannerAgent: {},
}));
jest.mock('../agents/answer-writer.agent', () => ({ answerWriterAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({}));

import type { AgentExchange } from '../agent-threads';
import { ModelTimeoutError, ReplyCutError } from './model-call';
import { readImagesWithModel } from './read-images.agents';
import { readImagesRequest } from './read-images.prompts';
import { imageDescriptionsSchema } from './read-images.schemas';
import { NO_IMAGE_DESCRIPTION } from './read-images.steps';

const PNG = { data: Buffer.from('png bytes'), mediaType: 'image/png' };
const JPEG = { data: Buffer.from('jpeg bytes'), mediaType: 'image/jpeg' };

const DESCRIBED = {
  images: [
    {
      index: 1,
      kind: 'chart',
      title: 'Revenue by region',
      shows: 'Monthly revenue by region.',
      figures: ['EMEA: $1.2M'],
      text: '',
    },
    {
      index: 2,
      kind: 'table',
      title: 'Top products',
      shows: 'Ten products by units.',
      figures: [],
      text: 'Q3 only',
    },
  ],
};

type Message = {
  role: string;
  content: { type: string; text?: string; image?: string; mimeType?: string }[];
};

describe('readImagesWithModel (agents.md 2.15)', () => {
  beforeEach(() => generate.mockReset());

  it('sends one user message: the request, then one image part per image, in order', async () => {
    generate.mockResolvedValue({ object: DESCRIBED, text: '' });
    const outcome = await readImagesWithModel(
      { question: 'Why did EMEA grow?', images: [PNG, JPEG] },
      {},
    );
    expect(generate).toHaveBeenCalledTimes(1);
    const [messages, options] = generate.mock.calls[0] as [
      Message[],
      Record<string, unknown>,
    ];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toEqual([
      {
        type: 'text',
        text: readImagesRequest({
          question: 'Why did EMEA grow?',
          imageCount: 2,
        }),
      },
      {
        type: 'image',
        image: PNG.data.toString('base64'),
        mimeType: 'image/png',
      },
      {
        type: 'image',
        image: JPEG.data.toString('base64'),
        mimeType: 'image/jpeg',
      },
    ]);
    expect(options).toMatchObject({
      maxSteps: 1,
      toolChoice: 'none',
      structuredOutput: {
        schema: imageDescriptionsSchema,
        jsonPromptInjection: 'inline',
        errorStrategy: 'warn',
      },
    });
    expect(outcome.stopped).toBe(false);
    expect(outcome.imageCount).toBe(2);
    expect(outcome.imageNotes).toContain(
      '### Image 1: Revenue by region (chart)',
    );
    expect(outcome.imageNotes).toContain('### Image 2: Top products (table)');
  });

  it('records the exchange as text only, never an image', async () => {
    generate.mockResolvedValue({
      object: undefined,
      text: JSON.stringify(DESCRIBED),
    });
    const exchanges: AgentExchange[] = [];
    await readImagesWithModel(
      { question: 'Why?', images: [PNG] },
      { onExchange: (exchange) => void exchanges.push(exchange) },
    );
    expect(exchanges).toEqual([
      {
        request: readImagesRequest({ question: 'Why?', imageCount: 1 }),
        reply: JSON.stringify(DESCRIBED),
      },
    ]);
    expect(JSON.stringify(exchanges)).not.toContain(
      PNG.data.toString('base64'),
    );
  });

  it('reads a reply off the schema leniently and does not fail', async () => {
    generate.mockResolvedValue({ object: undefined, text: 'No idea.' });
    const outcome = await readImagesWithModel(
      { question: 'Why?', images: [PNG, JPEG] },
      {},
    );
    expect(outcome.imageCount).toBe(2);
    expect(
      outcome.imageNotes.split(`What it shows: ${NO_IMAGE_DESCRIPTION}`),
    ).toHaveLength(3);
  });

  it('fails with the model’s own error', async () => {
    generate.mockResolvedValue({ error: new Error('model has no vision') });
    await expect(
      readImagesWithModel({ question: 'Why?', images: [PNG] }, {}),
    ).rejects.toThrow('model has no vision');
    generate.mockRejectedValue(new Error('401 Unauthorized'));
    await expect(
      readImagesWithModel({ question: 'Why?', images: [PNG] }, {}),
    ).rejects.toThrow('401 Unauthorized');
  });

  it('reads nothing and records nothing when the turn is stopped', async () => {
    const controller = new AbortController();
    const onExchange = jest.fn();
    generate.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    await expect(
      readImagesWithModel(
        { question: 'Why?', images: [PNG] },
        { abortSignal: controller.signal, onExchange },
      ),
    ).resolves.toEqual({ imageNotes: '', imageCount: 0, stopped: true });
    generate.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ object: DESCRIBED, text: '' });
    });
    await expect(
      readImagesWithModel(
        { question: 'Why?', images: [PNG] },
        { abortSignal: controller.signal, onExchange },
      ),
    ).resolves.toEqual({ imageNotes: '', imageCount: 0, stopped: true });
    expect(onExchange).not.toHaveBeenCalled();
  });

  it('calls no model without images', async () => {
    await expect(
      readImagesWithModel({ question: 'Why?', images: [] }, {}),
    ).resolves.toEqual({ imageNotes: '', imageCount: 0, stopped: false });
    expect(generate).not.toHaveBeenCalled();
  });
});

// The guarded call (workflows R35, R43): a cut reply is not an off-shape
// reply read leniently; it is tried once more, then fails the step.
describe('readImagesWithModel under the guarded call (workflows R43)', () => {
  const INPUT = { question: 'Why?', images: [PNG, JPEG] };
  beforeEach(() => {
    jest.useFakeTimers();
    generate.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('retries once after a reset, with the same request, and reports one line', async () => {
    generate
      .mockRejectedValueOnce(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('socket'), { code: 'UND_ERR_SOCKET' }),
        }),
      )
      .mockResolvedValueOnce({ object: DESCRIBED, text: '' });
    const lines: string[] = [];
    const pending = readImagesWithModel(INPUT, {
      onRetry: (line) => lines.push(line),
    });
    await jest.advanceTimersByTimeAsync(2_000);
    expect((await pending).imageCount).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toEqual(generate.mock.calls[0][0]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Read images: the model call failed/);
  });

  it('fails with ReplyCutError when the reply is cut twice, never empty notes', async () => {
    generate.mockResolvedValue({
      object: undefined,
      text: '{"images": [',
      finishReason: 'length',
    });
    const pending = readImagesWithModel(INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(2_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ReplyCutError);
    expect((error as Error).message).toContain(
      "Read images failed: the model's reply was cut at its output limit (4000 tokens)",
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('fails with ModelTimeoutError past five minutes', async () => {
    generate.mockImplementation(() => new Promise(() => undefined));
    const pending = readImagesWithModel(INPUT, {
      abortSignal: new AbortController().signal,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
