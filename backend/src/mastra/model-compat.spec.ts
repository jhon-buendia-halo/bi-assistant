import type {
  CopilotModelConfig,
  CustomAnthropicModelConfig,
} from './model-resolver';
import {
  isOpenAiCompatible,
  modelCallTuning,
  modelIdOf,
  providerOptionsFor,
  providerOptionsKey,
  rejectsMaxTokens,
} from './model-compat';

describe('rejectsMaxTokens', () => {
  it.each([
    'lenai/mmc-tech-gpt-52-272k-2025-12-11',
    'lenai/mmc-tech-gpt-52-chat-128k-2025-12-11',
    'lenai/mmc-tech-gpt-5-mini-272k-2025-08-07',
    'lenai/mmc-tech-gpt-55-1m-2026-04-24',
    'openai/gpt-5',
    'openai/gpt-5.2',
    'openai/o3-mini',
  ])('flags %s', (id) => {
    expect(rejectsMaxTokens(id)).toBe(true);
  });

  it.each([
    'lenai/mmc-tech-gpt-41-nano-1m-2025-04-14',
    'lenai/mmc-tech-gpt-41-mini-1m-2025-04-14',
    'openai/gpt-4.1-mini',
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
  ])('leaves %s alone', (id) => {
    expect(rejectsMaxTokens(id)).toBe(false);
  });
});

describe('providerOptionsKey', () => {
  it('uses the provider segment, which is what the compatible client reads', () => {
    expect(providerOptionsKey('lenai/mmc-tech-gpt-41-mini-1m-2025-04-14')).toBe(
      'lenai',
    );
    expect(providerOptionsKey('openai/gpt-4.1-mini')).toBe('openai');
  });
});

