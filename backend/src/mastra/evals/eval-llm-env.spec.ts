jest.mock('../../modules/llm/custom-endpoint/config', () => ({
  ...jest.requireActual<object>('../../modules/llm/custom-endpoint/config'),
  customModelConfig: jest.fn((settings: object) => ({
    routed: settings,
  })),
}));

import { customModelConfig } from '../../modules/llm/custom-endpoint/config';
import {
  API_STYLE_INVALID,
  BASE_URL_INVALID,
  BASE_URL_REQUIRED,
} from '../../modules/llm/custom-endpoint/messages';
import {
  EVAL_LLM_PROVIDER_INVALID,
  MODEL_REQUIRED,
  describeEvalTarget,
  evalCustomResolver,
  evalLlmTargetFromEnv,
} from './eval-llm-env';

const FULL = {
  EVAL_LLM_PROVIDER: 'custom',
  EVAL_LLM_API_STYLE: 'openai',
  EVAL_LLM_BASE_URL: 'http://127.0.0.1:8317/v1',
  EVAL_LLM_MODEL: 'gpt-5.2',
  EVAL_LLM_API_KEY: 'sk-secret-123',
};

describe('evalLlmTargetFromEnv', () => {
  it('uses the saved settings when EVAL_LLM_PROVIDER is unset or blank', () => {
    expect(evalLlmTargetFromEnv({})).toEqual({ kind: 'saved' });
    expect(evalLlmTargetFromEnv({ EVAL_LLM_PROVIDER: '  ' })).toEqual({
      kind: 'saved',
    });
  });

  it('reads a custom endpoint, trimmed, with its key', () => {
    expect(
      evalLlmTargetFromEnv({
        ...FULL,
        EVAL_LLM_BASE_URL: ' http://127.0.0.1:8317/v1 ',
        EVAL_LLM_MODEL: ' gpt-5.2 ',
      }),
    ).toEqual({
      kind: 'custom',
      endpoint: {
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'gpt-5.2',
        apiKey: 'sk-secret-123',
      },
    });
  });

  it('leaves the key out when EVAL_LLM_API_KEY is unset or blank', () => {
    for (const key of [undefined, '', '  ']) {
      const target = evalLlmTargetFromEnv({
        ...FULL,
        EVAL_LLM_API_STYLE: 'anthropic',
        EVAL_LLM_API_KEY: key,
      });
      expect(target).toEqual({
        kind: 'custom',
        endpoint: {
          apiStyle: 'anthropic',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'gpt-5.2',
        },
      });
    }
  });

  it('refuses a provider other than custom', () => {
    expect(
      evalLlmTargetFromEnv({ ...FULL, EVAL_LLM_PROVIDER: 'openai' }),
    ).toEqual({ error: EVAL_LLM_PROVIDER_INVALID });
  });

  it('reports the first failure in the R44 order with its text', () => {
    expect(evalLlmTargetFromEnv({ EVAL_LLM_PROVIDER: 'custom' })).toEqual({
      error: API_STYLE_INVALID,
    });
    expect(
      evalLlmTargetFromEnv({ ...FULL, EVAL_LLM_API_STYLE: 'gemini' }),
    ).toEqual({ error: API_STYLE_INVALID });
    expect(
      evalLlmTargetFromEnv({
        ...FULL,
        EVAL_LLM_BASE_URL: ' ',
        EVAL_LLM_MODEL: '',
      }),
    ).toEqual({ error: BASE_URL_REQUIRED });
    for (const url of ['ftp://host/v1', '127.0.0.1:8317', 'not a url']) {
      expect(
        evalLlmTargetFromEnv({
          ...FULL,
          EVAL_LLM_BASE_URL: url,
          EVAL_LLM_MODEL: '',
        }),
      ).toEqual({ error: BASE_URL_INVALID });
    }
    expect(evalLlmTargetFromEnv({ ...FULL, EVAL_LLM_MODEL: ' ' })).toEqual({
      error: MODEL_REQUIRED,
    });
  });

  it('accepts loopback, private and https hosts', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://10.0.0.5:8000/v1',
      'https://gateway.example.com',
    ]) {
      expect(
        evalLlmTargetFromEnv({ ...FULL, EVAL_LLM_BASE_URL: url }),
      ).toMatchObject({ kind: 'custom' });
    }
  });
});

describe('evalCustomResolver', () => {
  const endpoint = {
    apiStyle: 'openai' as const,
    baseUrl: 'http://127.0.0.1:8317/v1',
    model: 'gpt-5.2',
    apiKey: 'sk-secret-123',
  };

  beforeEach(() => jest.mocked(customModelConfig).mockClear());

  it('routes the endpoint the way saved custom settings are routed', async () => {
    await expect(evalCustomResolver(endpoint)()).resolves.toEqual({
      routed: endpoint,
    });
    expect(customModelConfig).toHaveBeenCalledWith(endpoint);
  });

  it('replaces only the model name for an override', async () => {
    await evalCustomResolver(endpoint)(' claude-opus-4-6 ');
    expect(customModelConfig).toHaveBeenCalledWith({
      ...endpoint,
      model: 'claude-opus-4-6',
    });
  });

  it('keeps the env model for a blank override', async () => {
    await evalCustomResolver(endpoint)('  ');
    expect(customModelConfig).toHaveBeenCalledWith(endpoint);
  });
});

describe('describeEvalTarget', () => {
  it('names model, host and style without printing the key', () => {
    const line = describeEvalTarget({
      apiStyle: 'anthropic',
      baseUrl: 'http://127.0.0.1:8317',
      model: 'claude-opus-4-6',
      apiKey: 'sk-secret-123',
    });
    expect(line).toBe(
      'Model: claude-opus-4-6 on custom endpoint 127.0.0.1:8317 (Anthropic-compatible, with API key)',
    );
    expect(line).not.toContain('sk-secret');
  });

  it('says when no key is sent', () => {
    expect(
      describeEvalTarget({
        apiStyle: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3',
      }),
    ).toContain('(OpenAI-compatible, no API key)');
  });
});
