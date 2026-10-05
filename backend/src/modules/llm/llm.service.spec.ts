const mockGenerate = jest.fn();
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = mockGenerate;
  },
}));

import { Logger } from '@nestjs/common';
import {
  resolveAgentModel,
  resolveJudgeModel,
} from '../../mastra/model-resolver';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { EngineSettingsService } from '../engine/engine-settings.service';
import {
  LlmService,
  databricksModelConfig,
  lenaiModelConfig,
  normalizeDatabricksBaseUrl,
} from './llm.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';

function serviceWith(opts?: {
  settings?: Awaited<ReturnType<LlmSettingsRepository['get']>>;
  decryptedKey?: string;
  judgeModel?: string;
  databricksReasoningEffort?: boolean;
}) {
  const { service } = serviceWithMocks(opts);
  return service;
}

/**
 * Same as `serviceWith`, but also hands back the repository/crypto mocks for
 * assertions. The repository mock is stateful (a plain in-memory doc) so a
 * `save()` followed by `getView()` sees what was actually persisted.
 */
function serviceWithMocks(opts?: {
  settings?: Awaited<ReturnType<LlmSettingsRepository['get']>>;
  decryptedKey?: string;
  judgeModel?: string;
  databricksReasoningEffort?: boolean;
}) {
  let doc = opts?.settings ?? null;
  const repository = {
    get: jest.fn().mockImplementation(() => Promise.resolve(doc)),
    save: jest.fn().mockImplementation((patch) => {
      doc = { key: 'llm', ...patch };
      return Promise.resolve(doc);
    }),
    patch: jest.fn().mockImplementation((patch) => {
      if (!doc) return Promise.resolve(null);
      doc = { ...doc, ...patch };
      return Promise.resolve(doc);
    }),
  } as unknown as LlmSettingsRepository;
  const crypto = {
    decrypt: jest.fn().mockReturnValue(opts?.decryptedKey ?? 'len-key'),
    encrypt: jest.fn().mockImplementation((v: string) => `enc(${v})`),
  } as unknown as CryptoService;
  const engineSettings = {
    judgeModel: jest.fn().mockResolvedValue(opts?.judgeModel),
    databricksReasoningEffort: jest
      .fn()
      .mockResolvedValue(opts?.databricksReasoningEffort ?? false),
  } as unknown as EngineSettingsService;
  return {
    service: new LlmService(repository, crypto, engineSettings),
    repository,
    crypto,
  };
}

/** Swaps in a fetch stub for one probe and hands back the request it saw. */
async function probeWith(
  dto: Parameters<LlmService['testConnection']>[0],
  response: {
    ok?: boolean;
    status?: number;
    content?: string;
    text?: string;
    finishReason?: string;
  },
) {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: jest.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: response.finishReason ?? 'stop',
          message: { content: response.content ?? '{"status":"ok"}' },
        },
      ],
    }),
    text: jest.fn().mockResolvedValue(response.text ?? ''),
  });
  global.fetch = fetchMock as typeof fetch;
  try {
    const result = await serviceWith()
      .testConnection(dto)
      .catch((err: Error) => err);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as [
      string,
      RequestInit,
    ];
    return {
      result,
      url,
      init,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
      fetchMock,
    };
  } finally {
    global.fetch = originalFetch;
  }
}

describe('LenAI provider contract', () => {
  it('builds the same deployment URL and API-key header as data-readiness-agent', () => {
    expect(
      lenaiModelConfig({
        model: 'gpt-5-deployment',
        baseUrl: 'https://lenai.example.com/',
        apiKey: 'len-key',
      }),
    ).toEqual({
      id: 'lenai/gpt-5-deployment',
      url: 'https://lenai.example.com/openai/v1/deployments/gpt-5-deployment',
      apiKey: 'len-key',
      headers: { 'X-Api-Key': 'len-key' },
    });
  });

  it('tests LenAI through its deployment route with both authentication headers', async () => {
    const { url, init } = await probeWith(
      {
        provider: 'lenai',
        model: 'gpt-5-deployment',
        baseUrl: 'https://lenai.example.com/',
        apiKey: 'len-key',
      },
      {},
    );

    expect(url).toBe(
      'https://lenai.example.com/openai/v1/deployments/gpt-5-deployment/chat/completions',
    );
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer len-key',
      'X-Api-Key': 'len-key',
    });
  });

  it('uses the LenAI contract for runtime Mastra agent calls', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'lenai',
        model: 'gpt-5-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKeyCiphertext: 'encrypted',
      },
      decryptedKey: 'len-saved',
    });

    service.onModuleInit();

    await expect(resolveAgentModel()).resolves.toEqual({
      id: 'lenai/gpt-5-deployment',
      url: 'https://lenai.example.com/openai/v1/deployments/gpt-5-deployment',
      apiKey: 'len-saved',
      headers: { 'X-Api-Key': 'len-saved' },
    });
  });
});