describe('modelCallTuning', () => {
  const lenai = (model: string) => ({
    id: `lenai/${model}` as const,
    apiKey: 'k',
    url: 'https://lenai.example.com/openai/v1/deployments/' + model,
  });

  it('moves the cap to max_completion_tokens for gpt-5-class LenAI deployments', () => {
    expect(
      modelCallTuning(lenai('mmc-tech-gpt-52-272k-2025-12-11'), {
        maxOutputTokens: 7_000,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      modelSettings: {},
      providerOptions: {
        lenai: { reasoningEffort: 'low', max_completion_tokens: 7_000 },
      },
    });
  });

  it('keeps maxOutputTokens for gpt-4.1-class LenAI deployments', () => {
    expect(
      modelCallTuning(lenai('mmc-tech-gpt-41-mini-1m-2025-04-14'), {
        maxOutputTokens: 7_000,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      modelSettings: { maxOutputTokens: 7_000 },
      providerOptions: { lenai: { reasoningEffort: 'low' } },
    });
  });

  it('keeps maxOutputTokens for native OpenAI, which renames the key itself', () => {
    expect(
      modelCallTuning(
        { id: 'openai/gpt-5', apiKey: 'k' },
        {
          maxOutputTokens: 2_500,
          reasoningEffort: 'low',
        },
      ),
    ).toEqual({
      modelSettings: { maxOutputTokens: 2_500 },
      providerOptions: { openai: { reasoningEffort: 'low' } },
    });
  });

  it('handles the env string-router fallback', () => {
    expect(
      modelCallTuning('openai/gpt-4o-mini', { maxOutputTokens: 100 }),
    ).toEqual({ modelSettings: { maxOutputTokens: 100 }, providerOptions: {} });
  });
});

describe('providerOptionsFor', () => {
  it('files options under the LenAI bucket, where a hardcoded `openai` key is dropped', () => {
    expect(
      providerOptionsFor(
        {
          id: 'lenai/mmc-tech-gpt-41-mini-1m-2025-04-14',
          apiKey: 'k',
          url: 'https://lenai.example.com/openai/v1/deployments/x',
        },
        { reasoningEffort: 'high' },
      ),
    ).toEqual({ lenai: { reasoningEffort: 'high' } });
  });

  it('still uses the openai bucket for OpenAI models', () => {
    expect(
      providerOptionsFor(
        { id: 'openai/gpt-4.1-mini', apiKey: 'k' },
        {
          reasoningEffort: 'high',
        },
      ),
    ).toEqual({ openai: { reasoningEffort: 'high' } });
  });
});

describe('providerOptionsFor on Anthropic', () => {
  it('translates reasoningEffort to the effort key the provider reads', () => {
    expect(
      providerOptionsFor(
        { id: 'anthropic/claude-sonnet-5-5', apiKey: 'k' },
        {
          reasoningEffort: 'medium',
        },
      ),
    ).toEqual({ anthropic: { effort: 'medium' } });
  });

  it('drops effort for models that reject it and OpenAI-only passthroughs', () => {
    expect(
      providerOptionsFor(
        { id: 'anthropic/claude-haiku-4-5', apiKey: 'k' },
        {
          reasoningEffort: 'low',
          max_completion_tokens: 512,
        },
      ),
    ).toEqual({ anthropic: {} });
  });

  it('keeps maxOutputTokens in modelSettings, which the native provider maps itself', () => {
    expect(
      modelCallTuning(
        { id: 'anthropic/claude-opus-5-5', apiKey: 'k' },
        {
          maxOutputTokens: 4096,
          reasoningEffort: 'high',
        },
      ),
    ).toEqual({
      modelSettings: { maxOutputTokens: 4096 },
      providerOptions: { anthropic: { effort: 'high' } },
    });
  });
});

describe('reasoning effort per model', () => {
  it('moves the effort to the nearest level the model accepts', () => {
    expect(
      providerOptionsFor(
        { id: 'openai/gpt-5-pro', apiKey: 'k' },
        { reasoningEffort: 'low' },
      ),
    ).toEqual({ openai: { reasoningEffort: 'high' } });
    expect(
      providerOptionsFor(
        { id: 'openai/gpt-5.1', apiKey: 'k' },
        { reasoningEffort: 'minimal' },
      ),
    ).toEqual({ openai: { reasoningEffort: 'low' } });
  });

  it('keeps effort on Claude Haiku 5.5, which accepts it', () => {
    expect(
      providerOptionsFor(
        { id: 'anthropic/claude-haiku-5-5', apiKey: 'k' },
        { reasoningEffort: 'xhigh' },
      ),
    ).toEqual({ anthropic: { effort: 'xhigh' } });
  });
});

describe('custom endpoint, OpenAI style (R52)', () => {
  const custom = (model: string, apiKey = 'k') => ({
    id: `custom/${model}` as const,
    apiKey,
    url: 'http://127.0.0.1:8317/v1',
  });

  it('is OpenAI-compatible and reads the `custom` bucket', () => {
    expect(isOpenAiCompatible(custom('gpt-5.2'))).toBe(true);
    expect(modelIdOf(custom('gpt-5.2'))).toBe('custom/gpt-5.2');
    expect(providerOptionsKey('custom/gpt-5.2')).toBe('custom');
  });

  it('sends the effort, mapped to the nearest level, when the model has levels', () => {
    expect(
      providerOptionsFor(custom('gpt-5.1'), { reasoningEffort: 'minimal' }),
    ).toEqual({ custom: { reasoningEffort: 'low' } });
    expect(
      providerOptionsFor(custom('claude-opus-4-6'), {
        reasoningEffort: 'xhigh',
      }),
    ).toEqual({ custom: { reasoningEffort: 'max' } });
  });

  it('gives an unknown model name the fallback levels', () => {
    expect(
      providerOptionsFor(custom('llama-3.1-70b'), { reasoningEffort: 'high' }),
    ).toEqual({ custom: { reasoningEffort: 'high' } });
  });

  it('drops the effort when the model has no levels, unlike LenAI', () => {
    expect(
      providerOptionsFor(custom('gpt-4o-mini'), { reasoningEffort: 'low' }),
    ).toEqual({ custom: {} });
    expect(
      providerOptionsFor(
        {
          id: 'lenai/mmc-tech-gpt-41-mini-1m-2025-04-14',
          apiKey: 'k',
          url: 'https://lenai.example.com/openai/v1/deployments/x',
        },
        { reasoningEffort: 'low' },
      ),
    ).toEqual({ lenai: { reasoningEffort: 'low' } });
  });

  it('moves the cap to max_completion_tokens for gpt-5-class models', () => {
    expect(
      modelCallTuning(custom('gpt-5-mini'), {
        maxOutputTokens: 3_000,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      modelSettings: {},
      providerOptions: {
        custom: { reasoningEffort: 'low', max_completion_tokens: 3_000 },
      },
    });
  });

  it('keeps maxOutputTokens and sends no effort for a model without levels', () => {
    expect(
      modelCallTuning(custom('gpt-4.1-mini', ''), {
        maxOutputTokens: 3_000,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      modelSettings: { maxOutputTokens: 3_000 },
      providerOptions: { custom: {} },
    });
  });
});

describe('custom endpoint, Anthropic style (R52)', () => {
  const customAnthropic = (model: string): CustomAnthropicModelConfig => ({
    kind: 'custom-anthropic',
    id: `anthropic/${model}`,
    baseUrl: 'http://127.0.0.1:8317/v1',
    apiKey: 'k',
  });

  it('returns its id and is not OpenAI-compatible', () => {
    expect(modelIdOf(customAnthropic('claude-opus-5-5'))).toBe(
      'anthropic/claude-opus-5-5',
    );
    expect(isOpenAiCompatible(customAnthropic('claude-opus-5-5'))).toBe(false);
  });

  it('files the effort under `anthropic` as `effort`', () => {
    expect(
      modelCallTuning(customAnthropic('claude-sonnet-4-6'), {
        maxOutputTokens: 4096,
        reasoningEffort: 'xhigh',
      }),
    ).toEqual({
      modelSettings: { maxOutputTokens: 4096 },
      providerOptions: { anthropic: { effort: 'max' } },
    });
  });

  it('drops the effort for the models R29 lists, and keeps the cap as maxOutputTokens', () => {
    expect(
      modelCallTuning(customAnthropic('claude-haiku-4-5'), {
        maxOutputTokens: 512,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      modelSettings: { maxOutputTokens: 512 },
      providerOptions: { anthropic: {} },
    });
  });

  it.each([
    ['gpt-5.2', 'none', 'low'],
    ['gpt-5-mini', 'minimal', 'low'],
    ['gpt-5.2', 'xhigh', 'xhigh'],
  ])(
    'maps %s effort %s to %s, a value the Anthropic schema accepts',
    (model, effort, sent) => {
      expect(
        providerOptionsFor(customAnthropic(model), { reasoningEffort: effort }),
      ).toEqual({ anthropic: { effort: sent } });
    },
  );

  it('never moves the cap for a gpt-5-named model served Anthropic-style', () => {
    expect(
      modelCallTuning(customAnthropic('gpt-5.2'), { maxOutputTokens: 100 }),
    ).toEqual({ modelSettings: { maxOutputTokens: 100 }, providerOptions: {} });
  });
});

describe('GitHub Copilot (R60)', () => {
  const copilot = (model: string): CopilotModelConfig => ({
    kind: 'copilot',
    id: `copilot/${model}`,
  });

  it('is not OpenAI-compatible and files under the copilot bucket', () => {
    expect(isOpenAiCompatible(copilot('gpt-5'))).toBe(false);
    expect(modelIdOf(copilot('gpt-5'))).toBe('copilot/gpt-5');
  });

  it('fits the effort to the model Copilot levels', () => {
    expect(
      providerOptionsFor(copilot('claude-sonnet-5'), {
        reasoningEffort: 'minimal',
      }),
    ).toEqual({ copilot: { reasoningEffort: 'low' } });
    expect(
      providerOptionsFor(copilot('gpt-5.2'), { reasoningEffort: 'none' }),
    ).toEqual({ copilot: { reasoningEffort: 'low' } });
  });

  it('drops the effort for auto', () => {
    expect(
      providerOptionsFor(copilot('auto'), { reasoningEffort: 'high' }),
    ).toEqual({});
  });

  it('sends no output-token cap', () => {
    expect(
      modelCallTuning(copilot('claude-sonnet-5'), {
        maxOutputTokens: 4000,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      modelSettings: {},
      providerOptions: { copilot: { reasoningEffort: 'high' } },
    });
    expect(modelCallTuning(copilot('auto'), { maxOutputTokens: 4000 })).toEqual(
      { modelSettings: {}, providerOptions: {} },
    );
  });
});
