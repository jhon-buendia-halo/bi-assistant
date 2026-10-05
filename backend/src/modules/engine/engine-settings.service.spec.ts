import { EngineSettingsService } from './engine-settings.service';
import { EngineSettingsRepository } from './repositories/engine-settings.repository';
import { ENGINE_DEFAULTS, type EngineSettingsDoc } from './engine-options';
import { ASSISTANT_RULE_GROUPS } from '../../mastra/agents/assistant-instructions';

function serviceWith(doc: EngineSettingsDoc | null = null) {
  let stored = doc;
  const repository = {
    get: jest.fn().mockImplementation(() => Promise.resolve(stored)),
    save: jest.fn().mockImplementation((patch: Omit<EngineSettingsDoc, 'key'>) => {
      stored = { key: 'engine', ...stored, ...patch };
      return Promise.resolve(stored);
    }),
  } as unknown as EngineSettingsRepository;
  return { service: new EngineSettingsService(repository), repository };
}

describe('EngineSettingsService.view', () => {
  it('resolves to ENGINE_DEFAULTS with no doc stored', async () => {
    const { service } = serviceWith(null);

    const view = await service.view();

    expect(view.defaults).toEqual(ENGINE_DEFAULTS);
    expect(view.stored).toEqual({});
    expect(view.productionDefaults).toEqual(ENGINE_DEFAULTS);
    expect(view.judgeModel).toBeNull();
    expect(view.databricksReasoningEffort).toBe(false);
    expect(Object.keys(view.arms)).toEqual(
      expect.arrayContaining(['baseline', 'legacy', 'full']),
    );
    // The view mirrors the prompt's rule groups as they are defined, without
    // their lines — the picker needs ids and titles, not the prompt text.
    expect(view.ruleGroups).toEqual(
      ASSISTANT_RULE_GROUPS.map(({ id, title, ablatable }) => ({
        id,
        title,
        ablatable,
      })),
    );
  });

  it('exposes EngineSettingsService.resolved/judgeModel/databricksReasoningEffort the same way', async () => {
    const { service } = serviceWith(null);

    expect(await service.resolved()).toEqual(ENGINE_DEFAULTS);
    expect(await service.judgeModel()).toBeUndefined();
    expect(await service.databricksReasoningEffort()).toBe(false);
  });
});

describe('EngineSettingsService.save', () => {
  it('round-trips only the levers that differ from ENGINE_DEFAULTS (diff-only storage)', async () => {
    const { service } = serviceWith(null);

    const view = await service.save({
      defaults: { sqlRepair: false, careful: 'auto' },
    });

    expect(view.stored).toEqual({ sqlRepair: false, careful: 'auto' });
    expect(view.defaults).toEqual({
      ...ENGINE_DEFAULTS,
      sqlRepair: false,
      careful: 'auto',
    });

    const resolved = await service.resolved();
    expect(resolved.sqlRepair).toBe(false);
    expect(resolved.careful).toBe('auto');
    // Every untouched lever still reads the (possibly later-changed)
    // production default rather than a frozen copy.
    expect(resolved.answerReview).toBe(ENGINE_DEFAULTS.answerReview);
  });

  it('setting a lever back to its default drops it from storage', async () => {
    const { service } = serviceWith(null);
    await service.save({ defaults: { sqlRepair: false } });

    const view = await service.save({ defaults: { sqlRepair: true } });

    expect(view.stored).toEqual({});
  });

  it('omitting defaults leaves the previously stored levers untouched', async () => {
    const { service } = serviceWith(null);
    await service.save({ defaults: { sqlRepair: false } });

    const view = await service.save({ judgeModel: 'openai/gpt-4.1-mini' });

    expect(view.stored).toEqual({ sqlRepair: false });
    expect(view.judgeModel).toBe('openai/gpt-4.1-mini');
  });

  it('accepts and clears a valid judgeModel', async () => {
    const { service } = serviceWith(null);
    await service.save({ judgeModel: 'openai/gpt-4.1-mini' });

    const cleared = await service.save({ judgeModel: '' });

    expect(cleared.judgeModel).toBeNull();
  });

  it('rejects an invalid judgeModel and stores nothing', async () => {
    const { service, repository } = serviceWith(null);

    await expect(
      service.save({ judgeModel: 'not-a-router-id' }),
    ).rejects.toThrow(/router id/);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('drops unknown and mistyped levers instead of persisting them', async () => {
    const { service } = serviceWith(null);

    const view = await service.save({
      defaults: { sqlRepair: 'yes', bogus: true, careful: 'auto' } as never,
    });

    expect(view.stored).toEqual({ careful: 'auto' });
  });

  it('saves databricksReasoningEffort independently of defaults', async () => {
    const { service } = serviceWith(null);

    const view = await service.save({ databricksReasoningEffort: true });

    expect(view.databricksReasoningEffort).toBe(true);
    expect(view.stored).toEqual({});
  });
});
