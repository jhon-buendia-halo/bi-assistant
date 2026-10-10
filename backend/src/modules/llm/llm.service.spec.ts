const mockGenerate = jest.fn();
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = mockGenerate;
  },
}));

import { resolveAgentModel } from '../../mastra/model-resolver';
import {
  CryptoService,
  UnreadableSecretError,
} from '../../infrastructure/crypto/crypto.service';
import { LlmService, lenaiModelConfig } from './llm.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';

function serviceWith(opts?: {
  settings?: Awaited<ReturnType<LlmSettingsRepository['get']>>;
  decryptedKey?: string;
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
  /** The stored key does not open with the current app secret. */
  unreadable?: boolean;
  /** What `reencryptFormerSecret` hands back (null = nothing to migrate). */
  reencrypted?: string | null;
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
