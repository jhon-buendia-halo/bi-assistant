const mockGenerate = jest.fn();
const mockAgentConfigs: unknown[] = [];
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = mockGenerate;
    constructor(config: unknown) {
      mockAgentConfigs.push(config);
    }
  },
}));
const mockBuildModel = jest.fn();
jest.mock('../../../mastra/model-factory', () => ({
  buildModel: (...args: unknown[]) => mockBuildModel(...args) as unknown,
}));

import { probeAnthropicStyle } from './probe-anthropic';
import {
  notFoundMessage,
  otherHttpMessage,
  RATE_LIMITED_MESSAGE,
  rejectedKeyMessage,
  TIMEOUT_MESSAGE,
  unreachableMessage,
} from './messages';

const BASE = 'http://127.0.0.1:8317/v1';
const BUILT = { modelId: 'built-model' };

/** An AI SDK APICallError-like failure wrapped as Mastra does. */
function httpError(statusCode: number, extra: Record<string, unknown> = {}) {
  const apiError = Object.assign(new Error(`HTTP ${statusCode}`), {
    statusCode,
    ...extra,
  });
  return new Error('Agent generate failed', { cause: apiError });
}

describe('probeAnthropicStyle', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockBuildModel.mockReset();
    mockBuildModel.mockResolvedValue(BUILT);
    mockAgentConfigs.length = 0;
  });

  it('builds the custom-anthropic model and returns the reply with latency', async () => {
    mockGenerate.mockResolvedValue({ object: { status: ' ok ' } });

    const result = await probeAnthropicStyle({
      baseUrl: BASE,
      apiKey: 'sk-secret',
      model: 'local-model',
    });

    expect(result.reply).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');
    expect(mockBuildModel).toHaveBeenCalledWith({
      kind: 'custom-anthropic',
      id: 'anthropic/local-model',
      baseUrl: BASE,
      apiKey: 'sk-secret',
    });
    expect(mockAgentConfigs[0]).toMatchObject({ model: BUILT });
    const [, options] = mockGenerate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      modelSettings: { maxOutputTokens: 512 },
    });
    expect(options.structuredOutput).toBeDefined();
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('omits the key when none is given', async () => {
    mockGenerate.mockResolvedValue({ object: { status: 'ok' } });
    await probeAnthropicStyle({ baseUrl: BASE, model: 'local-model' });
    const [config] = mockBuildModel.mock.calls[0] as [Record<string, unknown>];
    expect(config).not.toHaveProperty('apiKey');
  });

  it('sends the lowest effort for a model with levels (R40, R52)', async () => {
    mockGenerate.mockResolvedValue({ object: { status: 'ok' } });
    await probeAnthropicStyle({ baseUrl: BASE, model: 'claude-opus-5-5' });
    const [, options] = mockGenerate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options.providerOptions).toEqual({
      anthropic: { effort: 'low' },
    });
  });

  it('maps a requested effort onto the model levels', async () => {
    mockGenerate.mockResolvedValue({ object: { status: 'ok' } });
    await probeAnthropicStyle({
      baseUrl: BASE,
      model: 'claude-opus-4-5',
      effort: 'max',
    });
    const [, options] = mockGenerate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options.providerOptions).toEqual({
      anthropic: { effort: 'high' },
    });
  });

  it('drops the effort for a model that rejects it (R29)', async () => {
    mockGenerate.mockResolvedValue({ object: { status: 'ok' } });
    await probeAnthropicStyle({
      baseUrl: BASE,
      model: 'claude-sonnet-4-5',
      effort: 'high',
    });
    const [, options] = mockGenerate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).not.toHaveProperty('providerOptions');
  });

  it('reports a reply without the status as a structured-output failure', async () => {
    mockGenerate.mockResolvedValue({ object: undefined });
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, model: 'local-model' }),
    ).rejects.toThrow(
      'Model answered but could not produce structured JSON output, which every agent here requires',
    );
  });

  it('reports a 404 with the requested URL', async () => {
    mockGenerate.mockRejectedValue(
      httpError(404, { url: `${BASE}/messages`, responseBody: 'not found' }),
    );
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, model: 'm' }),
    ).rejects.toThrow(notFoundMessage(`${BASE}/messages`));
  });

  it('falls back to <base>/messages for a 404 without a URL', async () => {
    mockGenerate.mockRejectedValue(httpError(404));
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, model: 'm' }),
    ).rejects.toThrow(notFoundMessage(`${BASE}/messages`));
  });

  it.each([401, 403])('reports a rejected key (%i)', async (status) => {
    mockGenerate.mockRejectedValue(httpError(status));
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, apiKey: 'sk-secret', model: 'm' }),
    ).rejects.toThrow(rejectedKeyMessage(status));
  });

  it('reports rate limiting (429), found under a RetryError', async () => {
    const apiError = Object.assign(new Error('Too many'), { statusCode: 429 });
    const retryError = Object.assign(new Error('Failed after 3 attempts'), {
      lastError: apiError,
    });
    mockGenerate.mockRejectedValue(retryError);
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, model: 'm' }),
    ).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it('reports other HTTP errors with the first 300 characters of the body', async () => {
    const body = 'x'.repeat(400);
    mockGenerate.mockRejectedValue(httpError(500, { responseBody: body }));
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, model: 'm' }),
    ).rejects.toThrow(otherHttpMessage(500, body));
  });

  it('reports a refused connection as unreachable with the host', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    mockGenerate.mockRejectedValue(
      new TypeError('fetch failed', { cause: refused }),
    );
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, model: 'm' }),
    ).rejects.toThrow(unreachableMessage('127.0.0.1:8317'));
  });

  it('reports a timeout after 30 s', async () => {
    jest.useFakeTimers();
    try {
      mockGenerate.mockImplementation(
        (_prompt: string, options: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener('abort', () =>
              reject(new Error('This operation was aborted')),
            );
          }),
      );
      const pending = probeAnthropicStyle({ baseUrl: BASE, model: 'm' });
      const assertion = expect(pending).rejects.toThrow(TIMEOUT_MESSAGE);
      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a timeout when the aborted run resolves without an object', async () => {
    jest.useFakeTimers();
    try {
      // Mastra resolves (does not throw) when the abort signal fires.
      mockGenerate.mockImplementation(
        (_prompt: string, options: { abortSignal: AbortSignal }) =>
          new Promise((resolve) => {
            options.abortSignal.addEventListener('abort', () =>
              resolve({ object: undefined }),
            );
          }),
      );
      const pending = probeAnthropicStyle({ baseUrl: BASE, model: 'm' });
      const assertion = expect(pending).rejects.toThrow(TIMEOUT_MESSAGE);
      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('never echoes the API key in an error', async () => {
    mockGenerate.mockRejectedValue(
      httpError(500, { responseBody: 'server error' }),
    );
    await expect(
      probeAnthropicStyle({ baseUrl: BASE, apiKey: 'sk-secret', model: 'm' }),
    ).rejects.not.toThrow(/sk-secret/);
  });
});
