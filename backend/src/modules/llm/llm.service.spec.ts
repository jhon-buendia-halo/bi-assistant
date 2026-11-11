const mockGenerate = jest.fn();
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = mockGenerate;
  },
}));

jest.mock('./custom-endpoint/config', () => ({
  normalizeBaseUrl: jest.fn(),
  customModelConfig: jest.fn(),
  endpointHost: jest.fn((url: string) => new URL(url).host),
}));
jest.mock('./custom-endpoint/probe', () => ({ probeOpenAiStyle: jest.fn() }));
jest.mock('./custom-endpoint/probe-anthropic', () => ({
  probeAnthropicStyle: jest.fn(),
}));
jest.mock('./custom-endpoint/models', () => ({
  listEndpointModels: jest.fn(),
}));
jest.mock('./copilot/probe-copilot', () => ({ probeCopilot: jest.fn() }));
const mockRuntime = {
  status: jest.fn(),
  ensureSignedIn: jest.fn(),
  listModels: jest.fn(),
};
const mockStopRuntime = jest.fn();
jest.mock('../../mastra/copilot', () => ({
  getCopilotRuntime: () => mockRuntime,
  stopCopilotRuntime: () => mockStopRuntime() as unknown,
  createCopilotModel: jest.fn(),
}));

import {
  resolveAgentModel,
  resolveAgentModelConfig,
} from '../../mastra/model-resolver';
import { customModelConfig, normalizeBaseUrl } from './custom-endpoint/config';
import { probeOpenAiStyle } from './custom-endpoint/probe';
import { probeAnthropicStyle } from './custom-endpoint/probe-anthropic';
import { listEndpointModels } from './custom-endpoint/models';
import { probeCopilot } from './copilot/probe-copilot';
import { effortLevelsFor } from '../../mastra/effort-levels';
import {
  CryptoService,
  UnreadableSecretError,
} from '../../infrastructure/crypto/crypto.service';
import { LlmService, lenaiModelConfig } from './llm.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';
import type { LlmSettingsDoc } from './llm.types';

function serviceWith(opts?: Parameters<typeof serviceWithMocks>[0]) {
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
  /** The stored key does not open with the current app secret. */
  unreadable?: boolean;
  /** What `reencryptFormerSecret` hands back (null = nothing to migrate). */
  reencrypted?: string | null;
}) {
  let doc = opts?.settings ?? null;
  const repository = {
    get: jest.fn().mockImplementation(() => Promise.resolve(doc)),
    save: jest.fn().mockImplementation((patch: Omit<LlmSettingsDoc, 'key'>) => {
      doc = { key: 'llm', ...patch };
      return Promise.resolve(doc);
    }),
    patch: jest.fn().mockImplementation((patch: Partial<LlmSettingsDoc>) => {
      if (!doc) return Promise.resolve(null);
      doc = { ...doc, ...patch };
      return Promise.resolve(doc);
    }),
    unset: jest.fn().mockImplementation((...fields: string[]) => {
      if (!doc) return Promise.resolve(null);
      const next: Record<string, unknown> = { ...doc };
      for (const field of fields) delete next[field];
      doc = next as unknown as LlmSettingsDoc;
      return Promise.resolve(doc);
    }),
  } as unknown as LlmSettingsRepository;
  const crypto = {
    decrypt: jest.fn().mockImplementation(() => {
      if (opts?.unreadable) throw new UnreadableSecretError();
      return opts?.decryptedKey ?? 'len-key';
    }),
    encrypt: jest.fn().mockImplementation((v: string) => `enc(${v})`),
    reencryptFormerSecret: jest.fn().mockReturnValue(opts?.reencrypted ?? null),
  } as unknown as CryptoService;
  return { service: new LlmService(repository, crypto), repository, crypto };
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

    await service.onModuleInit();

    await expect(resolveAgentModel()).resolves.toEqual({
      id: 'lenai/gpt-5-deployment',
      url: 'https://lenai.example.com/openai/v1/deployments/gpt-5-deployment',
      apiKey: 'len-saved',
      headers: { 'X-Api-Key': 'len-saved' },
    });
  });

  // A user agent's model override (agents.md 1.3, sessions-chat R56).
  it("swaps in a user agent's model override, keeping the saved provider and key", async () => {
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

    await service.onModuleInit();

    await expect(resolveAgentModel('historian-deployment')).resolves.toEqual({
      id: 'lenai/historian-deployment',
      url: 'https://lenai.example.com/openai/v1/deployments/historian-deployment',
      apiKey: 'len-saved',
      headers: { 'X-Api-Key': 'len-saved' },
    });
    await expect(resolveAgentModel(' ')).resolves.toMatchObject({
      id: 'lenai/gpt-5-deployment',
    });
  });

  it('ignores a model override when no LLM settings are saved', async () => {
    const service = serviceWith({ settings: null });

    await service.onModuleInit();

    await expect(resolveAgentModel('historian-deployment')).resolves.toBe(
      'openai/gpt-4o-mini',
    );
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
    });
    const { service, repository } = serviceWithMocks();

    await expect(
      service.save({
        provider: 'lenai',
        model: 'wrong-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKey: 'len-key',
      }),
    ).rejects.toThrow('Provider request failed (404) — Resource not found');
    expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
  });

  it('persists once the same probe the test-connection endpoint runs succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"status":"ok"}' } }],
      }),
      text: jest.fn().mockResolvedValue(''),
    });
    const { service, repository } = serviceWithMocks();

    const view = await service.save({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-key',
    });

    expect(view.configured).toBe(true);
    expect(jest.spyOn(repository, 'save')).toHaveBeenCalledTimes(1);
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

    await service.onModuleInit();

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

