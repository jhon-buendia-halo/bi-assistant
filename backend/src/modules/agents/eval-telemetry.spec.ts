import {
  addUsage,
  clipLogText,
  emptyUsage,
  estimateCostUsd,
  extractUsage,
  extractUsageDeep,
  foldAttempts,
  isRunLogV2,
  isUsageUnobserved,
  LOG_ANSWER_MAX_CHARS,
  normalizeModelId,
  normalizeRunLog,
  representativeAttempt,
  summarizeCases,
  sumUsage,
  tallyCategories,
  wilson95,
  type EvalRunLogAttempt,
  type EvalRunLogCaseV2,
  type EvalRunLogRecordV1,
  type EvalVerdict,
  type PricingTable,
  type TokenUsage,
} from './eval-telemetry';
import { ENGINE_DEFAULTS } from '../engine/engine-options';

describe('extractUsage', () => {
  it('reads the current AI-SDK shape', () => {
    expect(
      extractUsage({ usage: { inputTokens: 1200, outputTokens: 300 } }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    });
  });

  it('reads the older promptTokens/completionTokens shape', () => {
    const usage = extractUsage({
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });
    expect(usage).toMatchObject({
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      calls: 1,
    });
  });

  it('prefers totalUsage over usage, because usage may cover only the last step', () => {
    const usage = extractUsage({
      usage: { inputTokens: 10, outputTokens: 5 },
      totalUsage: { inputTokens: 900, outputTokens: 120 },
    });
    expect(usage?.inputTokens).toBe(900);
    expect(usage?.outputTokens).toBe(120);
  });

  it('carries reasoning and cached-input counts when the provider reports them', () => {
    const usage = extractUsage({
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        reasoningTokens: 40,
        cachedInputTokens: 320,
      },
    });
    expect(usage).toMatchObject({
      reasoningTokens: 40,
      cachedInputTokens: 320,
    });
  });

  it('reads cached tokens out of promptTokensDetails', () => {
    const usage = extractUsage({
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        promptTokensDetails: { cachedTokens: 128 },
      },
    });
    expect(usage?.cachedInputTokens).toBe(128);
  });

  // The whole point of the undefined return: a run that reports nothing must be
  // distinguishable from a run that genuinely cost nothing, or a cost log
  // silently understates spend.
  it('returns undefined rather than a zeroed reading when nothing is reported', () => {
    expect(extractUsage(undefined)).toBeUndefined();
    expect(extractUsage({})).toBeUndefined();
    expect(extractUsage({ usage: {} })).toBeUndefined();
    expect(
      extractUsage({ usage: { inputTokens: 0, outputTokens: 0 } }),
    ).toBeUndefined();
  });

  it('ignores negative and non-finite counts', () => {
    expect(
      extractUsage({ usage: { inputTokens: -5, outputTokens: Number.NaN } }),
    ).toBeUndefined();
  });
});

describe('extractUsageDeep', () => {
  it('sums per-step usage when no roll-up is reported', () => {
    const usage = extractUsageDeep({
      steps: [
        { usage: { inputTokens: 100, outputTokens: 10 } },
        { usage: { inputTokens: 250, outputTokens: 30 } },
        { somethingElse: true },
      ],
    });
    expect(usage).toMatchObject({
      inputTokens: 350,
      outputTokens: 40,
      totalTokens: 390,
      calls: 2,
    });
  });

  it('prefers a top-level roll-up over walking the steps', () => {
    const usage = extractUsageDeep({
      totalUsage: { inputTokens: 999, outputTokens: 1 },
      steps: [{ usage: { inputTokens: 100, outputTokens: 10 } }],
    });
    expect(usage?.inputTokens).toBe(999);
    expect(usage?.calls).toBe(1);
  });

  it('returns undefined when neither is present', () => {
    expect(extractUsageDeep({ steps: [{}, {}] })).toBeUndefined();
  });
});

describe('addUsage / sumUsage', () => {
  const a: TokenUsage = {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    reasoningTokens: 1,
    cachedInputTokens: 4,
    calls: 1,
  };

  it('adds every field, including the call count', () => {
    expect(addUsage(a, a)).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      totalTokens: 24,
      reasoningTokens: 2,
      cachedInputTokens: 8,
      calls: 2,
    });
  });

  it('skips undefined entries without inflating the call count', () => {
    expect(sumUsage([a, undefined, a])).toMatchObject({
      calls: 2,
      inputTokens: 20,
    });
    expect(sumUsage([])).toEqual(emptyUsage());
  });
});

