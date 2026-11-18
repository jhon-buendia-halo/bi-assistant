/**
 * Review templates' model call (agents.md 5.19): one message with the
 * request's text and the images in order, the exchange recorded as text only,
 * the reply read against the screens and marks shown, a stop and a model
 * error. The agents are stubbed: Jest cannot load Mastra's ESM.
 */
const generate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/site-reviewer.agent', () => ({
  siteReviewerAgent: { generate: (...args: unknown[]) => generate(...args) },
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
import { reviewTemplateWithModel } from './review-website.agents';
import { IRIS_CALL_TIMEOUT_MS, IrisTimeoutError } from './review-website.steps';
import { reviewTemplateRequest } from './review-website.prompts';
import { irisReviewSchema } from './review-website.schemas';

const img = (name: string) => ({
  data: Buffer.from(name),
  mediaType: 'image/png',
});
const MARK = {
  n: 1,
  selector: '#a',
  tag: 'a',
  text: 'Home',
  rect: { x: 0, y: 0, width: 1, height: 1 },
  crop: null,
};
const TEMPLATE = {
  id: '/',
  pages: ['https://x.test/'],
  representative: 'https://x.test/',
};
const INPUT = {
  url: 'https://x.test/',
  template: TEMPLATE,
  shots: [
    {
      screen: 'mobile' as const,
      label: 'Mobile',
      width: 390,
      clean: img('m-clean'),
      marked: img('m-marked'),
      marks: [MARK],
    },
    {
      screen: 'desktop' as const,
      label: 'Desktop',
      width: 1920,
      clean: img('d-clean'),
      marked: img('d-marked'),
      marks: [],
    },
  ],
  measured: [],
};
const REPLY = {
  findings: [
    {
      mark: 1,
      screen: 'mobile',
      severity: 'major',
      category: 'imagery',
      title: 'Blurry logo',
      observed: 'The logo is soft.',
      suggestion: 'Use a 2x image.',
    },
    {
      mark: 5,
      screen: 'desktop',
      severity: 'minor',
      category: 'spacing',
      title: 'Tight footer',
      observed: 'x',
      suggestion: 'y',
    },
    {
      mark: null,
      screen: 'tablet',
      severity: 'minor',
      category: 'spacing',
      title: 'Not shown',
      observed: 'x',
      suggestion: 'y',
    },
  ],
  summary: 'Fine.',
};

type Message = {
  role: string;
  content: { type: string; text?: string; image?: string }[];
};

describe('reviewTemplateWithModel (agents.md 5.19)', () => {
  beforeEach(() => generate.mockReset());

  it('sends the request, then each screen’s clean and marked image, in order', async () => {
    generate.mockResolvedValue({ object: REPLY, text: '' });
    const outcome = await reviewTemplateWithModel(INPUT, {});
    const [messages, options] = generate.mock.calls[0] as [
      Message[],
      Record<string, unknown>,
    ];
    expect(messages).toHaveLength(1);
    const [text, ...images] = messages[0].content;
    expect(text).toEqual({
      type: 'text',
      text: reviewTemplateRequest({
        url: INPUT.url,
        template: TEMPLATE,
        screens: [
          { screen: 'mobile', label: 'Mobile', width: 390, marks: [MARK] },
          { screen: 'desktop', label: 'Desktop', width: 1920, marks: [] },
        ],
        measured: [],
      }),
    });
    expect(images.map((part) => part.image)).toEqual(
      ['m-clean', 'm-marked', 'd-clean', 'd-marked'].map((name) =>
        Buffer.from(name).toString('base64'),
      ),
    );
    expect(options).toMatchObject({
      maxSteps: 1,
      toolChoice: 'none',
      structuredOutput: {
        schema: irisReviewSchema,
        jsonPromptInjection: 'inline',
        errorStrategy: 'warn',
      },
    });
    expect(outcome.stopped).toBe(false);
    expect(outcome.review.summary).toBe('Fine.');
    // an unknown mark becomes null, a screen not shown is dropped
    expect(outcome.review.findings.map((f) => [f.title, f.mark])).toEqual([
      ['Blurry logo', 1],
      ['Tight footer', null],
    ]);
  });

  it('records the exchange as text only and reads a text reply', async () => {
    generate.mockResolvedValue({
      object: undefined,
      text: JSON.stringify(REPLY),
    });
    const exchanges: AgentExchange[] = [];
    const outcome = await reviewTemplateWithModel(INPUT, {
      onExchange: (exchange) => void exchanges.push(exchange),
    });
    expect(outcome.review.findings).toHaveLength(2);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].reply).toBe(JSON.stringify(REPLY));
    expect(JSON.stringify(exchanges)).not.toContain(
      Buffer.from('m-clean').toString('base64'),
    );
  });

  it('reads a reply off the schema as no findings and does not fail', async () => {
    generate.mockResolvedValue({ object: undefined, text: 'No idea.' });
    await expect(reviewTemplateWithModel(INPUT, {})).resolves.toEqual({
      review: { findings: [], summary: '' },
      stopped: false,
    });
  });

  it('fails with the model’s own error', async () => {
    generate.mockResolvedValue({ error: new Error('model has no vision') });
    await expect(reviewTemplateWithModel(INPUT, {})).rejects.toThrow(
      'model has no vision',
    );
    generate.mockRejectedValue(new Error('401 Unauthorized'));
    await expect(reviewTemplateWithModel(INPUT, {})).rejects.toThrow(
      '401 Unauthorized',
    );
  });

  it('reads nothing and records nothing when the turn is stopped', async () => {
    const controller = new AbortController();
    const onExchange = jest.fn();
    const stopped = {
      review: { findings: [], summary: '' },
      stopped: true,
    };
    generate.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    await expect(
      reviewTemplateWithModel(INPUT, {
        abortSignal: controller.signal,
        onExchange,
      }),
    ).resolves.toEqual(stopped);
    generate.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ object: REPLY, text: '' });
    });
    await expect(
      reviewTemplateWithModel(INPUT, {
        abortSignal: controller.signal,
        onExchange,
      }),
    ).resolves.toEqual(stopped);
    expect(onExchange).not.toHaveBeenCalled();
  });
});

