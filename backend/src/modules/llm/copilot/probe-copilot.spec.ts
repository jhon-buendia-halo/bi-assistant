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
const mockEnsureSignedIn = jest.fn();
const mockCreateModel = jest.fn();
jest.mock('../../../mastra/copilot', () => ({
  getCopilotRuntime: () => ({ ensureSignedIn: mockEnsureSignedIn }),
  createCopilotModel: (...args: unknown[]) =>
    mockCreateModel(...args) as unknown,
}));

import { probeCopilot } from './probe-copilot';
import { TIMEOUT_MESSAGE } from '../custom-endpoint/messages';
import {
  COPILOT_NOT_SIGNED_IN,
  copilotRequestFailedMessage,
} from '../../../mastra/copilot/copilot-contracts';

const MODEL = { modelId: 'copilot-model' };

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentConfigs.length = 0;
  mockEnsureSignedIn.mockResolvedValue(undefined);
  mockCreateModel.mockReturnValue(MODEL);
  mockGenerate.mockResolvedValue({ object: { status: 'ok' } });
});

describe('probeCopilot (R58)', () => {
  it('signs in, builds the throwaway agent on the Copilot model and returns the reply', async () => {
    const result = await probeCopilot('auto');
    expect(result.reply).toBe('ok');
    expect(mockEnsureSignedIn).toHaveBeenCalled();
    expect(mockCreateModel).toHaveBeenCalledWith({ model: 'auto' });
    expect(mockAgentConfigs[0]).toMatchObject({
      id: 'llm-connection-probe',
      name: 'LLM connection probe',
      model: MODEL,
    });
  });

  it('sends no effort and no output cap for auto', async () => {
    await probeCopilot('auto');
    const options = (mockGenerate.mock.calls as unknown[][])[0][1] as Record<
      string,
      unknown
    >;
    expect(options.providerOptions).toBeUndefined();
    expect(options.modelSettings).toBeUndefined();
  });

  it('sends the lowest Copilot level for a model that has levels', async () => {
    await probeCopilot('claude-sonnet-5');
    const options = (mockGenerate.mock.calls as unknown[][])[0][1] as Record<
      string,
      unknown
    >;
    expect(options.providerOptions).toEqual({
      copilot: { reasoningEffort: 'low' },
    });
  });

  it('passes the sign-in error through and never calls the model', async () => {
    mockEnsureSignedIn.mockRejectedValue(new Error(COPILOT_NOT_SIGNED_IN));
    await expect(probeCopilot('auto')).rejects.toThrow(COPILOT_NOT_SIGNED_IN);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('maps a timeout to the 30s text', async () => {
    mockGenerate.mockImplementation(
      (_prompt: string, options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    jest.useFakeTimers();
    const pending = probeCopilot('auto');
    const assertion = expect(pending).rejects.toThrow(TIMEOUT_MESSAGE);
    await jest.advanceTimersByTimeAsync(30_000);
    await assertion;
    jest.useRealTimers();
  });

  it('keeps an already phrased request failure unchanged', async () => {
    const text = copilotRequestFailedMessage('model not available');
    mockGenerate.mockRejectedValue(new Error(text));
    await expect(probeCopilot('auto')).rejects.toThrow(text);
  });

  it('wraps any other error, cut to 300 characters', async () => {
    mockGenerate.mockRejectedValue(new Error('x'.repeat(500)));
    await expect(probeCopilot('auto')).rejects.toThrow(
      copilotRequestFailedMessage('x'.repeat(300)),
    );
  });

  it('fails a blank or missing status with the structured-output text', async () => {
    mockGenerate.mockResolvedValue({ object: { status: ' ' } });
    await expect(probeCopilot('auto')).rejects.toThrow(
      'Model answered but could not produce structured JSON output, which every agent here requires',
    );
  });
});