describe('isUsageUnobserved', () => {
  it('treats a zero-call reading as unobserved', () => {
    expect(isUsageUnobserved(undefined)).toBe(true);
    expect(isUsageUnobserved(emptyUsage())).toBe(true);
    expect(isUsageUnobserved({ ...emptyUsage(), calls: 1 })).toBe(false);
  });
});

describe('normalizeModelId', () => {
  it('strips the provider prefix and lowercases', () => {
    expect(normalizeModelId('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(normalizeModelId('GPT-4o-Mini')).toBe('gpt-4o-mini');
    expect(normalizeModelId('azure/deployments/gpt-4.1-mini')).toBe(
      'gpt-4.1-mini',
    );
  });
});

describe('estimateCostUsd', () => {
  const pricing: PricingTable = {
    'gpt-4o-mini': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
    'gpt-cached': {
      inputPerMillionUsd: 10,
      outputPerMillionUsd: 20,
      cachedInputPerMillionUsd: 1,
    },
  };
  const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
    ...emptyUsage(),
    calls: 1,
    ...over,
  });

  it('prices input and output separately', () => {
    // 2,000,000 input at $1/M + 500,000 output at $4/M = 2 + 2 = $4
    expect(
      estimateCostUsd(
        'openai/gpt-4o-mini',
        usage({ inputTokens: 2_000_000, outputTokens: 500_000 }),
        pricing,
      ),
    ).toBeCloseTo(4, 6);
  });

  it('bills cached input at the cached rate and treats it as a subset of input', () => {
    // 1M input of which 800k cached: 200k at $10/M + 800k at $1/M = 2 + 0.8
    expect(
      estimateCostUsd(
        'gpt-cached',
        usage({ inputTokens: 1_000_000, cachedInputTokens: 800_000 }),
        pricing,
      ),
    ).toBeCloseTo(2.8, 6);
  });

  it('never lets a bogus cached count exceed the input it came from', () => {
    expect(
      estimateCostUsd(
        'gpt-cached',
        usage({ inputTokens: 1000, cachedInputTokens: 999_999 }),
        pricing,
      ),
    ).toBeCloseTo((1000 * 1) / 1_000_000, 6);
  });

  it('keeps sub-cent runs from rounding to zero', () => {
    const cost = estimateCostUsd(
      'gpt-4o-mini',
      usage({ inputTokens: 1200, outputTokens: 300 }),
      pricing,
    );
    expect(cost).toBeGreaterThan(0);
  });

  // The honest-unknown rule: an unpriced model reports nothing rather than $0.
  it('returns undefined for an unpriced model, unobserved usage, or no model', () => {
    expect(
      estimateCostUsd(
        'openai/some-new-model',
        usage({ inputTokens: 10 }),
        pricing,
      ),
    ).toBeUndefined();
    expect(
      estimateCostUsd('gpt-4o-mini', emptyUsage(), pricing),
    ).toBeUndefined();
    expect(
      estimateCostUsd(undefined, usage({ inputTokens: 10 }), pricing),
    ).toBeUndefined();
  });

  it('defaults to an empty table, so nothing is priced until the operator fills one in', () => {
    expect(
      estimateCostUsd('gpt-4o-mini', usage({ inputTokens: 1000 }), {}),
    ).toBeUndefined();
  });
});

describe('tallyCategories', () => {
  it('leaves GAP cases out, like SKIPs — an unmeasured case moves no rate', () => {
    expect(
      tallyCategories([
        { category: 'ratio-trap', verdict: 'PASS' },
        { category: 'ratio-trap', verdict: 'GAP' },
        { category: 'ratio-trap', verdict: 'FAIL' },
      ]),
    ).toEqual({ 'ratio-trap': { total: 2, passed: 1 } });
  });

  it('counts passes per category and ignores skipped cases', () => {
    expect(
      tallyCategories([
        { category: 'ratio-trap', verdict: 'PASS' },
        { category: 'ratio-trap', verdict: 'FAIL' },
        { category: 'ties', verdict: 'PASS' },
        { category: 'ties', verdict: 'SKIP' },
        { category: 'ratio-trap', verdict: 'ERROR' },
      ]),
    ).toEqual({
      'ratio-trap': { total: 3, passed: 1 },
      ties: { total: 1, passed: 1 },
    });
  });

  it('buckets uncategorised cases rather than dropping them', () => {
    expect(tallyCategories([{ verdict: 'PASS' }])).toEqual({
      uncategorised: { total: 1, passed: 1 },
    });
  });
});

