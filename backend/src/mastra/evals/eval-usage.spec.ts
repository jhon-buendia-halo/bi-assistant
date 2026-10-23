import pricingFile from './pricing.json';
import {
  PRICE_TABLE,
  USAGE_AGENTS,
  costOf,
  mergeUsage,
  modelIdOf,
  normalizeModelId,
  parsePriceTable,
  rateFor,
  ratesUsed,
  recordUsage,
  sumUsage,
  usageFromResult,
} from './eval-usage';
import type { ModelUsageEntry, PriceTable } from './eval-usage';

const RATES: PriceTable = {
  'gpt-4o-mini': {
    inputPerMillionUsd: 0.15,
    cachedInputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.6,
  },
  'no-cache-rate': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
};

function entry(
  agent: ModelUsageEntry['agent'],
  model: string,
  usage: Partial<ModelUsageEntry> = {},
): ModelUsageEntry {
  return {
    agent,
    model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    calls: 1,
    unreportedCalls: 0,
    ...usage,
  };
}

describe('usageFromResult (agents-evals R219)', () => {
  it('prefers totalUsage, which spans every step of a generate', () => {
    expect(
      usageFromResult({
        totalUsage: {
          inputTokens: 1200,
          outputTokens: 300,
          totalTokens: 1500,
          cachedInputTokens: 1024,
          reasoningTokens: 0,
        },
        usage: { inputTokens: 400, outputTokens: 100 },
      }),
    ).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 1024,
      outputTokens: 300,
      reasoningTokens: 0,
      calls: 1,
      unreportedCalls: 0,
    });
  });

  it('falls back to usage, then to response.usage', () => {
    expect(
      usageFromResult({ usage: { inputTokens: 50, outputTokens: 7 } }),
    ).toMatchObject({ inputTokens: 50, outputTokens: 7, calls: 1 });
    expect(
      usageFromResult({
        totalUsage: { inputTokens: undefined, outputTokens: undefined },
        response: { usage: { inputTokens: 9, outputTokens: 2 } },
      }),
    ).toMatchObject({ inputTokens: 9, outputTokens: 2 });
  });

  it('reads the AI SDK v6 detail objects and the provider { total } shape', () => {
    expect(
      usageFromResult({
        usage: {
          inputTokens: 900,
          inputTokenDetails: {
            noCacheTokens: 400,
            cacheReadTokens: 500,
            cacheWriteTokens: 0,
          },
          outputTokens: 120,
          outputTokenDetails: { textTokens: 80, reasoningTokens: 40 },
          totalTokens: 1020,
        },
      }),
    ).toMatchObject({
      inputTokens: 900,
      cachedInputTokens: 500,
      outputTokens: 120,
      reasoningTokens: 40,
    });
    expect(
      usageFromResult({
        usage: {
          inputTokens: { total: 70, noCache: 30, cacheRead: 40 },
          outputTokens: { total: 11, text: 5, reasoning: 6 },
        },
      }),
    ).toMatchObject({
      inputTokens: 70,
      cachedInputTokens: 40,
      outputTokens: 11,
      reasoningTokens: 6,
    });
  });

  it('reads the AI SDK v4 names and OpenAI raw usage', () => {
    expect(
      usageFromResult({ usage: { promptTokens: 30, completionTokens: 4 } }),
    ).toMatchObject({ inputTokens: 30, outputTokens: 4 });
    expect(
      usageFromResult({
        response: {
          usage: {
            prompt_tokens: 2000,
            completion_tokens: 50,
            prompt_tokens_details: { cached_tokens: 1536 },
            completion_tokens_details: { reasoning_tokens: 10 },
          },
        },
      }),
    ).toMatchObject({
      inputTokens: 2000,
      cachedInputTokens: 1536,
      outputTokens: 50,
      reasoningTokens: 10,
    });
  });

  it('is undefined when the result reports no input or output number', () => {
    expect(usageFromResult(undefined)).toBeUndefined();
    expect(usageFromResult('text')).toBeUndefined();
    expect(usageFromResult({ text: 'an answer' })).toBeUndefined();
    // Mastra fills totalTokens with 0 when the provider sent nothing.
    expect(
      usageFromResult({
        totalUsage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: 0,
        },
      }),
    ).toBeUndefined();
    expect(usageFromResult({ usage: Promise.resolve({}) })).toBeUndefined();
  });

  it('keeps the subsets inside their totals', () => {
    expect(
      usageFromResult({
        usage: {
          inputTokens: 10,
          cachedInputTokens: 25,
          outputTokens: 3,
          reasoningTokens: 9,
        },
      }),
    ).toMatchObject({ cachedInputTokens: 10, reasoningTokens: 3 });
  });
});

