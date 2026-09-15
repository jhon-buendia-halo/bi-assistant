import { resolveAgentModel } from '../../mastra/model-resolver';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { LlmService, lenaiModelConfig } from './llm.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';

function serviceWith(opts?: {
  settings?: Awaited<ReturnType<LlmSettingsRepository['get']>>;
  decryptedKey?: string;
}) {
  const repository = {
    get: jest.fn().mockResolvedValue(opts?.settings ?? null),
  } as unknown as LlmSettingsRepository;
  const crypto = {
    decrypt: jest.fn().mockReturnValue(opts?.decryptedKey ?? 'len-key'),
  } as unknown as CryptoService;
  return new LlmService(repository, crypto);
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
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    try {
      await serviceWith().testConnection({
        provider: 'lenai',
        model: 'gpt-5-deployment',
        baseUrl: 'https://lenai.example.com/',
        apiKey: 'len-key',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://lenai.example.com/openai/v1/deployments/gpt-5-deployment/chat/completions',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer len-key',
            'X-Api-Key': 'len-key',
          },
        }),
      );
    } finally {
      global.fetch = originalFetch;
    }
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