/* ------------------------------------------------------------ run log v2 */

function attempt(
  verdict: EvalVerdict,
  over: Partial<EvalRunLogAttempt> = {},
): EvalRunLogAttempt {
  return {
    attempt: 1,
    verdict,
    checks: [],
    sql: [],
    steps: 1,
    calledTools: ['run_readonly_sql'],
    repairs: [],
    warnings: [],
    durationMs: 1000,
    answer: 'An answer.',
    ...over,
  };
}

function folded(
  id: string,
  attempts: EvalRunLogAttempt[],
  over: Partial<EvalRunLogCaseV2> = {},
): EvalRunLogCaseV2 {
  return { id, durationMs: 1000, attempts, ...foldAttempts(attempts), ...over };
}

describe('foldAttempts (pass^k)', () => {
  it('passes only when every attempt passed', () => {
    expect(
      foldAttempts([attempt('PASS'), attempt('PASS'), attempt('PASS')]),
    ).toEqual({
      verdict: 'PASS',
      runs: 3,
      passes: 3,
      flaky: false,
    });
  });

  it('fails a case that passed two draws in three, and calls it flaky', () => {
    expect(
      foldAttempts([
        attempt('PASS'),
        attempt('FAIL', { failureLabel: 'wrong-filter' }),
        attempt('PASS'),
      ]),
    ).toEqual({
      verdict: 'FAIL',
      runs: 3,
      passes: 2,
      flaky: true,
      failureLabel: 'wrong-filter',
    });
  });

  it('is GAP only when every attempt was unmeasured', () => {
    expect(foldAttempts([attempt('GAP'), attempt('GAP')]).verdict).toBe('GAP');
    // A GAP draw is no evidence: it cannot fail the case, and it cannot
    // stand in for a pass either — pass^k is not established, so GAP.
    expect(foldAttempts([attempt('PASS'), attempt('GAP')])).toMatchObject({
      verdict: 'GAP',
      passes: 1,
      runs: 1,
      flaky: false,
    });
    expect(
      foldAttempts([attempt('PASS'), attempt('GAP'), attempt('PASS')]),
    ).toMatchObject({ verdict: 'GAP', passes: 2, runs: 2, flaky: false });
    // A measured failure is real evidence whatever the GAPs say.
    expect(foldAttempts([attempt('FAIL'), attempt('GAP')])).toMatchObject({
      verdict: 'FAIL',
      passes: 0,
      runs: 1,
    });
  });

  it('ignores attempts cut off by Stop, and never calls an unfinished case a PASS', () => {
    const stopped = attempt('ERROR', { error: 'stopped' });
    expect(foldAttempts([attempt('PASS'), stopped])).toMatchObject({
      verdict: 'SKIP',
      runs: 1,
      passes: 1,
    });
    expect(foldAttempts([attempt('FAIL'), stopped]).verdict).toBe('FAIL');
    expect(foldAttempts([stopped]).verdict).toBe('SKIP');
  });

  it('is ERROR when something threw and nothing passed, even beside FAILs and GAPs', () => {
    expect(foldAttempts([attempt('FAIL'), attempt('ERROR')]).verdict).toBe(
      'ERROR',
    );
    expect(foldAttempts([attempt('GAP'), attempt('ERROR')]).verdict).toBe(
      'ERROR',
    );
    // A PASS outranks the ERROR: the case ran and is simply not stable.
    expect(foldAttempts([attempt('PASS'), attempt('ERROR')]).verdict).toBe(
      'FAIL',
    );
  });

  it('takes the failure label from the first non-PASS attempt that has one', () => {
    expect(
      foldAttempts([
        attempt('PASS'),
        attempt('GAP'),
        attempt('FAIL', { failureLabel: 'unit' }),
        attempt('FAIL', { failureLabel: 'judge' }),
      ]).failureLabel,
    ).toBe('unit');
  });

  it('never labels a PASS', () => {
    expect(
      foldAttempts([attempt('PASS', { failureLabel: 'judge' })]).failureLabel,
    ).toBeUndefined();
  });

  it('is SKIP with no attempts, and does not count SKIP attempts as runs', () => {
    expect(foldAttempts([])).toEqual({
      verdict: 'SKIP',
      runs: 0,
      passes: 0,
      flaky: false,
    });
    expect(foldAttempts([attempt('PASS'), attempt('SKIP')])).toMatchObject({
      verdict: 'PASS',
      runs: 1,
    });
  });
});

