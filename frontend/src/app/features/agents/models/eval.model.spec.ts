import {
  AgentEvalCaseResult,
  EvalRunLogAttempt,
  EvalRunLogCaseV2,
  EvalRunSummary,
  NOT_MEASURED_LABEL,
  NOT_PRICED_LABEL,
  NO_CORRECT_ANSWERS_LABEL,
  RunLogDiff,
  RunLogDiffSide,
  TokenUsage,
  TrendPoint,
  armLabel,
  categoryRateClass,
  costPerCorrectLabel,
  diffFlips,
  diffHeadline,
  diffNotComparableReasons,
  evalCostState,
  formatPassK,
  formatRate,
  formatTokenCount,
  formatTokensCompact,
  harnessLabel,
  isUsageMeasured,
  logCaseToEvalCase,
  logCaseToResult,
  logSummaryCostLabel,
  logSummaryPassKLabel,
  orderedCategoryDeltas,
  representativeLogAttempt,
  sortedCategoryRates,
  trendSeries,
  verdictClass,
  verdictOf,
} from './eval.model';

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 30_000,
    outputTokens: 11_200,
    totalTokens: 41_200,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    calls: 12,
    ...overrides,
  };
}

describe('eval token formatting', () => {
  it('groups exact counts with thousands separators', () => {
    expect(formatTokenCount(41_231)).toBe('41,231');
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('compacts large counts for the run card header', () => {
    expect(formatTokensCompact(41_231)).toBe('41.2k');
    expect(formatTokensCompact(1_240_000)).toBe('1.24M');
  });

  it('leaves counts below a thousand exact', () => {
    expect(formatTokensCompact(842)).toBe('842');
  });
});

describe('eval usage measurement', () => {
  it('treats an absent usage record as unmeasured', () => {
    expect(isUsageMeasured(undefined)).toBe(false);
  });

  it('treats zero model calls as unmeasured, not as free', () => {
    expect(isUsageMeasured(usage({ calls: 0 }))).toBe(false);
  });

  it('treats a reported call as measured', () => {
    expect(isUsageMeasured(usage({ calls: 1 }))).toBe(true);
  });
});

describe('evalCostState', () => {
  it('says "not measured" when the provider reported nothing', () => {
    expect(evalCostState(undefined, undefined)).toEqual({
      kind: 'not-measured',
      label: NOT_MEASURED_LABEL,
    });
    expect(evalCostState(usage({ calls: 0 }), undefined).kind).toBe(
      'not-measured',
    );
  });

  it('never reports a cost for an unmeasured run, even if one arrives', () => {
    // A cost without any observed call cannot be trusted; tokens win.
    expect(evalCostState(usage({ calls: 0 }), 1.23).label).toBe(
      NOT_MEASURED_LABEL,
    );
  });

  it('says "not priced" when tokens are known but the model has no rate', () => {
    expect(evalCostState(usage(), undefined)).toEqual({
      kind: 'not-priced',
      label: NOT_PRICED_LABEL,
    });
  });

  it('never renders an absent cost as $0.00', () => {
    expect(evalCostState(usage(), undefined).label).not.toContain('$0.00');
  });

  it('formats a known cost as USD', () => {
    expect(evalCostState(usage(), 1.5).label).toBe('$1.50');
  });

  it('widens sub-cent costs rather than rounding them to $0.00', () => {
    expect(evalCostState(usage(), 0.0023).label).toBe('$0.0023');
  });

  it('reports a genuine zero cost as $0.00', () => {
    expect(evalCostState(usage(), 0)).toEqual({
      kind: 'priced',
      label: '$0.00',
    });
  });
});

describe('sortedCategoryRates', () => {
  it('returns nothing when no tallies were recorded', () => {
    expect(sortedCategoryRates(undefined)).toEqual([]);
  });

  it('orders the worst pass rate first', () => {
    const rates = sortedCategoryRates({
      ties: { total: 4, passed: 4 },
      'value-vocabulary': { total: 4, passed: 1 },
      ambiguity: { total: 4, passed: 2 },
    });
    expect(rates.map((r) => r.category)).toEqual([
      'value-vocabulary',
      'ambiguity',
      'ties',
    ]);
    expect(rates[0].rate).toBeCloseTo(0.25);
  });

  it('breaks a tie on rate by the larger category, then by name', () => {
    const rates = sortedCategoryRates({
      beta: { total: 2, passed: 0 },
      alpha: { total: 2, passed: 0 },
      gamma: { total: 8, passed: 0 },
    });
    expect(rates.map((r) => r.category)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('treats an empty category as a zero rate instead of dividing by zero', () => {
    const [only] = sortedCategoryRates({ empty: { total: 0, passed: 0 } });
    expect(only.rate).toBe(0);
  });
});

describe('category rate presentation', () => {
  it('renders rates as whole percentages', () => {
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(1)).toBe('100%');
  });

  it('greens only a clean sweep, reds below half, ambers in between', () => {
    expect(categoryRateClass(1)).toBe('text-emerald-400');
    expect(categoryRateClass(0.99)).toBe('text-amber-400');
    expect(categoryRateClass(0.5)).toBe('text-amber-400');
    expect(categoryRateClass(0.49)).toBe('text-red-400');
    expect(categoryRateClass(0)).toBe('text-red-400');
  });
});

/* ------------------------------------------------------------------ *
 * Run log v2 helpers
 * ------------------------------------------------------------------ */

function summary(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    passK: 0,
    passKRate: 0,
    meanPassRate: 0,
    flaky: 0,
    gaps: 0,
    answeredEveryTime: 0,
    byCategory: {},
    byDifficulty: {},
    ...overrides,
  };
}

describe('verdictClass', () => {
  it('greens a clean PASS', () => {
    expect(verdictClass('PASS')).toBe('text-emerald-400');
  });

  it('reds a FAIL', () => {
    expect(verdictClass('FAIL')).toBe('text-red-400');
  });

  it('distinguishes ERROR from FAIL', () => {
    expect(verdictClass('ERROR')).toBe('text-rose-500');
    expect(verdictClass('ERROR')).not.toBe(verdictClass('FAIL'));
  });

  it('renders GAP and SKIP as neutral grey, not red — a harness gap is not a wrong answer', () => {
    expect(verdictClass('GAP')).toBe('text-slate-400');
    expect(verdictClass('SKIP')).toBe('text-slate-400');
  });
});

describe('verdictOf', () => {
  function result(
    overrides: Partial<
      Pick<AgentEvalCaseResult, 'verdict' | 'passed' | 'error'>
    > = {},
  ): Pick<AgentEvalCaseResult, 'verdict' | 'passed' | 'error'> {
    return { passed: false, ...overrides };
  }

  it('prefers the explicit v2 verdict, including GAP', () => {
    expect(
      verdictOf(result({ verdict: 'GAP', passed: true, error: undefined })),
    ).toBe('GAP');
  });

  it('derives ERROR from a legacy error field when no verdict was recorded', () => {
    expect(verdictOf(result({ error: 'timeout', passed: false }))).toBe(
      'ERROR',
    );
  });

  it('derives PASS/FAIL from the legacy passed field when nothing else applies', () => {
    expect(verdictOf(result({ passed: true }))).toBe('PASS');
    expect(verdictOf(result({ passed: false }))).toBe('FAIL');
  });
});

describe('formatPassK', () => {
  it('formats pass^k, total and rate — the headline example', () => {
    const s = summary({
      passK: 12,
      passKRate: 12 / 19,
      byCategory: { ties: { total: 19, passK: 12, meanPassRate: 0.7 } },
    });
    expect(formatPassK(s, 3)).toBe('12/19 pass^3 · 63%');
  });

  it('excludes gaps from the denominator and appends a singular gap note', () => {
    const s = summary({
      passK: 10,
      passKRate: 10 / 19,
      gaps: 1,
      byCategory: { ties: { total: 20, passK: 10, meanPassRate: 0.6 } },
    });
    expect(formatPassK(s, 3)).toBe('10/19 pass^3 · 53% · 1 gap');
  });

  it('pluralises the gap note when there is more than one', () => {
    const s = summary({
      passK: 12,
      passKRate: 12 / 19,
      gaps: 2,
      byCategory: { ties: { total: 21, passK: 12, meanPassRate: 0.7 } },
    });
    expect(formatPassK(s, 3)).toBe('12/19 pass^3 · 63% · 2 gaps');
  });

  it('falls back to the difficulty breakdown when no category was recorded', () => {
    const s = summary({
      passK: 12,
      passKRate: 12 / 19,
      byDifficulty: {
        easy: { total: 10, passK: 8 },
        hard: { total: 9, passK: 4 },
      },
    });
    expect(formatPassK(s, 3)).toBe('12/19 pass^3 · 63%');
  });
});

describe('costPerCorrectLabel', () => {
  const measured = usage();

  it('says "not measured" when nothing was observed, like evalCostState', () => {
    expect(costPerCorrectLabel(summary(), undefined)).toBe(NOT_MEASURED_LABEL);
    expect(costPerCorrectLabel(summary(), usage({ calls: 0 }))).toBe(
      NOT_MEASURED_LABEL,
    );
  });

  it('reports "no correct answers" rather than dividing by zero', () => {
    expect(costPerCorrectLabel(summary({ passK: 0 }), measured)).toBe(
      NO_CORRECT_ANSWERS_LABEL,
    );
  });

  it('says "not priced" when correct answers exist but no rate is configured', () => {
    expect(
      costPerCorrectLabel(
        summary({ passK: 3, costPerCorrectUsd: undefined }),
        measured,
      ),
    ).toBe(NOT_PRICED_LABEL);
  });

  it('renders a priced run to four decimals, since these are usually sub-dime', () => {
    expect(
      costPerCorrectLabel(
        summary({ passK: 3, costPerCorrectUsd: 0.0421 }),
        measured,
      ),
    ).toBe('$0.0421 per correct answer');
  });
});

describe('armLabel', () => {
  it('reads an absent or blank arm as the production baseline', () => {
    expect(armLabel(undefined)).toBe('baseline');
    expect(armLabel('')).toBe('baseline');
    expect(armLabel('   ')).toBe('baseline');
  });

  it('passes a named arm through unchanged', () => {
    expect(armLabel('fixer-off')).toBe('fixer-off');
  });
});

describe('harnessLabel', () => {
  it('labels every known harness for the History badge', () => {
    expect(harnessLabel('in-app')).toBe('In-app');
    expect(harnessLabel('golden-set')).toBe('CLI');
    expect(harnessLabel('validate')).toBe('Validate');
  });

  it('falls back to Unknown rather than rendering blank', () => {
    expect(harnessLabel(undefined)).toBe('Unknown');
  });
});

/* ------------------------------------------------------------------ *
 * History row helpers
 * ------------------------------------------------------------------ */

describe('logSummaryPassKLabel', () => {
  it('matches the headline format used for a full run summary', () => {
    expect(
      logSummaryPassKLabel({
        passK: 12,
        passKRate: 12 / 19,
        cases: 19,
        repeat: 3,
        gaps: 0,
      }),
    ).toBe('12/19 pass^3 · 63%');
  });

  it('appends the gap note, pluralised', () => {
    expect(
      logSummaryPassKLabel({
        passK: 10,
        passKRate: 10 / 19,
        cases: 19,
        repeat: 3,
        gaps: 1,
      }),
    ).toBe('10/19 pass^3 · 53% · 1 gap');
    expect(
      logSummaryPassKLabel({
        passK: 10,
        passKRate: 10 / 19,
        cases: 19,
        repeat: 3,
        gaps: 2,
      }),
    ).toBe('10/19 pass^3 · 53% · 2 gaps');
  });

  it('degrades gracefully when a pre-v2 index line has no pass^k fields', () => {
    expect(
      logSummaryPassKLabel({
        passK: undefined,
        passKRate: undefined,
        cases: 10,
        repeat: undefined,
        gaps: undefined,
      }),
    ).toBe('0/10 pass^1 · 0%');
  });
});

describe('logSummaryCostLabel', () => {
  it('says "not measured" when the row carries no tokens', () => {
    expect(
      logSummaryCostLabel({ totalTokens: 0, estimatedCostUsd: undefined }),
    ).toBe(NOT_MEASURED_LABEL);
  });

  it('says "not priced" once tokens are present but no rate is configured', () => {
    expect(
      logSummaryCostLabel({ totalTokens: 12_000, estimatedCostUsd: undefined }),
    ).toBe(NOT_PRICED_LABEL);
  });

  it('renders a priced row as USD', () => {
    expect(
      logSummaryCostLabel({ totalTokens: 12_000, estimatedCostUsd: 1.5 }),
    ).toBe('$1.50');
  });
});

/* ------------------------------------------------------------------ *
 * History → trace panel adapter
 * ------------------------------------------------------------------ */

function attempt(overrides: Partial<EvalRunLogAttempt> = {}): EvalRunLogAttempt {
  return {
    attempt: 1,
    verdict: 'PASS',
    checks: [],
    sql: [],
    steps: 1,
    calledTools: [],
    repairs: [],
    warnings: [],
    durationMs: 500,
    ...overrides,
  };
}

function caseV2(overrides: Partial<EvalRunLogCaseV2> = {}): EvalRunLogCaseV2 {
  return {
    id: 'net-paid-2024',
    category: 'ratio-trap',
    verdict: 'PASS',
    runs: 3,
    passes: 3,
    flaky: false,
    durationMs: 1500,
    attempts: [attempt()],
    ...overrides,
  };
}

describe('representativeLogAttempt', () => {
  it('picks the first non-passing attempt — the draw worth reading', () => {
    const first = attempt({ attempt: 1, verdict: 'PASS' });
    const second = attempt({ attempt: 2, verdict: 'FAIL' });
    const third = attempt({ attempt: 3, verdict: 'PASS' });
    expect(
      representativeLogAttempt({ attempts: [first, second, third] }),
    ).toBe(second);
  });

  it('falls back to the first attempt when every one passed', () => {
    const first = attempt({ attempt: 1 });
    expect(representativeLogAttempt({ attempts: [first] })).toBe(first);
  });

  it('returns undefined for a case with no attempts (a v1 log)', () => {
    expect(representativeLogAttempt({ attempts: [] })).toBeUndefined();
  });
});

describe('logCaseToEvalCase', () => {
  it('carries id, category, question and difficulty through', () => {
    const item = caseV2({
      id: 'denial-rate',
      category: 'metric-definition',
      question: 'What share of claims were denied?',
      difficulty: 'hard',
      variantOf: 'denial-rate-base',
      attempts: [
        attempt({ checks: [{ id: 'check-matches', passed: true }] }),
      ],
    });
    expect(logCaseToEvalCase(item)).toEqual({
      id: 'denial-rate',
      category: 'metric-definition',
      question: 'What share of claims were denied?',
      intent: '',
      checks: [
        { id: 'check-matches', name: 'check-matches', description: 'check-matches' },
      ],
      difficulty: 'hard',
      variantOf: 'denial-rate-base',
    });
  });

  it('falls back to the case id as the question when the log predates it', () => {
    const item = caseV2({ id: 'champion-2022', question: undefined });
    expect(logCaseToEvalCase(item).question).toBe('champion-2022');
  });

  it('reads the representative attempt\'s checks, not just the first attempt', () => {
    const item = caseV2({
      attempts: [
        attempt({ attempt: 1, verdict: 'FAIL', checks: [{ id: 'check-matches', passed: false, reason: 'no match' }] }),
        attempt({ attempt: 2, verdict: 'PASS', checks: [{ id: 'check-matches', passed: true }] }),
      ],
    });
    expect(logCaseToEvalCase(item).checks).toEqual([
      { id: 'check-matches', name: 'check-matches', description: 'check-matches' },
    ]);
  });
});

describe('logCaseToResult', () => {
  it('adapts a passing case into the shape the trace panel renders', () => {
    const item = caseV2({
      id: 'champion-2022',
      question: 'Who won the 2022 World Cup?',
      verdict: 'PASS',
      runs: 3,
      passes: 3,
      usage: usage(),
      attempts: [
        attempt({
          answer: 'Argentina.',
          finalSql: 'select winner from finals where year = 2022',
          calledTools: ['run_readonly_sql'],
          checks: [{ id: 'check-matches', passed: true }],
        }),
      ],
    });
    const result = logCaseToResult(item);
    expect(result.id).toBe('champion-2022');
    expect(result.question).toBe('Who won the 2022 World Cup?');
    expect(result.passed).toBe(true);
    expect(result.verdict).toBe('PASS');
    expect(result.answer).toBe('Argentina.');
    expect(result.finalSql).toBe(
      'select winner from finals where year = 2022',
    );
    expect(result.toolCalls).toEqual([{ name: 'run_readonly_sql' }]);
    expect(result.checkResults).toEqual([
      { id: 'check-matches', description: 'check-matches', score: 1, passed: true },
    ]);
    expect(result.scores).toEqual({ 'check-matches': 1 });
    expect(result.attempts).toBe(item.attempts);
  });

  it('carries the representative attempt\'s error onto a failed/errored case', () => {
    const item = caseV2({
      verdict: 'ERROR',
      passes: 0,
      attempts: [attempt({ verdict: 'ERROR', error: 'timed out after 30s' })],
    });
    const result = logCaseToResult(item);
    expect(result.passed).toBe(false);
    expect(result.error).toBe('timed out after 30s');
  });

  it('folds crossCheck/review status into the shape the panel expects, findings blank', () => {
    const item = caseV2({
      attempts: [attempt({ crossCheck: 'disagree', review: 'flagged' })],
    });
    const result = logCaseToResult(item);
    expect(result.crossCheck).toEqual({ status: 'disagree' });
    expect(result.review).toEqual({ status: 'flagged', findings: [] });
  });

  it('never throws on a case with no attempts (a v1 log) — the panel gets empty fields', () => {
    const item = caseV2({ attempts: [] });
    const result = logCaseToResult(item);
    expect(result.answer).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.checkResults).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * trendSeries
 * ------------------------------------------------------------------ */

function trendPoint(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
    runId: 'run-1',
    file: 'run-1.json',
    startedAt: '2026-09-01T00:00:00.000Z',
    passKRate: 0.5,
    meanPassRate: 0.6,
    gaps: 0,
    flaky: 0,
    ...overrides,
  };
}

describe('trendSeries', () => {
  it('groups by arm, one series per arm, sorted chronologically within it', () => {
    const points = [
      trendPoint({ runId: 'r2', arm: 'fixer-off', startedAt: '2026-09-03T00:00:00.000Z' }),
      trendPoint({ runId: 'r1', arm: 'baseline', startedAt: '2026-09-01T00:00:00.000Z' }),
      trendPoint({ runId: 'r3', arm: 'fixer-off', startedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    const series = trendSeries(points, 'arm');
    expect(series.map((s) => s.key)).toEqual(['baseline', 'fixer-off']);
    const fixerOff = series.find((s) => s.key === 'fixer-off')!;
    expect(fixerOff.points.map((p) => p.runId)).toEqual(['r3', 'r2']);
  });

  it('reads a blank arm as the "baseline" series, same as armLabel', () => {
    const points = [trendPoint({ arm: undefined }), trendPoint({ arm: '' })];
    const series = trendSeries(points, 'arm');
    expect(series.map((s) => s.key)).toEqual(['baseline']);
    expect(series[0].points.length).toBe(2);
  });

  it('groups by model when asked, falling back to "unknown"', () => {
    const points = [
      trendPoint({ runId: 'r1', model: 'gpt-5' }),
      trendPoint({ runId: 'r2', model: undefined }),
    ];
    const series = trendSeries(points, 'model');
    expect(series.map((s) => s.key)).toEqual(['gpt-5', 'unknown']);
  });
});

/* ------------------------------------------------------------------ *
 * Compare
 * ------------------------------------------------------------------ */

function diffSide(overrides: Partial<RunLogDiffSide> = {}): RunLogDiffSide {
  return {
    runId: 'run-before',
    suite: 'health-insurance',
    configHash: 'abc123',
    repeat: 3,
    startedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function diff(overrides: Partial<RunLogDiff> = {}): RunLogDiff {
  return {
    runBefore: diffSide({ runId: 'run-before' }),
    runAfter: diffSide({ runId: 'run-after' }),
    perCase: [],
    regressions: [],
    improvements: [],
    flakyChanges: [],
    onlyBefore: [],
    onlyAfter: [],
    summaryBefore: summary({ passK: 12, passKRate: 12 / 19, scored: 19 }),
    summaryAfter: summary({ passK: 15, passKRate: 15 / 19, scored: 19 }),
    categoryDeltas: {},
    tokensDelta: 0,
    tokensComparable: true,
    sameModel: true,
    sameConfig: true,
    sameSuite: true,
    ...overrides,
  };
}

describe('diffHeadline', () => {
  it('summarises pass^k before/after and the flip counts', () => {
    const d = diff({
      improvements: ['a', 'b', 'c'],
      regressions: ['d'],
    });
    expect(diffHeadline(d)).toBe(
      '12/19 pass^3 (63%) → 15/19 pass^3 (79%) · 3 improvements, 1 regression',
    );
  });

  it('omits the flip clause when nothing moved', () => {
    const d = diff({ improvements: [], regressions: [] });
    expect(diffHeadline(d)).toBe('12/19 pass^3 (63%) → 15/19 pass^3 (79%)');
  });

  it('singularises a lone improvement or regression', () => {
    const d = diff({ improvements: ['a'], regressions: [] });
    expect(diffHeadline(d)).toContain('1 improvement, 0 regressions');
  });
});

describe('diffNotComparableReasons', () => {
  it('reports nothing when both runs match', () => {
    expect(diffNotComparableReasons(diff())).toEqual([]);
  });

  it('flags a different suite, model and config', () => {
    const d = diff({
      sameSuite: false,
      sameModel: false,
      sameConfig: false,
      runBefore: diffSide({ suite: 'world-cup', model: 'gpt-4o-mini', configHash: 'aaa' }),
      runAfter: diffSide({ suite: 'health-insurance', model: 'gpt-5', configHash: 'bbb' }),
    });
    const reasons = diffNotComparableReasons(d);
    expect(reasons.some((r) => r.includes('different suites'))).toBe(true);
    expect(reasons.some((r) => r.includes('different models'))).toBe(true);
    expect(reasons.some((r) => r.includes('different engine configs'))).toBe(
      true,
    );
  });

  it('flags a different repeat count', () => {
    const d = diff({
      runBefore: diffSide({ repeat: 1 }),
      runAfter: diffSide({ repeat: 3 }),
    });
    expect(
      diffNotComparableReasons(d).some((r) => r.includes('different repeat')),
    ).toBe(true);
  });
});

describe('orderedCategoryDeltas', () => {
  it('orders worst after-rate first, then biggest move', () => {
    const d = diff({
      categoryDeltas: {
        ties: { before: 1, after: 1, passKBefore: 4, passKAfter: 4, totalBefore: 4, totalAfter: 4 },
        'value-vocabulary': { before: 0.25, after: 0.5, passKBefore: 1, passKAfter: 2, totalBefore: 4, totalAfter: 4 },
        'ratio-trap': { before: 0.5, after: 0.25, passKBefore: 2, passKAfter: 1, totalBefore: 4, totalAfter: 4 },
      },
    });
    expect(orderedCategoryDeltas(d)).toEqual([
      'ratio-trap',
      'value-vocabulary',
      'ties',
    ]);
  });
});

describe('diffFlips', () => {
  it('keeps only cases whose verdict or pass count moved', () => {
    const d = diff({
      perCase: [
        {
          id: 'unchanged',
          before: 'PASS',
          after: 'PASS',
          passesBefore: 3,
          passesAfter: 3,
          runsBefore: 3,
          runsAfter: 3,
          flakyBefore: false,
          flakyAfter: false,
          checkDeltas: [],
        },
        {
          id: 'flipped',
          before: 'FAIL',
          after: 'PASS',
          passesBefore: 1,
          passesAfter: 3,
          runsBefore: 3,
          runsAfter: 3,
          flakyBefore: true,
          flakyAfter: false,
          checkDeltas: [],
        },
      ],
    });
    expect(diffFlips(d).map((row) => row.id)).toEqual(['flipped']);
  });
});