describe('a stored key the app secret cannot read', () => {
  const stored = {
    key: 'llm' as const,
    provider: 'lenai' as const,
    model: 'my-deployment',
    baseUrl: 'https://lenai.example.com',
    apiKeyCiphertext: 'sealed-with-another-secret',
    reasoningEffort: 'low' as const,
  };
  const unreadableMessage =
    "The saved API key can't be read because the app secret changed — enter it again in Settings → LLM Configuration";

  it('re-encrypts a key sealed with the former development secret at startup', async () => {
    const { service, repository } = serviceWithMocks({
      settings: stored,
      reencrypted: 'sealed-with-current-secret',
    });

    await service.onModuleInit();

    expect(jest.spyOn(repository, 'patch')).toHaveBeenCalledWith({
      apiKeyCiphertext: 'sealed-with-current-secret',
    });
    expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
  });

  it('leaves a readable key alone at startup', async () => {
    const { service, repository } = serviceWithMocks({ settings: stored });

    await service.onModuleInit();

    expect(jest.spyOn(repository, 'patch')).not.toHaveBeenCalled();
  });

  it('reports the settings as unreadable instead of failing', async () => {
    const view = await serviceWith({
      settings: stored,
      unreadable: true,
    }).getView();

    expect(view).toEqual({
      provider: 'lenai',
      model: 'my-deployment',
      baseUrl: 'https://lenai.example.com',
      apiKeyMasked: null,
      reasoningEffort: 'low',
      configured: false,
      keyUnreadable: true,
      apiStyle: null,
    });
  });

  it('fails an agent call with the re-entry message', async () => {
    const service = serviceWith({ settings: stored, unreadable: true });
    await service.onModuleInit();

    await expect(resolveAgentModel()).rejects.toThrow(unreadableMessage);
  });

  it('fails a test without a typed key with the re-entry message', async () => {
    await expect(
      serviceWith({ settings: stored, unreadable: true }).testConnection({
        provider: 'lenai',
        model: 'my-deployment',
        baseUrl: 'https://lenai.example.com',
      }),
    ).rejects.toThrow(unreadableMessage);
  });

  it('saves a newly typed key without reading the old one', async () => {
    const { service, crypto } = serviceWithMocks({
      settings: stored,
      unreadable: true,
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"status":"ok"}' } }],
        }),
    } as unknown as Response);

    try {
      await service.save({
        provider: 'lenai',
        model: 'my-deployment',
        baseUrl: 'https://lenai.example.com',
        apiKey: 'sk-new-key',
      });
    } finally {
      fetchSpy.mockRestore();
    }

    expect(jest.spyOn(crypto, 'encrypt')).toHaveBeenCalledWith('sk-new-key');
  });
});