describe('representativeAttempt', () => {
  it('is the first draw that did not pass, else the first', () => {
    const second = attempt('FAIL', { attempt: 2 });
    expect(
      representativeAttempt([
        attempt('PASS'),
        second,
        attempt('FAIL', { attempt: 3 }),
      ]),
    ).toBe(second);
    const first = attempt('PASS');
    expect(
      representativeAttempt([first, attempt('PASS', { attempt: 2 })]),
    ).toBe(first);
    expect(representativeAttempt([])).toBeUndefined();
  });
});

describe('wilson95', () => {
  it('matches the sanity anchor 9/10 → [0.596, 0.982]', () => {
    const [low, high] = wilson95(9, 10);
    expect(low).toBeCloseTo(0.596, 3);
    expect(high).toBeCloseTo(0.982, 3);
  });

  it('keeps a real width at n/n and 0/n instead of collapsing to certainty', () => {
    const [low, high] = wilson95(10, 10);
    expect(high).toBeCloseTo(1, 9);
    expect(low).toBeLessThan(0.75);
    expect(wilson95(0, 10)[1]).toBeGreaterThan(0.25);
    expect(wilson95(0, 0)).toEqual([0, 0]);
  });
});

describe('clipLogText', () => {
  it('keeps short text and clips long text with a marker', () => {
    expect(clipLogText('short')).toBe('short');
    expect(clipLogText(undefined)).toBeUndefined();
    const long = 'x'.repeat(LOG_ANSWER_MAX_CHARS + 50);
    expect(clipLogText(long)).toBe(
      `${'x'.repeat(LOG_ANSWER_MAX_CHARS)}… (truncated)`,
    );
  });
});

describe('summarizeCases', () => {
  const usage = (totalTokens: number): TokenUsage => ({
    ...emptyUsage(),
    inputTokens: totalTokens,
    totalTokens,
    calls: 1,
  });
  const cases: EvalRunLogCaseV2[] = [
    folded('a', [attempt('PASS'), attempt('PASS')], {
      category: 'ratio-trap',
      difficulty: 'hard',
      usage: usage(1000),
    }),
    folded('b', [attempt('PASS'), attempt('FAIL')], {
      category: 'ratio-trap',
      difficulty: 'medium',
      usage: usage(3000),
    }),
    folded('c', [attempt('GAP'), attempt('GAP')], { category: 'ties' }),
    folded(
      'd',
      [attempt('FAIL', { answer: '' }), attempt('FAIL', { answer: '' })],
      {
        category: 'control',
      },
    ),
    folded(
      'e',
      [
        attempt('PASS', { answer: '', clarification: 'Which member?' }),
        attempt('PASS', { answer: '', clarification: 'Which member?' }),
      ],
      { category: 'clarification', difficulty: 'easy' },
    ),
    {
      id: 'f',
      category: 'control',
      verdict: 'SKIP',
      runs: 0,
      passes: 0,
      flaky: false,
      durationMs: 0,
      attempts: [],
    },
  ];

  it('rates pass^k over scored cases only: all − GAP − SKIP', () => {
    const summary = summarizeCases(cases);
    expect(summary.passK).toBe(2); // a, e
    expect(summary.scored).toBe(4); // a, b, d, e
    expect(summary.passKRate).toBeCloseTo(0.5, 6);
    expect(summary.gaps).toBe(1);
  });

  it('reports the forgiving per-draw rate and the flaky count beside it', () => {
    const summary = summarizeCases(cases);
    // passes 2 + 1 + 0 + 2 over runs 2 + 2 + 2 + 2
    expect(summary.meanPassRate).toBeCloseTo(5 / 8, 6);
    expect(summary.flaky).toBe(1);
  });

  it('counts a case as answered when every attempt said something — prose or a question', () => {
    const summary = summarizeCases(cases);
    // a, b, c, e answered every time; d never did; f has no attempts (unobserved).
    expect(summary.answeredEveryTime).toBe(4);
    expect(summary.answeredObserved).toBe(5);
  });

  it('breaks pass^k down by category, difficulty and behaviour', () => {
    const summary = summarizeCases(cases);
    expect(summary.byCategory).toEqual({
      'ratio-trap': { total: 2, passK: 1, meanPassRate: 0.75 },
      control: { total: 1, passK: 0, meanPassRate: 0 },
      clarification: { total: 1, passK: 1, meanPassRate: 1 },
    });
    expect(summary.byDifficulty).toEqual({
      hard: { total: 1, passK: 1 },
      medium: { total: 1, passK: 0 },
      unrated: { total: 1, passK: 0 },
      easy: { total: 1, passK: 1 },
    });
    expect(summary.behaviourPassK).toBe(1);
    expect(summary.behaviourTotal).toBe(1);
  });

  it('prices a correct answer only when both the cost and pass^k are known', () => {
    expect(summarizeCases(cases, 0.5).costPerCorrectUsd).toBeCloseTo(0.25, 6);
    expect(summarizeCases(cases).costPerCorrectUsd).toBeUndefined();
    expect(summarizeCases(cases, 0).costPerCorrectUsd).toBeUndefined();
    const allFailed = cases.map((item) => ({
      ...item,
      verdict: 'FAIL' as const,
    }));
    expect(summarizeCases(allFailed, 1).costPerCorrectUsd).toBeUndefined();
  });

  it('averages tokens over the cases whose usage was observed, attempts included', () => {
    const withAttemptUsage = [
      ...cases,
      folded('g', [
        attempt('PASS', { usage: usage(500) }),
        attempt('PASS', { usage: usage(1500) }),
      ]),
    ];
    // (1000 + 3000 + 2000) / 3
    expect(summarizeCases(withAttemptUsage).tokensPerCase).toBe(2000);
    expect(summarizeCases([cases[2]]).tokensPerCase).toBeUndefined();
  });

  it('reports zero rates, not NaN, when nothing was scored', () => {
    expect(summarizeCases([])).toMatchObject({
      passK: 0,
      passKRate: 0,
      meanPassRate: 0,
      scored: 0,
    });
  });
});