describe('recordUsage', () => {
  it('adds a call under its agent and normalised model', () => {
    const entries: ModelUsageEntry[] = [];
    recordUsage(entries, 'assistant', 'openai/gpt-4o-mini', {
      totalUsage: { inputTokens: 100, outputTokens: 10 },
    });
    recordUsage(entries, 'assistant', 'gpt-4o-mini', {
      totalUsage: { inputTokens: 50, outputTokens: 5, cachedInputTokens: 20 },
    });
    expect(entries).toEqual([
      entry('assistant', 'gpt-4o-mini', {
        inputTokens: 150,
        cachedInputTokens: 20,
        outputTokens: 15,
        calls: 2,
      }),
    ]);
  });

  it('counts a call without usage as unreported, not as zero tokens', () => {
    const entries: ModelUsageEntry[] = [];
    recordUsage(entries, 'sql-fixer', 'gpt-4o-mini', { text: 'SELECT 1' });
    expect(entries).toEqual([
      entry('sql-fixer', 'gpt-4o-mini', { calls: 0, unreportedCalls: 1 }),
    ]);
  });

  it('keeps the agents in report order and names a blank model unknown', () => {
    const entries: ModelUsageEntry[] = [];
    const used = { usage: { inputTokens: 1, outputTokens: 1 } };
    recordUsage(entries, 'judge', 'gpt-4o-mini', used);
    recordUsage(entries, 'designer', 'openai/gpt-4.1-mini', used);
    recordUsage(entries, 'assistant', undefined, used);
    recordUsage(entries, 'sql-fixer', '  ', used);
    expect(entries.map((e) => [e.agent, e.model])).toEqual([
      ['assistant', 'unknown'],
      ['sql-fixer', 'unknown'],
      ['designer', 'gpt-4.1-mini'],
      ['judge', 'gpt-4o-mini'],
    ]);
    expect(USAGE_AGENTS).toEqual([
      'assistant',
      'sql-fixer',
      'designer',
      'judge',
    ]);
  });
});

describe('mergeUsage and sumUsage', () => {
  it('sums by agent and model into a new list', () => {
    const a = [
      entry('assistant', 'gpt-4o-mini', { inputTokens: 10, outputTokens: 1 }),
      entry('judge', 'gpt-4o-mini', { inputTokens: 5, outputTokens: 1 }),
    ];
    const b = [
      entry('sql-fixer', 'gpt-4o-mini', { inputTokens: 3, outputTokens: 2 }),
      entry('assistant', 'gpt-4o-mini', {
        inputTokens: 20,
        outputTokens: 2,
        calls: 0,
        unreportedCalls: 1,
      }),
    ];
    const merged = mergeUsage(a, b);
    expect(merged).toEqual([
      entry('assistant', 'gpt-4o-mini', {
        inputTokens: 30,
        outputTokens: 3,
        calls: 1,
        unreportedCalls: 1,
      }),
      entry('sql-fixer', 'gpt-4o-mini', { inputTokens: 3, outputTokens: 2 }),
      entry('judge', 'gpt-4o-mini', { inputTokens: 5, outputTokens: 1 }),
    ]);
    expect(a[0].inputTokens).toBe(10);
    expect(sumUsage(merged)).toEqual({
      inputTokens: 38,
      cachedInputTokens: 0,
      outputTokens: 6,
      reasoningTokens: 0,
      calls: 3,
      unreportedCalls: 1,
    });
  });

  it('treats a missing list as empty', () => {
    const a = [entry('assistant', 'gpt-4o-mini', { inputTokens: 4 })];
    expect(mergeUsage(undefined, a)).toEqual(a);
    expect(mergeUsage(a, undefined)).toEqual(a);
    expect(mergeUsage(undefined, undefined)).toEqual([]);
  });
});