describe('testConnection mirrors the agent request', () => {
  it('sends the cap as max_completion_tokens for a gpt-5-class deployment', async () => {
    const { body } = await probeWith(
      {
        provider: 'lenai',
        model: 'mmc-tech-gpt-52-272k-2025-12-11',
        baseUrl: 'https://lenai.example.com',
        apiKey: 'len-key',
      },
      {},
    );

    expect(body.max_completion_tokens).toBe(4096);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('sends the cap as max_tokens for a gpt-4.1-class deployment', async () => {
    const { body } = await probeWith(
      {
        provider: 'lenai',
        model: 'mmc-tech-gpt-41-nano-1m-2025-04-14',
        baseUrl: 'https://lenai.example.com',
        apiKey: 'len-key',
      },
      {},
    );

    expect(body.max_tokens).toBe(512);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('asks for structured output so a model that cannot do it fails the test', async () => {
    const { body } = await probeWith(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-key' },
      {},
    );

    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'connection_probe',
        strict: true,
        schema: {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
          additionalProperties: false,
        },
      },
    });
  });

  it('reports the structured value as the reply on success', async () => {
    const { result } = await probeWith(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-key' },
      { content: '{"status":"ok"}' },
    );

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      reply: 'ok',
    });
  });

  it('fails a green HTTP response whose reply is not schema-shaped JSON', async () => {
    const { result } = await probeWith(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-key' },
      { content: 'ok' },
    );

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/structured JSON output/);
  });

  it('fails a green HTTP response whose JSON misses the required property', async () => {
    const { result } = await probeWith(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-key' },
      { content: '{"answer":"ok"}' },
    );

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/structured JSON output/);
  });

  it('keeps the specific authentication and status failure messages', async () => {
    const unauthorized = await probeWith(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-bad' },
      { ok: false, status: 401, text: 'no' },
    );
    expect((unauthorized.result as Error).message).toMatch(
      /Authentication failed \(401\)/,
    );

    const rejected = await probeWith(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-key' },
      { ok: false, status: 400, text: "Unsupported parameter: 'max_tokens'" },
    );
    expect((rejected.result as Error).message).toBe(
      "Provider request failed (400) — Unsupported parameter: 'max_tokens'",
    );
  });
});

describe('save() enforces test-before-save', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects and never persists when the probe fails (e.g. a wrong deployment name)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: jest.fn().mockResolvedValue('Resource not found'),
    }) as unknown as typeof fetch;
    const { service, repository } = serviceWithMocks();

    await expect(
      service.save({
        provider: 'lenai',
        model: 'wrong-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKey: 'len-key',
      }),
    ).rejects.toThrow('Provider request failed (404) — Resource not found');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('persists once the same probe the test-connection endpoint runs succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"status":"ok"}' } }],
      }),
      text: jest.fn().mockResolvedValue(''),
    }) as unknown as typeof fetch;
    const { service, repository } = serviceWithMocks();

    const view = await service.save({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-key',
    });

    expect(view.configured).toBe(true);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});

describe('Anthropic provider', () => {
  afterEach(() => mockGenerate.mockReset());

  it('resolves runtime agent calls to the native anthropic router id', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        baseUrl: '',
        apiKeyCiphertext: 'encrypted',
      },
      decryptedKey: 'sk-ant-saved',
    });

    service.onModuleInit();

    await expect(resolveAgentModel()).resolves.toEqual({
      id: 'anthropic/claude-sonnet-5-5',
      apiKey: 'sk-ant-saved',
    });
  });

  it('probes through a Mastra agent with structured output and reports the value', async () => {
    mockGenerate.mockResolvedValue({ object: { status: 'ok' } });

    const result = await serviceWith().testConnection({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-key',
    });

    expect(result).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      reply: 'ok',
    });
    const [, options] = mockGenerate.mock.calls[0] as [
      unknown,
      { structuredOutput?: unknown },
    ];
    expect(options.structuredOutput).toBeDefined();
  });

  it('fails when the model answers without the structured value', async () => {
    mockGenerate.mockResolvedValue({ object: undefined });

    await expect(
      serviceWith().testConnection({
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        apiKey: 'sk-ant-key',
      }),
    ).rejects.toThrow(/could not produce structured JSON output/);
  });

  it('maps a 401 anywhere in the cause chain to the authentication message', async () => {
    mockGenerate.mockRejectedValue(
      Object.assign(new Error('Failed'), {
        cause: Object.assign(new Error('invalid x-api-key'), {
          statusCode: 401,
        }),
      }),
    );

    await expect(
      serviceWith().testConnection({
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        apiKey: 'sk-ant-bad',
      }),
    ).rejects.toThrow(/Authentication failed \(401\)/);
  });
});

