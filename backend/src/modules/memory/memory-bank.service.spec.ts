import { Logger } from '@nestjs/common';
import { HindsightError } from '@vectorize-io/hindsight-client';
import {
  BANK_DIRECTIVES,
  BANK_MENTAL_MODELS,
  MemoryBankService,
  OBSERVATIONS_MISSION,
  REFLECT_MISSION,
  RETAIN_MISSION,
} from './memory-bank.service';

function clientDouble() {
  return {
    getBankConfig: jest
      .fn()
      .mockRejectedValue(new HindsightError('getBankConfig failed', 404)),
    createBank: jest.fn().mockResolvedValue({}),
    listDirectives: jest.fn().mockResolvedValue({ items: [] }),
    createDirective: jest.fn().mockResolvedValue({}),
    listMentalModels: jest.fn().mockResolvedValue({ items: [] }),
    createMentalModel: jest.fn().mockResolvedValue({ operation_id: 'op' }),
  };
}

describe('MemoryBankService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a missing bank with its missions, directives and mental models', async () => {
    const client = clientDouble();
    const service = new MemoryBankService(client as never);

    await service.ensureBank('ds-1');

    expect(client.getBankConfig).toHaveBeenCalledWith('halo-ds-ds-1');
    expect(client.createBank).toHaveBeenCalledWith('halo-ds-ds-1', {
      name: 'Halo BI · ds-1',
      retainMission: RETAIN_MISSION,
      observationsMission: OBSERVATIONS_MISSION,
      reflectMission: REFLECT_MISSION,
      retainExtractionMode: 'concise',
      enableObservations: true,
    });
    expect(client.createDirective.mock.calls).toEqual(
      BANK_DIRECTIVES.map((d) => ['halo-ds-ds-1', d.name, d.content]),
    );
    expect(BANK_DIRECTIVES.map((d) => d.name)).toEqual([
      'curated-wins',
      'no-values',
    ]);
    expect(client.createMentalModel).toHaveBeenCalledTimes(3);
    expect(client.createMentalModel).toHaveBeenCalledWith(
      'halo-ds-ds-1',
      'Errores conocidos',
      expect.any(String),
      {
        id: 'known-pitfalls',
        maxTokens: 800,
        trigger: {
          refreshAfterConsolidation: true,
          mode: 'full',
          budget: 'mid',
        },
      },
    );
    expect(BANK_MENTAL_MODELS.map((m) => [m.id, m.name])).toEqual([
      ['known-pitfalls', 'Errores conocidos'],
      ['table-guide', 'Guía de tablas'],
      ['learned-glossary', 'Glosario aprendido'],
    ]);
  });

  it('does nothing on a second call in the same process', async () => {
    const client = clientDouble();
    const service = new MemoryBankService(client as never);

    await service.ensureBank('ds-1');
    await service.ensureBank('ds-1');

    expect(client.getBankConfig).toHaveBeenCalledTimes(1);
    expect(client.createBank).toHaveBeenCalledTimes(1);
  });

  it('creates only what is missing on an existing bank', async () => {
    const client = clientDouble();
    client.getBankConfig.mockResolvedValue({
      bank_id: 'halo-ds-ds-1',
      config: { retain_mission: RETAIN_MISSION },
      overrides: {},
    });
    client.listDirectives.mockResolvedValue({
      items: [{ id: 'd1', name: 'curated-wins', content: '…' }],
    });
    client.listMentalModels.mockResolvedValue({
      items: [{ id: 'known-pitfalls', name: 'Errores conocidos' }],
    });
    const service = new MemoryBankService(client as never);

    await service.ensureBank('ds-1');

    expect(client.createBank).not.toHaveBeenCalled();
    expect(client.createDirective).toHaveBeenCalledTimes(1);
    expect(client.createDirective).toHaveBeenCalledWith(
      'halo-ds-ds-1',
      'no-values',
      expect.any(String),
    );
    const created = (
      client.createMentalModel.mock.calls as [
        string,
        string,
        string,
        { id: string },
      ][]
    ).map((call) => call[3].id);
    expect(created).toEqual(['table-guide', 'learned-glossary']);
  });

  it('sets the missions on a bank that exists without them', async () => {
    const client = clientDouble();
    // A recall that reached the server first created it with its defaults.
    client.getBankConfig.mockResolvedValue({
      bank_id: 'halo-ds-ds-1',
      config: { retain_mission: null },
      overrides: {},
    });
    const service = new MemoryBankService(client as never);

    await service.ensureBank('ds-1');

    expect(client.createBank).toHaveBeenCalledTimes(1);
  });

  it('logs a failure instead of throwing, and does not cache it', async () => {
    const client = clientDouble();
    client.getBankConfig.mockRejectedValue(new Error('connection refused'));
    const service = new MemoryBankService(client as never);

    await expect(service.ensureBank('ds-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(client.createBank).not.toHaveBeenCalled();

    // Retried once the back-off passes.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    client.getBankConfig.mockRejectedValue(new HindsightError('nf', 404));
    await service.ensureBank('ds-1');
    expect(client.createBank).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a configured server', async () => {
    const service = new MemoryBankService(null);
    await expect(service.ensureBank('ds-1')).resolves.toBeUndefined();
  });
});