// Iris's one deadline (agents.md 5.19; workflows R43): two minutes per try,
// in her own words, and the guarded call's one retry.
describe("reviewTemplateWithModel's guarded call (workflows R43)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    generate.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('aborts a call past two minutes and fails with IrisTimeoutError, not retried', async () => {
    let seen: AbortSignal | undefined;
    generate.mockImplementation((_messages, options) => {
      seen = (options as { abortSignal?: AbortSignal }).abortSignal;
      return new Promise(() => undefined);
    });
    const pending = reviewTemplateWithModel(INPUT, {
      abortSignal: new AbortController().signal,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(IRIS_CALL_TIMEOUT_MS);
    const error = await pending;
    expect(IRIS_CALL_TIMEOUT_MS).toBe(2 * 60_000);
    expect(error).toBeInstanceOf(IrisTimeoutError);
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toBe(
      'Iris did not answer within two minutes while reviewing /. The model may be busy or rate limited: run again later, or untick Visual review with Iris to keep to the measured checks.',
    );
    expect(seen?.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(IRIS_CALL_TIMEOUT_MS);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('a call that resolves as stopped after the deadline is still a timeout', async () => {
    generate.mockImplementation((_messages, options) => {
      const { abortSignal } = options as { abortSignal: AbortSignal };
      return new Promise((resolve) =>
        abortSignal.addEventListener('abort', () =>
          resolve({ object: REPLY, text: '' }),
        ),
      );
    });
    const pending = reviewTemplateWithModel(INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(IRIS_CALL_TIMEOUT_MS);
    expect(await pending).toBeInstanceOf(IrisTimeoutError);
  });

  it('a stopped run aborts the call and is no timeout', async () => {
    const run = new AbortController();
    generate.mockImplementation((_messages, options) => {
      const { abortSignal } = options as { abortSignal: AbortSignal };
      return new Promise((resolve) => {
        if (abortSignal.aborted) resolve({ object: REPLY, text: '' });
        abortSignal.addEventListener('abort', () =>
          resolve({ object: REPLY, text: '' }),
        );
      });
    });
    const pending = reviewTemplateWithModel(INPUT, { abortSignal: run.signal });
    await jest.advanceTimersByTimeAsync(1_000);
    run.abort();
    await expect(pending).resolves.toEqual({
      review: { findings: [], summary: '' },
      stopped: true,
    });
  });

  it('retries a reset once, and a reply cut twice fails with ReplyCutError', async () => {
    generate
      .mockRejectedValueOnce(new TypeError('terminated'))
      .mockResolvedValueOnce({ object: REPLY, text: '' });
    const lines: string[] = [];
    const retried = reviewTemplateWithModel(INPUT, {
      onRetry: (line) => lines.push(line),
    });
    await jest.advanceTimersByTimeAsync(2_000);
    expect((await retried).review.summary).toBe('Fine.');
    expect(lines).toEqual([
      'Review templates: the model call failed (terminated). Trying once more in 2 seconds.',
    ]);
    generate.mockReset();
    generate.mockResolvedValue({
      object: undefined,
      text: '{"findings": [',
      finishReason: 'length',
    });
    const cut = reviewTemplateWithModel(INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await cut).toBeInstanceOf(ReplyCutError);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
