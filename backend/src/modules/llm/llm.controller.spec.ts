jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));

import { LlmController } from './llm.controller';
import type { LlmService } from './llm.service';

function controllerWith(service: Partial<LlmService>) {
  return new LlmController(service as LlmService);
}

describe('LlmController (custom endpoint, BA-281)', () => {
  it('reports a custom pass with the custom/<model> route', async () => {
    const controller = controllerWith({
      testConnection: jest.fn().mockResolvedValue({
        provider: 'custom',
        model: 'llama3',
        reply: 'ok',
        latencyMs: 12,
      }),
    });

    await expect(
      controller.testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'llama3',
      }),
    ).resolves.toEqual({
      ok: true,
      message: 'Connection successful — custom/llama3 replied "ok" in 12ms',
    });
  });

  it('reports a custom probe failure in the body', async () => {
    const controller = controllerWith({
      testConnection: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Could not reach 127.0.0.1:8317 — check the base URL and that the server is running',
          ),
        ),
    });

    await expect(
      controller.testConnection({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'llama3',
      }),
    ).resolves.toEqual({
      ok: false,
      message:
        'Could not reach 127.0.0.1:8317 — check the base URL and that the server is running',
    });
  });

  it('passes POST /llm/models through to the service', async () => {
    const listModels = jest
      .fn()
      .mockResolvedValue({ ok: true, models: ['llama3'] });
    const controller = controllerWith({ listModels });
    const dto = {
      provider: 'custom' as const,
      apiStyle: 'openai' as const,
      baseUrl: 'http://127.0.0.1:8317/v1',
    };

    await expect(controller.listModels(dto)).resolves.toEqual({
      ok: true,
      models: ['llama3'],
    });
    expect(listModels).toHaveBeenCalledWith(dto);
  });
});