describe('normalizeModelId, rateFor and modelIdOf', () => {
  it('drops the provider prefix and case', () => {
    expect(normalizeModelId('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(normalizeModelId(' Azure/GPT-4o-mini ')).toBe('gpt-4o-mini');
    expect(normalizeModelId('gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('finds a rate by normalised id, and a dated snapshot by its model', () => {
    expect(rateFor('openai/gpt-4o-mini', RATES)).toBe(RATES['gpt-4o-mini']);
    expect(rateFor('gpt-4o-mini-2024-07-18', RATES)).toBe(RATES['gpt-4o-mini']);
    expect(rateFor('lenai/mmc-tech-gpt-5-mini-272k', RATES)).toBeUndefined();
  });

  it('reads the router id of a model config', () => {
    expect(modelIdOf('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(
      modelIdOf({ id: 'lenai/gpt-4o-mini', apiKey: 'k', url: 'https://x' }),
    ).toBe('lenai/gpt-4o-mini');
  });
});

describe('costOf (agents-evals R221)', () => {
  it('bills cached input at the cached rate and does not add reasoning', () => {
    // 1,000,000 input of which 400,000 cached, 100,000 output (20,000 of
    // them reasoning): 0.6 × 0.15 + 0.4 × 0.075 + 0.1 × 0.6 = 0.18.
    expect(
      costOf(
        [
          entry('assistant', 'gpt-4o-mini', {
            inputTokens: 1_000_000,
            cachedInputTokens: 400_000,
            outputTokens: 100_000,
            reasoningTokens: 20_000,
          }),
        ],
        RATES,
      ),
    ).toEqual({ usd: 0.18 });
  });

  it('bills cached input at the input rate when the model has no cached rate', () => {
    expect(
      costOf(
        [
          entry('assistant', 'no-cache-rate', {
            inputTokens: 1_000_000,
            cachedInputTokens: 500_000,
            outputTokens: 1_000_000,
          }),
        ],
        RATES,
      ),
    ).toEqual({ usd: 3 });
  });

  it('adds every agent and rounds to six decimals', () => {
    expect(
      costOf(
        [
          entry('assistant', 'gpt-4o-mini', {
            inputTokens: 30_000,
            outputTokens: 1_000,
          }),
          entry('sql-fixer', 'gpt-4o-mini', {
            inputTokens: 1_234,
            outputTokens: 56,
          }),
        ],
        RATES,
      ),
    ).toEqual({ usd: 0.005319 });
  });

  it('is not priced when any model that ran has no rate', () => {
    expect(
      costOf(
        [
          entry('assistant', 'gpt-4o-mini', { inputTokens: 10 }),
          entry('designer', 'gpt-4.1-mini', { inputTokens: 10 }),
          entry('judge', 'gpt-4.1-mini', { calls: 0, unreportedCalls: 1 }),
          entry('sql-fixer', 'unknown', { inputTokens: 1 }),
        ],
        RATES,
      ),
    ).toEqual({ notPriced: ['gpt-4.1-mini', 'unknown'] });
  });

  it('costs nothing with no call', () => {
    expect(costOf([], RATES)).toEqual({ usd: 0 });
  });

  it('snapshots the rates of the models that ran', () => {
    expect(
      ratesUsed(
        [entry('assistant', 'gpt-4o-mini'), entry('designer', 'gpt-4.1-mini')],
        RATES,
      ),
    ).toEqual({ 'gpt-4o-mini': RATES['gpt-4o-mini'] });
  });
});

describe('the bundled price table (data-model 4.11)', () => {
  it('prices gpt-4o-mini, gpt-5.6-luna, gpt-6-luna and gpt-4.1-mini, with where and when each rate was read', () => {
    expect(PRICE_TABLE['gpt-4o-mini']).toEqual({
      inputPerMillionUsd: 0.15,
      cachedInputPerMillionUsd: 0.075,
      outputPerMillionUsd: 0.6,
      source: 'developers.openai.com/api/docs/pricing',
      readOn: '2026-10-20',
    });
    expect(PRICE_TABLE['gpt-5.6-luna']).toEqual({
      inputPerMillionUsd: 0.2,
      cachedInputPerMillionUsd: 0.02,
      outputPerMillionUsd: 1.2,
      source:
        'developers.openai.com/api/docs/pricing (Standard, short context)',
      readOn: '2026-10-21',
    });
    expect(PRICE_TABLE['gpt-6-luna']).toEqual({
      inputPerMillionUsd: 0.1,
      cachedInputPerMillionUsd: 0.01,
      outputPerMillionUsd: 0.5,
      source:
        'developers.openai.com/api/docs/pricing (Standard, short context)',
      readOn: '2026-10-23',
    });
    expect(PRICE_TABLE['gpt-4.1-mini']).toEqual({
      inputPerMillionUsd: 0.4,
      cachedInputPerMillionUsd: 0.1,
      outputPerMillionUsd: 1.6,
      source: 'developers.openai.com/api/docs/pricing (Standard)',
      readOn: '2026-10-21',
    });
    for (const rate of Object.values(PRICE_TABLE)) {
      expect(rate.source).toEqual(expect.any(String));
      expect(rate.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(Object.keys(parsePriceTable(pricingFile))).toEqual(
      Object.keys(PRICE_TABLE),
    );
  });

  it('refuses a malformed price file, naming the model at fault', () => {
    expect(() => parsePriceTable([])).toThrow(
      'Price file pricing.json: must be an object with a "models" object',
    );
    expect(() =>
      parsePriceTable({
        models: { 'gpt-4o-mini': { inputPerMillionUsd: 0.15 } },
      }),
    ).toThrow(
      'Price file pricing.json, model "gpt-4o-mini": "outputPerMillionUsd" must be a number of dollars, 0 or more',
    );
    expect(() =>
      parsePriceTable({
        models: {
          'openai/gpt-4o-mini': {
            inputPerMillionUsd: 1,
            outputPerMillionUsd: 1,
          },
        },
      }),
    ).toThrow('the key must be a lower-case model id with no provider prefix');
    expect(() =>
      parsePriceTable({
        models: {
          'gpt-4o-mini': {
            inputPerMillion: 1,
            inputPerMillionUsd: 1,
            outputPerMillionUsd: 1,
          },
        },
      }),
    ).toThrow('unknown field(s) "inputPerMillion"');
  });
});
