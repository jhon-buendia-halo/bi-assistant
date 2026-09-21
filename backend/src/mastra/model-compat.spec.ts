import {
  modelCallTuning,
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
      modelCallTuning({ id: 'openai/gpt-5', apiKey: 'k' }, {
        maxOutputTokens: 2_500,
        reasoningEffort: 'low',
      }),
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
      providerOptionsFor({ id: 'openai/gpt-4.1-mini', apiKey: 'k' }, {
        reasoningEffort: 'high',
      }),
    ).toEqual({ openai: { reasoningEffort: 'high' } });
  });
});
