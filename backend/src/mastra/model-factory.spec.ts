import type { LanguageModelV3 } from '@ai-sdk/provider';

const mockCreateCopilotModel = jest.fn();
jest.mock('./copilot', () => ({
  createCopilotModel: (...args: unknown[]) =>
    mockCreateCopilotModel(...args) as unknown,
}));

import { buildModel } from './model-factory';
import type {
  AgentModelConfig,
  CustomAnthropicModelConfig,
} from './model-resolver';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const messagesReply = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'pong' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 3, output_tokens: 1 },
};

describe('buildModel', () => {
  const realFetch = globalThis.fetch;
  const realEnvKey = process.env.ANTHROPIC_API_KEY;
  let captured: Captured[];

  beforeEach(() => {
    captured = [];
    globalThis.fetch = jest.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => {
          headers[key] = value;
        });
        captured.push({
          url: input instanceof Request ? input.url : input.toString(),
          headers,
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return Promise.resolve(
          new Response(JSON.stringify(messagesReply), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realEnvKey;
  });

  async function generate(config: CustomAnthropicModelConfig) {
    const model = (await buildModel(config)) as LanguageModelV3;
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    });
    expect(captured).toHaveLength(1);
    return { model, result, request: captured[0] };
  }

  it.each<AgentModelConfig>([
    'openai/gpt-4o-mini',
    'anthropic/claude-sonnet-4-5',
    { id: 'lenai/dep', apiKey: 'k', url: 'https://gw.example/v1' },
    { id: 'custom/llama3', apiKey: '', url: 'http://127.0.0.1:8317/v1' },
  ])('passes router config %j through untouched', async (config) => {
    await expect(buildModel(config)).resolves.toBe(config);
  });

  it('builds a Copilot config into the Copilot model, passing the model name', async () => {
    const built = { modelId: 'gpt-5' };
    mockCreateCopilotModel.mockReturnValue(built);
    await expect(
      buildModel({ kind: 'copilot', id: 'copilot/gpt-5' }),
    ).resolves.toBe(built);
    expect(mockCreateCopilotModel).toHaveBeenCalledWith({ model: 'gpt-5' });
    await buildModel({ kind: 'copilot', id: 'copilot/auto' });
    expect(mockCreateCopilotModel).toHaveBeenLastCalledWith({ model: 'auto' });
  });

  it('builds a keyed Anthropic-style model aimed at <root>/v1/messages', async () => {
    const { model, result, request } = await generate({
      kind: 'custom-anthropic',
      id: 'anthropic/claude-test',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: 'sk-custom',
    });

    expect(model.modelId).toBe('claude-test');
    expect(request.url).toBe('http://127.0.0.1:8317/v1/messages');
    expect(request.body.model).toBe('claude-test');
    expect(request.headers['x-api-key']).toBe('sk-custom');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.headers.authorization).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
  });

  it('sends no credential header at all for a keyless endpoint', async () => {
    const { request } = await generate({
      kind: 'custom-anthropic',
      id: 'anthropic/qwen3:8b',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(request.url).toBe('http://localhost:11434/v1/messages');
    expect(request.body.model).toBe('qwen3:8b');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.headers).not.toHaveProperty('x-api-key');
    expect(request.headers).not.toHaveProperty('authorization');
  });

  it('treats a blank key as keyless', async () => {
    const { request } = await generate({
      kind: 'custom-anthropic',
      id: 'anthropic/m',
      baseUrl: 'http://localhost:8317/v1',
      apiKey: '   ',
    });

    expect(request.headers).not.toHaveProperty('x-api-key');
  });

  it('never sends the ANTHROPIC_API_KEY env key to a keyless custom endpoint', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-public';

    const { request } = await generate({
      kind: 'custom-anthropic',
      id: 'anthropic/m',
      baseUrl: 'http://localhost:8317/v1',
    });

    expect(request.headers).not.toHaveProperty('x-api-key');
    expect(JSON.stringify(request.headers)).not.toContain('sk-ant-public');
  });

  it('uses the typed key over the ANTHROPIC_API_KEY env key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-public';

    const { request } = await generate({
      kind: 'custom-anthropic',
      id: 'anthropic/m',
      baseUrl: 'http://localhost:8317/v1',
      apiKey: 'sk-custom',
    });

    expect(request.headers['x-api-key']).toBe('sk-custom');
  });

  it('calls the process-wide fetch at request time, not one captured at build', async () => {
    const model = (await buildModel({
      kind: 'custom-anthropic',
      id: 'anthropic/m',
      baseUrl: 'http://localhost:8317/v1',
    })) as LanguageModelV3;
    const later = globalThis.fetch;
    const swapped = jest.fn(later);
    globalThis.fetch = swapped as typeof fetch;

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    });

    expect(swapped).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['', 'baseUrl is required for custom'],
    ['localhost:8317/v1', 'baseUrl must be an http or https URL'],
  ])('rejects base URL %j', async (baseUrl, message) => {
    await expect(
      buildModel({ kind: 'custom-anthropic', id: 'anthropic/m', baseUrl }),
    ).rejects.toThrow(message);
  });
});