/**
 * A real v1 record: `logs/evals/2026-09-22-health-insurance-9a8d7567.json`,
 * trimmed to four cases (and their categories) — the shape every 2026-09-22
 * log has, so History and Compare must keep reading it.
 */
const V1_FIXTURE: EvalRunLogRecordV1 = {
  schemaVersion: 1,
  runId: '9a8d7567-7a48-420f-b251-54a500029d77',
  harness: 'in-app',
  suite: 'health-insurance',
  agentKey: 'assistant',
  datasets: ['Health Insurance'],
  model: 'openai/gpt-4o-mini',
  startedAt: '2026-09-22T21:47:12.315Z',
  finishedAt: '2026-09-22T21:49:58.579Z',
  durationMs: 166264,
  totals: { cases: 20, passed: 3, failed: 17, errored: 0, skipped: 0 },
  categories: {
    'ratio-trap': { total: 3, passed: 0 },
    'empty-column': { total: 1, passed: 1 },
    clarification: { total: 1, passed: 0 },
    control: { total: 2, passed: 1 },
  },
  usage: {
    inputTokens: 191694,
    outputTokens: 8696,
    totalTokens: 200390,
    reasoningTokens: 0,
    cachedInputTokens: 66432,
    calls: 23,
  },
  costIncomplete: true,
  cases: [
    {
      id: 'paid-share-by-specialty',
      category: 'ratio-trap',
      verdict: 'FAIL',
      reason: 'result-set-match',
      durationMs: 12162,
      usage: {
        inputTokens: 13564,
        outputTokens: 821,
        totalTokens: 14385,
        reasoningTokens: 0,
        cachedInputTokens: 3584,
        calls: 1,
      },
    },
    {
      id: 'claims-with-preauth',
      category: 'empty-column',
      verdict: 'PASS',
      durationMs: 6183,
      usage: {
        inputTokens: 7602,
        outputTokens: 205,
        totalTokens: 7807,
        reasoningTokens: 0,
        cachedInputTokens: 2816,
        calls: 1,
      },
    },
    {
      id: 'most-expensive-member',
      category: 'clarification',
      verdict: 'FAIL',
      reason: 'check-called-tool',
      durationMs: 7655,
      usage: {
        inputTokens: 8874,
        outputTokens: 378,
        totalTokens: 9252,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        calls: 2,
      },
    },
    {
      id: 'members-per-plan-tier',
      category: 'control',
      verdict: 'FAIL',
      reason: 'result-set-match',
      durationMs: 6852,
      usage: {
        inputTokens: 7765,
        outputTokens: 412,
        totalTokens: 8177,
        reasoningTokens: 0,
        cachedInputTokens: 2816,
        calls: 1,
      },
    },
  ],
  comparedToRunId: 'a028ccd4-337b-4862-9b63-8e8d4ce5bdcb',
  regressions: ['claims-by-currency'],
  improvements: ['claims-with-preauth', 'claims-march-2024'],
};

