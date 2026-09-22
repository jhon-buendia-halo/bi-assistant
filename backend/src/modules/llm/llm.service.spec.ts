import { resolveAgentModel } from '../../mastra/model-resolver';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
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
  return { service: new LlmService(repository, crypto), repository, crypto };
}

/** Swaps in a fetch stub for one probe and hands back the request it saw. */
async function probeWith(
  dto: Parameters<LlmService['testConnection']>[0],
  response: { ok?: boolean; status?: number; content?: string; text?: string },
) {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: jest.fn().mockResolvedValue({
      choices: [
        { message: { content: response.content ?? '{"status":"ok"}' } },
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

    expect(body.max_completion_tokens).toBe(512);
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
      json: jest
        .fn()
        .mockResolvedValue({ choices: [{ message: { content: '{"status":"ok"}' } }] }),
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