describe('testConnection on reasoning models', () => {
  it('reports the token limit, not a structured-output failure, when reasoning eats the cap', async () => {
    const { result } = await probeWith(
      { provider: 'openai', model: 'gpt-5', apiKey: 'sk-key' },
      { content: '', finishReason: 'length' },
    );

    expect((result as Error).message).toMatch(
      /hit the 4096-token limit before replying/,
    );
  });
});

describe('Databricks provider contract', () => {
  it('builds a bearer-only serving-endpoints config (no LenAI-style extra header)', () => {
    expect(
      databricksModelConfig({
        model: 'databricks-claude-sonnet-4-5',
        baseUrl: 'https://adb-1234567890123456.7.azuredatabricks.net/',
        apiKey: 'db-key',
      }),
    ).toEqual({
      id: 'databricks/databricks-claude-sonnet-4-5',
      url: 'https://adb-1234567890123456.7.azuredatabricks.net/serving-endpoints',
      apiKey: 'db-key',
    });
  });

  describe('normalizeDatabricksBaseUrl', () => {
    it('trims and strips a trailing slash', () => {
      expect(
        normalizeDatabricksBaseUrl('  https://adb-123.azuredatabricks.net/  '),
      ).toBe('https://adb-123.azuredatabricks.net');
    });

    it('strips a pasted /serving-endpoints suffix, with or without a trailing slash', () => {
      expect(
        normalizeDatabricksBaseUrl(
          'https://adb-123.azuredatabricks.net/serving-endpoints',
        ),
      ).toBe('https://adb-123.azuredatabricks.net');
      expect(
        normalizeDatabricksBaseUrl(
          'https://adb-123.azuredatabricks.net/serving-endpoints/',
        ),
      ).toBe('https://adb-123.azuredatabricks.net');
      expect(
        normalizeDatabricksBaseUrl(
          'https://adb-123.azuredatabricks.net/Serving-Endpoints',
        ),
      ).toBe('https://adb-123.azuredatabricks.net');
    });

    it('rejects a non-https host', () => {
      expect(() =>
        normalizeDatabricksBaseUrl('http://adb-123.azuredatabricks.net'),
      ).toThrow(/https/);
    });

    it('rejects a host with its own path', () => {
      expect(() =>
        normalizeDatabricksBaseUrl(
          'https://adb-123.azuredatabricks.net/some/path',
        ),
      ).toThrow(/no path/);
    });

    it('rejects a value that is not a URL at all', () => {
      expect(() => normalizeDatabricksBaseUrl('not a url')).toThrow(/https/);
    });
  });

  it('tests Databricks through the serving-endpoints route, bearer-only, with max_tokens', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"status":"ok"}' } }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    try {
      await serviceWith().testConnection({
        provider: 'databricks',
        model: 'databricks-claude-sonnet-4-5',
        baseUrl: 'https://adb-123.azuredatabricks.net',
        apiKey: 'db-key',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ];
      expect(url).toBe(
        'https://adb-123.azuredatabricks.net/serving-endpoints/chat/completions',
      );
      // Bearer-only — no X-Api-Key like LenAI gets.
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer db-key',
      });
      const body = JSON.parse(options.body) as Record<string, unknown>;
      expect(body.max_tokens).toBe(512);
      expect(body.max_completion_tokens).toBeUndefined();
      // Same structured-output probe every other OpenAI-compatible provider gets.
      expect(body.response_format).toEqual(
        expect.objectContaining({ type: 'json_schema' }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('requires baseUrl for databricks', async () => {
    await expect(
      serviceWith().testConnection({
        provider: 'databricks',
        model: 'databricks-claude-sonnet-4-5',
        apiKey: 'db-key',
      }),
    ).rejects.toThrow(/baseUrl is required for databricks/);
  });

  it.each([
    [404, 'Serving endpoint not found (404) — check the name'],
    [403, 'Access denied (403)'],
  ])('gives a clear message for a %d response', async (status, expected) => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status,
      text: jest.fn().mockResolvedValue('not found'),
    });
    global.fetch = fetchMock as typeof fetch;

    try {
      await expect(
        serviceWith().testConnection({
          provider: 'databricks',
          model: 'no-such-endpoint',
          baseUrl: 'https://adb-123.azuredatabricks.net',
          apiKey: 'db-key',
        }),
      ).rejects.toThrow(expected);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('uses the Databricks contract for runtime Mastra agent calls', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'databricks',
        model: 'databricks-claude-sonnet-4-5',
        baseUrl: 'https://adb-123.azuredatabricks.net',
        apiKeyCiphertext: 'encrypted',
      },
      decryptedKey: 'db-saved',
    });

    service.onModuleInit();

    await expect(resolveAgentModel()).resolves.toEqual({
      id: 'databricks/databricks-claude-sonnet-4-5',
      url: 'https://adb-123.azuredatabricks.net/serving-endpoints',
      apiKey: 'db-saved',
    });
  });
});