describe('reasoning effort per model', () => {
  const originalFetch = global.fetch;
  const okFetch = () =>
    jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"status":"ok"}' } }],
      }),
      text: jest.fn().mockResolvedValue(''),
    }) as unknown as typeof fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    mockGenerate.mockReset();
  });

  it('probes a reasoning model at its lowest level, whatever effort was chosen', async () => {
    const { body } = await probeWith(
      {
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'sk-key',
        reasoningEffort: 'high',
      },
      {},
    );

    expect(body.reasoning_effort).toBe('minimal');
  });

  it('sends no effort to a model without levels', async () => {
    const { body } = await probeWith(
      { provider: 'openai', model: 'gpt-4.1', apiKey: 'sk-key' },
      {},
    );

    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('probes Claude at its lowest effort through the agent runtime', async () => {
    mockGenerate.mockResolvedValue({ object: { status: 'ok' } });

    await serviceWith().testConnection({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-key',
    });

    const [, options] = mockGenerate.mock.calls[0] as [
      unknown,
      { providerOptions?: unknown },
    ];
    expect(options.providerOptions).toEqual({ anthropic: { effort: 'low' } });
  });

  it('stores the chosen effort with the connection', async () => {
    global.fetch = okFetch();
    const { service } = serviceWithMocks();

    const view = await service.save({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'sk-key',
      reasoningEffort: 'minimal',
    });

    expect(view.reasoningEffort).toBe('minimal');
  });

  it('rejects an effort the model does not offer before calling the provider', async () => {
    global.fetch = okFetch();
    const { service, repository } = serviceWithMocks();

    await expect(
      service.save({
        provider: 'openai',
        model: 'gpt-5.1',
        apiKey: 'sk-key',
        reasoningEffort: 'minimal',
      }),
    ).rejects.toThrow(
      'reasoning effort must be one of: none, low, medium, high',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
  });

  it("keeps a stored effort the new model offers, else uses the model's default", async () => {
    global.fetch = okFetch();
    const stored = {
      key: 'llm' as const,
      provider: 'openai' as const,
      model: 'gpt-5',
      baseUrl: '',
      apiKeyCiphertext: 'enc(sk-key)',
      reasoningEffort: 'minimal' as const,
    };

    const kept = await serviceWithMocks({ settings: stored }).service.save({
      provider: 'openai',
      model: 'gpt-5-mini',
    });
    expect(kept.reasoningEffort).toBe('minimal');

    const reset = await serviceWithMocks({ settings: stored }).service.save({
      provider: 'openai',
      model: 'gpt-5.1',
    });
    expect(reset.reasoningEffort).toBe('high');
  });

  it('answers the levels lookup from the built-in table', () => {
    expect(serviceWith().effortLevels('gpt-5')).toEqual({
      levels: ['minimal', 'low', 'medium', 'high'],
      defaultEffort: 'high',
      probeEffort: 'minimal',
    });
    expect(serviceWith().effortLevels('gpt-4.1')).toEqual({
      levels: [],
      defaultEffort: null,
      probeEffort: null,
    });
  });
});

describe('custom endpoint provider (BA-281)', () => {
  const unreadableMessage =
    "The saved API key can't be read because the app secret changed — enter it again in Settings → LLM Configuration";
  const normalize = jest.mocked(normalizeBaseUrl);
  const modelConfig = jest.mocked(customModelConfig);
  const openAiProbe = jest.mocked(probeOpenAiStyle);
  const anthropicProbe = jest.mocked(probeAnthropicStyle);
  const listModels = jest.mocked(listEndpointModels);

  const customDoc = (
    overrides: Partial<LlmSettingsDoc> = {},
  ): LlmSettingsDoc => ({
    key: 'llm',
    provider: 'custom',
    apiStyle: 'openai',
    model: 'llama3',
    baseUrl: 'http://127.0.0.1:8317/v1',
    apiKeyCiphertext: 'enc(custom-key)',
    reasoningEffort: 'high',
    ...overrides,
  });
  const openAiDoc: LlmSettingsDoc = {
    key: 'llm',
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: '',
    apiKeyCiphertext: 'enc(sk-openai)',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    normalize.mockImplementation((style, url) =>
      style === 'anthropic' && !url.endsWith('/v1') ? `${url}/v1` : url,
    );
    modelConfig.mockImplementation((settings) => ({
      id: `custom/${settings.model}`,
      apiKey: settings.apiKey ?? '',
      url: settings.baseUrl,
    }));
    openAiProbe.mockResolvedValue({ reply: 'ok', latencyMs: 12 });
    anthropicProbe.mockResolvedValue({ reply: 'ready', latencyMs: 34 });
    listModels.mockResolvedValue({ ok: true, models: ['llama3', 'qwen'] });
  });

  describe('validation (R44 order and texts)', () => {
    const test = (dto: Record<string, unknown>) =>
      serviceWith().testConnection(
        dto as unknown as Parameters<LlmService['testConnection']>[0],
      );

    it('rejects an unknown provider naming all four', async () => {
      await expect(test({ provider: 'azure', model: 'x' })).rejects.toThrow(
        'provider must be one of: openai, anthropic, lenai, custom',
      );
    });

    it('checks the API style first (before base URL and model)', async () => {
      await expect(test({ provider: 'custom' })).rejects.toThrow(
        'apiStyle must be one of: openai, anthropic',
      );
      await expect(
        test({ provider: 'custom', apiStyle: 'azure', baseUrl: 'x' }),
      ).rejects.toThrow('apiStyle must be one of: openai, anthropic');
    });

    it('then base URL presence', async () => {
      await expect(
        test({ provider: 'custom', apiStyle: 'openai', baseUrl: '   ' }),
      ).rejects.toThrow('baseUrl is required for custom');
    });

    it.each(['ftp://host/v1', 'not a url', '127.0.0.1:8317'])(
      'then base URL form (%s)',
      async (baseUrl) => {
        await expect(
          test({ provider: 'custom', apiStyle: 'openai', baseUrl }),
        ).rejects.toThrow('baseUrl must be an http or https URL');
      },
    );

    it('then the model', async () => {
      await expect(
        test({
          provider: 'custom',
          apiStyle: 'openai',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: ' ',
        }),
      ).rejects.toThrow('model is required');
    });

    it.each(['http://localhost:11434/v1', 'https://10.0.0.5/v1'])(
      'accepts loopback and private hosts (%s)',
      async (baseUrl) => {
        await expect(
          test({ provider: 'custom', apiStyle: 'openai', baseUrl, model: 'm' }),
        ).resolves.toMatchObject({ provider: 'custom', model: 'm' });
      },
    );

    it('ignores an API style sent for another provider', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '{"status":"ok"}' } }],
        }),
      }) as typeof fetch;
      try {
        const { service, repository } = serviceWithMocks();
        await service.save({
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'sk-key',
          apiStyle: 'bogus' as never,
        });
        const stored = await repository.get();
        expect(stored).not.toHaveProperty('apiStyle');
        expect((await service.getView()).apiStyle).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('testConnection', () => {
    it('probes the OpenAI style on the normalised URL at the lowest effort', async () => {
      const service = serviceWith();

      const result = await service.testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: ' http://127.0.0.1:8317/v1// ',
        model: 'gpt-5',
        apiKey: ' sk-typed ',
      });

      expect(normalize).toHaveBeenCalledWith(
        'openai',
        'http://127.0.0.1:8317/v1',
      );
      expect(openAiProbe).toHaveBeenCalledWith({
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'gpt-5',
        apiKey: 'sk-typed',
        effort: effortLevelsFor('gpt-5')[0],
      });
      expect(anthropicProbe).not.toHaveBeenCalled();
      expect(result).toEqual({
        provider: 'custom',
        model: 'gpt-5',
        reply: 'ok',
        latencyMs: 12,
      });
    });

    it('probes the Anthropic style on <root>/v1', async () => {
      const result = await serviceWith().testConnection({
        provider: 'custom',
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317/',
        model: 'claude-opus-4-1',
        apiKey: 'sk-ant',
      });

      expect(anthropicProbe).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'claude-opus-4-1',
          apiKey: 'sk-ant',
        }),
      );
      expect(openAiProbe).not.toHaveBeenCalled();
      expect(result).toEqual({
        provider: 'custom',
        model: 'claude-opus-4-1',
        reply: 'ready',
        latencyMs: 34,
      });
    });

    it('sends no effort for a model without levels', async () => {
      await serviceWith().testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'gpt-4o-mini',
      });

      expect(openAiProbe.mock.calls[0][0]).not.toHaveProperty('effort');
    });

    it('calls a keyless endpoint with no key when nothing is stored', async () => {
      await serviceWith().testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'llama3',
      });

      expect(openAiProbe.mock.calls[0][0]).not.toHaveProperty('apiKey');
    });

    it('uses the stored key when the stored provider is custom', async () => {
      await serviceWith({
        settings: customDoc(),
        decryptedKey: 'custom-key',
      }).testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'llama3',
        apiKey: '  ',
      });

      expect(openAiProbe.mock.calls[0][0]).toMatchObject({
        apiKey: 'custom-key',
      });
    });

    it('never sends a key stored for another provider', async () => {
      const { service, crypto } = serviceWithMocks({
        settings: openAiDoc,
        decryptedKey: 'sk-openai',
      });

      await service.testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'llama3',
      });

      expect(openAiProbe.mock.calls[0][0]).not.toHaveProperty('apiKey');
      expect(jest.spyOn(crypto, 'decrypt')).not.toHaveBeenCalled();
    });

    it('fails with the re-entry message when the stored custom key is unreadable', async () => {
      await expect(
        serviceWith({ settings: customDoc(), unreadable: true }).testConnection(
          {
            provider: 'custom',
            apiStyle: 'openai',
            baseUrl: 'http://127.0.0.1:8317/v1',
            model: 'llama3',
          },
        ),
      ).rejects.toThrow(unreadableMessage);
      expect(openAiProbe).not.toHaveBeenCalled();
    });

    it("reports the probe's own failure text", async () => {
      openAiProbe.mockRejectedValue(
        new Error('The endpoint rejected the API key (401)'),
      );

      await expect(
        serviceWith().testConnection({
          provider: 'custom',
          apiStyle: 'openai',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'llama3',
          apiKey: 'bad',
        }),
      ).rejects.toThrow('The endpoint rejected the API key (401)');
    });
  });

  describe('save', () => {
    it('stores a typed key encrypted, the API style and the trimmed base URL', async () => {
      const { service, repository } = serviceWithMocks({
        decryptedKey: 'sk-custom-1234',
      });

      const view = await service.save({
        provider: 'custom',
        apiStyle: 'anthropic',
        baseUrl: ' http://127.0.0.1:8317/ ',
        model: 'claude-opus-4-1',
        apiKey: 'sk-custom-1234',
      });

      expect(anthropicProbe).toHaveBeenCalledTimes(1);
      expect(await repository.get()).toMatchObject({
        provider: 'custom',
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317',
        model: 'claude-opus-4-1',
        apiKeyCiphertext: 'enc(sk-custom-1234)',
      });
      expect(view).toMatchObject({
        provider: 'custom',
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317',
        apiKeyMasked: '••••••••1234',
        configured: true,
      });
    });

    it('saves a keyless endpoint with no ciphertext over another provider', async () => {
      const { service, repository, crypto } = serviceWithMocks({
        settings: openAiDoc,
      });

      const view = await service.save({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'llama3',
      });

      const stored = await repository.get();
      expect(stored).not.toHaveProperty('apiKeyCiphertext');
      expect(stored).toMatchObject({ provider: 'custom', apiStyle: 'openai' });
      expect(
        jest.spyOn(repository, 'save').mock.calls[0][0],
      ).not.toHaveProperty('apiKeyCiphertext');
      expect(jest.spyOn(crypto, 'encrypt')).not.toHaveBeenCalled();
      expect(view).toMatchObject({
        provider: 'custom',
        apiKeyMasked: null,
        configured: true,
        apiStyle: 'openai',
      });
    });

    it('keeps the stored custom key when the key is blank', async () => {
      const { service, repository } = serviceWithMocks({
        settings: customDoc(),
        decryptedKey: 'custom-key',
      });

      await service.save({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'qwen',
        apiKey: '',
      });

      expect(openAiProbe.mock.calls[0][0]).toMatchObject({
        apiKey: 'custom-key',
      });
      expect((await repository.get())?.apiKeyCiphertext).toBe(
        'enc(custom-key)',
      );
    });

    it('persists nothing when the probe fails', async () => {
      openAiProbe.mockRejectedValue(
        new Error(
          'The endpoint answered 404 at http://127.0.0.1:8317/chat/completions — check the base URL (OpenAI-compatible servers usually end in /v1)',
        ),
      );
      const { service, repository } = serviceWithMocks();

      await expect(
        service.save({
          provider: 'custom',
          apiStyle: 'openai',
          baseUrl: 'http://127.0.0.1:8317',
          model: 'llama3',
        }),
      ).rejects.toThrow('The endpoint answered 404');
      expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
    });

    describe('switching away from custom (R6 unchanged)', () => {
      const originalFetch = global.fetch;
      beforeEach(() => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            choices: [{ message: { content: '{"status":"ok"}' } }],
          }),
        }) as typeof fetch;
      });
      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('stores a typed key and drops the API style', async () => {
        const { service, repository } = serviceWithMocks({
          settings: customDoc(),
          decryptedKey: 'sk-openai-5678',
        });

        const view = await service.save({
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'sk-openai-5678',
        });

        const stored = await repository.get();
        expect(stored).not.toHaveProperty('apiStyle');
        expect(stored).toMatchObject({
          provider: 'openai',
          apiKeyCiphertext: 'enc(sk-openai-5678)',
        });
        expect(view.apiStyle).toBeNull();
      });

      it('never sends the stored custom key to a public provider', async () => {
        const { service, repository, crypto } = serviceWithMocks({
          settings: customDoc(),
          decryptedKey: 'custom-key',
        });

        await expect(
          service.save({ provider: 'openai', model: 'gpt-4o-mini' }),
        ).rejects.toThrow('apiKey is required — none stored yet');
        await expect(
          service.testConnection({
            provider: 'anthropic',
            model: 'claude-opus-4-1',
            apiKey: ' ',
          }),
        ).rejects.toThrow('apiKey is required — none stored yet');
        expect(jest.spyOn(crypto, 'decrypt')).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
      });

      it('still reuses the stored key between public providers', async () => {
        const { service } = serviceWithMocks({
          settings: openAiDoc,
          decryptedKey: 'sk-openai',
        });

        await expect(
          service.testConnection({ provider: 'openai', model: 'gpt-4o-mini' }),
        ).resolves.toMatchObject({ provider: 'openai' });
      });

      it('requires a key when the stored custom endpoint is keyless', async () => {
        const { service, repository } = serviceWithMocks({
          settings: customDoc({ apiKeyCiphertext: undefined }),
        });

        await expect(
          service.save({ provider: 'openai', model: 'gpt-4o-mini' }),
        ).rejects.toThrow('apiKey is required — none stored yet');
        expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
      });
    });
  });

  describe('getView', () => {
    it('reads a keyless custom endpoint as configured with no masked key', async () => {
      const { apiKeyCiphertext, ...keyless } = customDoc();
      void apiKeyCiphertext;

      await expect(
        serviceWith({ settings: keyless }).getView(),
      ).resolves.toEqual({
        provider: 'custom',
        model: 'llama3',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKeyMasked: null,
        reasoningEffort: 'high',
        configured: true,
        apiStyle: 'openai',
      });
    });

    it('masks a stored custom key', async () => {
      await expect(
        serviceWith({
          settings: customDoc(),
          decryptedKey: 'sk-local-9876',
        }).getView(),
      ).resolves.toMatchObject({
        apiKeyMasked: '••••••••9876',
        configured: true,
        apiStyle: 'openai',
      });
    });

    it('answers apiStyle null with nothing stored or for another provider', async () => {
      await expect(serviceWith().getView()).resolves.toMatchObject({
        apiStyle: null,
        configured: false,
      });
      await expect(
        serviceWith({
          settings: { ...openAiDoc, apiStyle: 'anthropic' },
        }).getView(),
      ).resolves.toMatchObject({ apiStyle: null, configured: true });
    });

    it('does not read a non-custom doc without a key as configured', async () => {
      const { apiKeyCiphertext, ...keyless } = openAiDoc;
      void apiKeyCiphertext;

      await expect(
        serviceWith({ settings: keyless }).getView(),
      ).resolves.toMatchObject({ apiKeyMasked: null, configured: false });
    });
  });

  describe('agent model resolver', () => {
    it('builds the custom route from the saved settings and key', async () => {
      const service = serviceWith({
        settings: customDoc({ apiStyle: 'anthropic', baseUrl: 'http://h:1' }),
        decryptedKey: 'custom-key',
      });
      await service.onModuleInit();

      await expect(resolveAgentModelConfig()).resolves.toEqual({
        id: 'custom/llama3',
        apiKey: 'custom-key',
        url: 'http://h:1',
      });
      expect(modelConfig).toHaveBeenCalledWith({
        apiStyle: 'anthropic',
        baseUrl: 'http://h:1',
        model: 'llama3',
        apiKey: 'custom-key',
      });
    });

    it("honours a user agent's model override", async () => {
      const service = serviceWith({ settings: customDoc() });
      await service.onModuleInit();

      await resolveAgentModelConfig(' qwen ');

      expect(modelConfig).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'qwen' }),
      );
    });

    it('passes no key for a keyless endpoint', async () => {
      const { service, crypto } = serviceWithMocks({
        settings: customDoc({ apiKeyCiphertext: undefined }),
      });
      await service.onModuleInit();

      await resolveAgentModelConfig();

      expect(modelConfig.mock.calls[0][0]).not.toHaveProperty('apiKey');
      expect(jest.spyOn(crypto, 'decrypt')).not.toHaveBeenCalled();
    });

    it('fails with the re-entry message when the custom key is unreadable', async () => {
      const service = serviceWith({ settings: customDoc(), unreadable: true });
      await service.onModuleInit();

      await expect(resolveAgentModelConfig()).rejects.toThrow(
        unreadableMessage,
      );
    });
  });

  describe('migration M11', () => {
    it('skips a keyless custom endpoint', async () => {
      const { service, crypto, repository } = serviceWithMocks({
        settings: customDoc({ apiKeyCiphertext: undefined }),
        reencrypted: 'never',
      });

      await service.onModuleInit();

      expect(
        jest.spyOn(crypto, 'reencryptFormerSecret'),
      ).not.toHaveBeenCalled();
      expect(jest.spyOn(repository, 'patch')).not.toHaveBeenCalled();
    });

    it('re-encrypts a stored custom key', async () => {
      const { service, repository } = serviceWithMocks({
        settings: customDoc(),
        reencrypted: 'sealed-now',
      });

      await service.onModuleInit();

      expect(jest.spyOn(repository, 'patch')).toHaveBeenCalledWith({
        apiKeyCiphertext: 'sealed-now',
      });
    });
  });

  describe('listModels (R48)', () => {
    const body = {
      provider: 'custom' as const,
      apiStyle: 'openai' as const,
      baseUrl: 'http://127.0.0.1:8317/v1/',
    };

    it('rejects any provider but custom', async () => {
      await expect(
        serviceWith().listModels({ ...body, provider: 'openai' as never }),
      ).resolves.toEqual({
        ok: false,
        message: 'provider must be custom or copilot to load models',
      });
      expect(listModels).not.toHaveBeenCalled();
    });

    it.each([
      [{ apiStyle: 'azure' }, 'apiStyle must be one of: openai, anthropic'],
      [{ baseUrl: '' }, 'baseUrl is required for custom'],
      [{ baseUrl: 'file:///etc' }, 'baseUrl must be an http or https URL'],
    ])('validates as R44 (%o)', async (patch, message) => {
      await expect(
        serviceWith().listModels({ ...body, ...patch } as never),
      ).resolves.toEqual({ ok: false, message });
      expect(listModels).not.toHaveBeenCalled();
    });

    it('lists through the normalised URL with the typed key and persists nothing', async () => {
      const { service, repository } = serviceWithMocks();

      await expect(
        service.listModels({ ...body, apiKey: ' sk-typed ' }),
      ).resolves.toEqual({ ok: true, models: ['llama3', 'qwen'] });
      expect(normalize).toHaveBeenCalledWith(
        'openai',
        'http://127.0.0.1:8317/v1',
      );
      expect(listModels).toHaveBeenCalledWith({
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKey: 'sk-typed',
      });
      expect(jest.spyOn(repository, 'save')).not.toHaveBeenCalled();
      expect(jest.spyOn(repository, 'patch')).not.toHaveBeenCalled();
    });

    it('uses <root>/v1 for the Anthropic style', async () => {
      await serviceWith().listModels({
        ...body,
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317',
      });

      expect(listModels).toHaveBeenCalledWith({
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317/v1',
      });
    });

    it('uses the stored custom key when none is typed', async () => {
      await serviceWith({
        settings: customDoc(),
        decryptedKey: 'custom-key',
      }).listModels(body);

      expect(listModels.mock.calls[0][0]).toMatchObject({
        apiKey: 'custom-key',
      });
    });

    it('sends no key stored for another provider', async () => {
      await serviceWith({
        settings: openAiDoc,
        decryptedKey: 'sk-openai',
      }).listModels(body);

      expect(listModels.mock.calls[0][0]).not.toHaveProperty('apiKey');
    });

    it('answers the re-entry message for an unreadable stored custom key', async () => {
      await expect(
        serviceWith({ settings: customDoc(), unreadable: true }).listModels(
          body,
        ),
      ).resolves.toEqual({ ok: false, message: unreadableMessage });
    });

    it("passes the endpoint's failure through", async () => {
      listModels.mockResolvedValue({
        ok: false,
        message: 'Model list request timed out after 15s',
      });

      await expect(serviceWith().listModels(body)).resolves.toEqual({
        ok: false,
        message: 'Model list request timed out after 15s',
      });
    });
  });
});

