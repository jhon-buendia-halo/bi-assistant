/**
 * Nathan's model call (agents.md 2.17) under the guarded call's deadline
 * (workflows R43): five minutes, then ModelTimeoutError; no retry. The
 * agent is stubbed: Jest cannot load Mastra's ESM.
 */
const generate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = (...args: unknown[]) => generate(...args);
  },
}));
jest.mock('../agent-prompt-overrides', () => ({
  agentInstructions: () => '',
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));

import { ModelTimeoutError } from '../workflows/model-call';
import { interpretResultWithModel } from './result-explorer.agent';

const INPUT = {
  text: 'only 2022',
  candidates: [],
  view: null,
  pageCount: null,
};

describe('interpretResultWithModel under its deadline (workflows R43)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    generate.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('aborts a call past five minutes and fails with ModelTimeoutError', async () => {
    let signal: AbortSignal | undefined;
    generate.mockImplementation((_request, options) => {
      signal = (options as { abortSignal?: AbortSignal }).abortSignal;
      return new Promise(() => undefined);
    });
    const pending = interpretResultWithModel(INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toContain(
      'Result Explorer failed: the model did not answer within 5 minutes',
    );
    expect(signal?.aborted).toBe(true);
  });

  it('does not retry a failure: deadline only', async () => {
    generate.mockRejectedValue(new TypeError('fetch failed'));
    await expect(interpretResultWithModel(INPUT, {})).rejects.toThrow(
      'fetch failed',
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