describe('providerOptionsFor', () => {
  it('sends reasoningEffort under the openai key for openai', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: '',
        apiKeyCiphertext: 'encrypted',
      },
    });
    await expect(service.providerOptionsFor('high')).resolves.toEqual({
      openai: { reasoningEffort: 'high' },
    });
  });

  it('files reasoningEffort under the lenai key, the bucket a lenai/… model reads', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'lenai',
        model: 'gpt-5-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKeyCiphertext: 'encrypted',
      },
    });
    await expect(service.providerOptionsFor('medium')).resolves.toEqual({
      lenai: { reasoningEffort: 'medium' },
    });
  });

  it('defaults to the openai key when nothing is configured yet', async () => {
    const service = serviceWith();
    await expect(service.providerOptionsFor('low')).resolves.toEqual({
      openai: { reasoningEffort: 'low' },
    });
  });

  it('maps the effort to the anthropic bucket for a Claude model', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        baseUrl: '',
        apiKeyCiphertext: 'encrypted',
      },
    });
    const options = await service.providerOptionsFor('high');
    expect(Object.keys(options)).toEqual(['anthropic']);
  });

  it('sends nothing for databricks unless the operator opted in', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'databricks',
        model: 'databricks-gpt-oss-120b',
        baseUrl: 'https://adb-123.azuredatabricks.net',
        apiKeyCiphertext: 'encrypted',
      },
      databricksReasoningEffort: false,
    });
    await expect(service.providerOptionsFor('high')).resolves.toEqual({});
  });

  it('sends reasoningEffort under the databricks key when opted in', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'databricks',
        model: 'databricks-gpt-oss-120b',
        baseUrl: 'https://adb-123.azuredatabricks.net',
        apiKeyCiphertext: 'encrypted',
      },
      databricksReasoningEffort: true,
    });
    await expect(service.providerOptionsFor('high')).resolves.toEqual({
      databricks: { reasoningEffort: 'high' },
    });
  });
});

describe('judge model resolution', () => {
  it('falls back to the assistant model when nothing is pinned', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: '',
        apiKeyCiphertext: 'encrypted',
      },
      decryptedKey: 'open-key',
    });
    service.onModuleInit();

    await expect(resolveJudgeModel()).resolves.toEqual({
      id: 'openai/gpt-5',
      apiKey: 'open-key',
    });
  });

  it('reuses the stored key/url with the pinned model id when the provider matches', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'lenai',
        model: 'gpt-5-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKeyCiphertext: 'encrypted',
      },
      decryptedKey: 'len-saved',
      judgeModel: 'lenai/gpt-4.1-mini-deployment',
    });
    service.onModuleInit();

    await expect(resolveJudgeModel()).resolves.toEqual(
      lenaiModelConfig({
        model: 'gpt-4.1-mini-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKey: 'len-saved',
      }),
    );
  });

  it('reuses the stored key with a databricks pin under a databricks-configured LLM', async () => {
    const service = serviceWith({
      settings: {
        key: 'llm',
        provider: 'databricks',
        model: 'databricks-claude-sonnet-4-5',
        baseUrl: 'https://adb-123.azuredatabricks.net',
        apiKeyCiphertext: 'encrypted',
      },
      decryptedKey: 'db-saved',
      judgeModel: 'databricks/databricks-gpt-oss-120b',
    });
    service.onModuleInit();

    await expect(resolveJudgeModel()).resolves.toEqual(
      databricksModelConfig({
        model: 'databricks-gpt-oss-120b',
        baseUrl: 'https://adb-123.azuredatabricks.net',
        apiKey: 'db-saved',
      }),
    );
  });

  it('falls back to the env-bound router and warns once when the pinned provider differs', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      const service = serviceWith({
        settings: {
          key: 'llm',
          provider: 'databricks',
          model: 'databricks-claude-sonnet-4-5',
          baseUrl: 'https://adb-123.azuredatabricks.net',
          apiKeyCiphertext: 'encrypted',
        },
        decryptedKey: 'db-saved',
        judgeModel: 'openai/gpt-4.1-mini',
      });
      service.onModuleInit();

      await expect(resolveJudgeModel()).resolves.toBe('openai/gpt-4.1-mini');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('falls back to the assistant model and warns on a malformed pin', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      const service = serviceWith({
        settings: {
          key: 'llm',
          provider: 'openai',
          model: 'gpt-5',
          baseUrl: '',
          apiKeyCiphertext: 'encrypted',
        },
        decryptedKey: 'open-key',
        judgeModel: 'not-a-router-id',
      });
      service.onModuleInit();

      await expect(resolveJudgeModel()).resolves.toEqual({
        id: 'openai/gpt-5',
        apiKey: 'open-key',
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