describe('normalizeRunLog', () => {
  it('reads a real v1 record as a v2 view', () => {
    const v2 = normalizeRunLog(V1_FIXTURE);
    expect(v2).toMatchObject({
      schemaVersion: 2,
      runId: V1_FIXTURE.runId,
      harness: 'in-app',
      suite: 'health-insurance',
      model: 'openai/gpt-4o-mini',
      repeat: 1,
      configHash: 'legacy',
      status: 'completed',
      costIncomplete: true,
      comparedToRunId: 'a028ccd4-337b-4862-9b63-8e8d4ce5bdcb',
      regressions: ['claims-by-currency'],
      totals: {
        cases: 20,
        passed: 3,
        failed: 17,
        errored: 0,
        gaps: 0,
        skipped: 0,
      },
      usage: V1_FIXTURE.usage,
      categories: V1_FIXTURE.categories,
    });
    // Every v1 run predates the levers: the engine as it shipped.
    expect(v2.engine).toEqual({ ...ENGINE_DEFAULTS });
    expect(isRunLogV2(v2)).toBe(true);
  });

  it('turns each v1 verdict into a one-draw fold with no attempts', () => {
    const v2 = normalizeRunLog(V1_FIXTURE);
    expect(
      v2.cases.map((item) => [item.id, item.verdict, item.runs, item.passes]),
    ).toEqual([
      ['paid-share-by-specialty', 'FAIL', 1, 0],
      ['claims-with-preauth', 'PASS', 1, 1],
      ['most-expensive-member', 'FAIL', 1, 0],
      ['members-per-plan-tier', 'FAIL', 1, 0],
    ]);
    expect(
      v2.cases.every((item) => item.attempts.length === 0 && !item.flaky),
    ).toBe(true);
    expect(v2.cases[0]).toMatchObject({
      reason: 'result-set-match',
      usage: V1_FIXTURE.cases[0].usage,
    });
  });

  it('computes the pass^k summary from the v1 verdicts', () => {
    const summary = normalizeRunLog(V1_FIXTURE).summary;
    expect(summary).toMatchObject({
      passK: 1,
      scored: 4,
      passKRate: 0.25,
      meanPassRate: 0.25,
      flaky: 0,
      gaps: 0,
      // No attempts were recorded, so nothing can be said about answering.
      answeredEveryTime: 0,
      answeredObserved: 0,
      behaviourPassK: 0,
      behaviourTotal: 1,
      tokensPerCase: Math.round((14385 + 7807 + 9252 + 8177) / 4),
    });
    expect(summary.byCategory.control).toEqual({
      total: 1,
      passK: 0,
      meanPassRate: 0,
    });
  });

  it('keeps the CLI --repeat counts a v1 case carried', () => {
    const v2 = normalizeRunLog({
      ...V1_FIXTURE,
      cases: [
        {
          id: 'x',
          category: 'ties',
          verdict: 'FAIL',
          reason: 'timeout',
          durationMs: 1,
          runs: 5,
          passes: 4,
        },
        { id: 'y', verdict: 'SKIP', durationMs: 0 },
      ],
    });
    expect(v2.repeat).toBe(5);
    expect(v2.cases[0]).toMatchObject({
      runs: 5,
      passes: 4,
      flaky: true,
      failureLabel: 'timeout',
    });
    // A SKIP never ran.
    expect(v2.cases[1]).toMatchObject({ runs: 0, passes: 0 });
    expect(v2.summary.meanPassRate).toBeCloseTo(0.8, 6);
  });

  it('returns a v2 record as it is, filling in what a truncated file lost', () => {
    const v2 = normalizeRunLog(V1_FIXTURE);
    expect(normalizeRunLog(v2)).toEqual(v2);
    const partial = {
      ...v2,
      summary: undefined,
      cases: [{ ...v2.cases[1], attempts: undefined }],
    } as never;
    const repaired = normalizeRunLog(partial);
    expect(repaired.cases[0].attempts).toEqual([]);
    expect(repaired.summary.passK).toBe(1);
  });
});