/* eslint-disable @typescript-eslint/unbound-method -- jest doubles */
describe('GitHub Copilot provider (BA-159)', () => {
  const probe = jest.mocked(probeCopilot);
  const copilotDoc = (
    overrides: Partial<LlmSettingsDoc> = {},
  ): LlmSettingsDoc => ({
    key: 'llm',
    provider: 'copilot',
    model: 'auto',
    baseUrl: '',
    reasoningEffort: 'high',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    probe.mockResolvedValue({ reply: 'ok', latencyMs: 9 });
  });

  describe('save (R55, R56)', () => {
    it('saves a blank model as auto with no key and no URL, after the probe', async () => {
      const { service, repository, crypto } = serviceWithMocks();
      const view = await service.save({
        provider: 'copilot',
        model: '  ',
        apiKey: 'ignored',
        baseUrl: 'http://ignored',
        apiStyle: 'openai',
      });
      expect(probe).toHaveBeenCalledWith('auto');
      expect(repository.save).toHaveBeenCalledWith({
        provider: 'copilot',
        model: 'auto',
        baseUrl: '',
        reasoningEffort: 'high',
      });
      expect(crypto.encrypt).not.toHaveBeenCalled();
      expect(view).toMatchObject({
        provider: 'copilot',
        model: 'auto',
        baseUrl: null,
        apiStyle: null,
        apiKeyMasked: null,
        configured: true,
      });
      expect(view.keyUnreadable).toBeUndefined();
    });

    it('removes a key stored for another provider', async () => {
      const { service, repository } = serviceWithMocks({
        settings: {
          key: 'llm',
          provider: 'openai',
          model: 'gpt-4o-mini',
          baseUrl: '',
          apiKeyCiphertext: 'enc(sk)',
        },
      });
      await service.save({ provider: 'copilot', model: 'gpt-5' });
      expect(jest.mocked(repository.save).mock.calls[0][0]).not.toHaveProperty(
        'apiKeyCiphertext',
      );
    });

    it('does not persist when the probe fails, passing its text through', async () => {
      probe.mockRejectedValue(new Error('Not signed in to GitHub — x'));
      const { service, repository } = serviceWithMocks();
      await expect(
        service.save({ provider: 'copilot', model: 'auto' }),
      ).rejects.toThrow('Not signed in to GitHub — x');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('checks the effort against the Copilot levels, none for auto', async () => {
      await expect(
        serviceWith().save({
          provider: 'copilot',
          model: 'auto',
          reasoningEffort: 'high',
        }),
      ).rejects.toThrow('reasoning effort must be one of: none for this model');
      await expect(
        serviceWith().save({
          provider: 'copilot',
          model: 'gpt-5.2',
          reasoningEffort: 'none',
        }),
      ).rejects.toThrow(
        'reasoning effort must be one of: low, medium, high, xhigh',
      );
    });

    it('lists copilot in the provider rejection text', async () => {
      await expect(
        serviceWith().save({ provider: 'nope' as never, model: 'x' }),
      ).rejects.toThrow(
        'provider must be one of: openai, anthropic, lenai, custom, copilot',
      );
    });
  });

  describe('switching away from copilot', () => {
    it.each(['openai', 'anthropic', 'lenai'] as const)(
      'needs a key for %s: none is stored',
      async (provider) => {
        const service = serviceWith({ settings: copilotDoc() });
        await expect(
          service.save({
            provider,
            model: 'm',
            baseUrl: 'https://lenai.example.com',
          }),
        ).rejects.toThrow('apiKey is required — none stored yet');
      },
    );
  });

  describe('testConnection', () => {
    it('probes the model and reports provider copilot', async () => {
      await expect(
        serviceWith().testConnection({ provider: 'copilot', model: 'gpt-5' }),
      ).resolves.toMatchObject({
        provider: 'copilot',
        model: 'gpt-5',
        latencyMs: 9,
        reply: 'ok',
      });
      expect(probe).toHaveBeenCalledWith('gpt-5');
    });
  });

  describe('agent model resolver', () => {
    it('resolves the saved model as plain Copilot data, with no key read', async () => {
      const { service, crypto } = serviceWithMocks({
        settings: copilotDoc({ model: 'gpt-5' }),
      });
      await service.onModuleInit();
      await expect(resolveAgentModelConfig()).resolves.toEqual({
        kind: 'copilot',
        id: 'copilot/gpt-5',
      });
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it("honours a user agent's model override", async () => {
      const service = serviceWith({ settings: copilotDoc() });
      await service.onModuleInit();
      await expect(
        resolveAgentModelConfig(' claude-sonnet-5 '),
      ).resolves.toEqual({
        kind: 'copilot',
        id: 'copilot/claude-sonnet-5',
      });
    });
  });

  describe('listModels (R48)', () => {
    it('lists the seat models', async () => {
      mockRuntime.listModels.mockResolvedValue(['gpt-5', 'claude-sonnet-5']);
      await expect(
        serviceWith().listModels({ provider: 'copilot' }),
      ).resolves.toEqual({ ok: true, models: ['gpt-5', 'claude-sonnet-5'] });
    });

    it('answers a runtime failure in the body', async () => {
      mockRuntime.listModels.mockRejectedValue(new Error('Not signed in'));
      await expect(
        serviceWith().listModels({ provider: 'copilot' }),
      ).resolves.toEqual({ ok: false, message: 'Not signed in' });
    });

    it('times out after 15s', async () => {
      jest.useFakeTimers();
      mockRuntime.listModels.mockReturnValue(new Promise(() => undefined));
      const pending = serviceWith().listModels({ provider: 'copilot' });
      await jest.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toEqual({
        ok: false,
        message: 'Model list request timed out after 15s',
      });
      jest.useRealTimers();
    });
  });

  it('answers the status from the runtime', async () => {
    const status = {
      signedIn: false,
      login: null,
      method: null,
      message: 'Not signed in to GitHub',
    };
    mockRuntime.status.mockResolvedValue(status);
    await expect(serviceWith().copilotStatus()).resolves.toBe(status);
  });

  it('answers the levels lookup per provider (api.md 32a)', () => {
    const service = serviceWith();
    expect(service.effortLevels('auto', 'copilot')).toEqual({
      levels: [],
      defaultEffort: null,
      probeEffort: null,
    });
    expect(service.effortLevels('gpt-5.2', 'copilot').levels).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(service.effortLevels('gpt-5.2').levels).toContain('none');
  });

  describe('shutdown', () => {
    it('stops the runtime', async () => {
      await serviceWith().onModuleDestroy();
      expect(mockStopRuntime).toHaveBeenCalled();
    });

    it('never throws', async () => {
      mockStopRuntime.mockRejectedValue(new Error('boom'));
      await expect(serviceWith().onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
/* eslint-enable @typescript-eslint/unbound-method */
