import { BadRequestException } from '@nestjs/common';
import { MemoryController } from './memory.controller';
import type { MemoryService } from './memory.service';

const view = {
  enabled: true,
  embeddingModel: 'text-embedding-3-small' as const,
  embeddingKey: 'environment' as const,
};

function build() {
  const memory = {
    view: jest.fn().mockResolvedValue(view),
    setEnabled: jest.fn().mockResolvedValue(view),
    forgetSignal: jest.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new MemoryController(memory as unknown as MemoryService),
    memory,
  };
}

describe('MemoryController (api.md 108 to 110)', () => {
  it('reads the settings', async () => {
    const { controller } = build();
    await expect(controller.settings()).resolves.toEqual(view);
  });

  it('saves the lever with a Style A envelope around the view', async () => {
    const { controller, memory } = build();

    await expect(controller.saveSettings({ enabled: true })).resolves.toEqual({
      ok: true,
      message: 'Memory turned on',
      ...view,
    });
    memory.setEnabled.mockResolvedValueOnce({ ...view, enabled: false });
    await expect(controller.saveSettings({ enabled: false })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        message: 'Memory turned off',
        enabled: false,
      }),
    );
  });

  it('reports a refused value as a Style A failure', async () => {
    const { controller, memory } = build();
    memory.setEnabled.mockRejectedValueOnce(
      new BadRequestException('enabled must be true or false'),
    );

    await expect(controller.saveSettings({ enabled: 'yes' })).resolves.toEqual({
      ok: false,
      message: 'enabled must be true or false',
    });
  });

  it('forgets a signal by its decoded document id', async () => {
    const { controller, memory } = build();

    await expect(
      controller.forget('rating:s1:2026-10-05T10:00:03.000Z'),
    ).resolves.toBeUndefined();
    expect(memory.forgetSignal).toHaveBeenCalledWith(
      'rating:s1:2026-10-05T10:00:03.000Z',
    );
  });
});
