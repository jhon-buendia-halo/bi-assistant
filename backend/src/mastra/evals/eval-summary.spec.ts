import {
  checkStatusOf,
  costText,
  questionStatus,
  renderSummaryMarkdown,
  splitCell,
  splitLines,
  summarizeEvalResults,
  tokensText,
  withResultDefaults,
  withStatusDefaults,
} from './eval-summary';
import type { EvalStatus } from './eval-summary';
import type { ModelUsageEntry } from './eval-usage';

/** A check result with just what the summary reads. */
function check(status: EvalStatus, criterion?: string) {
  return {
    id: `check-${criterion ?? 'none'}`,
    description: 'a check',
    score: status === 'passed' ? 1 : 0,
    passed: status === 'passed',
    status,
    ...(criterion ? { criterion } : {}),
  };
}

/** A question result whose status follows its checks, as the runner sets it. */
function result(
  id: string,
  category: string | undefined,
  checks: ReturnType<typeof check>[],
  error?: string,
  split: 'dev' | 'held-out' = 'dev',
) {
  const status = questionStatus(checks, error);
  return {
    id,
    question: `question ${id}`,
    ...(category ? { category } : {}),
    split,
    scores: {},
    checkResults: checks,
    answer: '',
    toolCalls: [],
    status,
    passed: status === 'passed',
    ...(error ? { error } : {}),
    durationMs: 1,
    passes: status === 'passed' ? 1 : 0,
    runs: 1,
    flaky: false,
  };
}

/** Split counts with no interval (nothing scored) unless one is given. */
function counts(passed: number, failed: number, notScored: number, flaky = 0) {
  return {
    passed,
    failed,
    notScored,
    flaky,
    total: passed + failed + notScored,
  };
}

describe('questionStatus (agents-evals R147)', () => {
  it('fails a question whose run threw, whatever its checks', () => {
    expect(questionStatus([], 'model down')).toBe('failed');
    expect(questionStatus([check('passed')], 'model down')).toBe('failed');
  });

  it('does not score a question with no scored check', () => {
    expect(questionStatus([check('not-scored')])).toBe('not-scored');
    expect(questionStatus([])).toBe('not-scored');
  });

  it('passes when every scored check passed, ignoring not-scored ones', () => {
    expect(questionStatus([check('passed'), check('not-scored')])).toBe(
      'passed',
    );
  });

  it('fails when any scored check failed', () => {
    expect(
      questionStatus([check('passed'), check('failed'), check('not-scored')]),
    ).toBe('failed');
  });

  it('reads a check without a status from its passed flag (old records)', () => {
    expect(checkStatusOf({ passed: true })).toBe('passed');
    expect(checkStatusOf({ passed: false })).toBe('failed');
    expect(questionStatus([{ passed: true }, { passed: true }])).toBe('passed');
  });
});

describe('summarizeEvalResults (agents-evals R148)', () => {
  it('counts questions per status and per category, in category-list order', () => {
    const summary = summarizeEvalResults([
      result('a', 'out-of-scope', [check('not-scored', 'G2')]),
      result('b', 'lookup', [check('passed', 'D1'), check('passed', 'G1')]),
      result('c', 'join', [check('failed', 'D1'), check('passed', 'D2')]),
      result('d', 'lookup', [check('failed', 'G1')]),
      result('e', 'lookup', [check('passed', 'D1')], 'boom'),
    ]);
    expect(summary).toMatchObject({ passed: 1, failed: 3, notScored: 1 });
    expect(summary.byCategory).toEqual([
      {
        category: 'lookup',
        ...counts(1, 2, 0),
        dev: { ...counts(1, 2, 0), interval: expect.any(Object) as object },
        heldOut: counts(0, 0, 0),
      },
      {
        category: 'join',
        ...counts(0, 1, 0),
        dev: { ...counts(0, 1, 0), interval: expect.any(Object) as object },
        heldOut: counts(0, 0, 0),
      },
      {
        category: 'out-of-scope',
        ...counts(0, 0, 1),
        // Not scored: in no interval.
        dev: counts(0, 0, 1),
        heldOut: counts(0, 0, 0),
      },
    ]);
  });

  it('puts unknown categories after the list and uncategorised last', () => {
    const summary = summarizeEvalResults([
      result('a', undefined, [check('passed')]),
      result('b', 'mystery', [check('passed')]),
      result('c', 'paraphrase', [check('failed')]),
      result('d', 'aardvark', [check('passed')]),
    ]);
    expect(summary.byCategory.map((entry) => entry.category)).toEqual([
      'paraphrase',
      'mystery',
      'aardvark',
      'uncategorised',
    ]);
  });

  it('counts scored checks per criterion, in D, G, I, C order, skipping not-scored checks and checks with no criterion', () => {
    const summary = summarizeEvalResults([
      result('a', 'lookup', [
        check('passed', 'I3'),
        check('passed', 'D1'),
        check('failed', 'G1'),
        check('passed'),
      ]),
      result('b', 'reasoning', [
        check('failed', 'D1'),
        check('not-scored', 'G3'),
        check('passed', 'C4'),
        check('passed', 'X9'),
      ]),
    ]);
    expect(summary.byCriterion).toEqual([
      { criterion: 'D1', passed: 1, failed: 1, total: 2 },
      { criterion: 'G1', passed: 0, failed: 1, total: 1 },
      { criterion: 'I3', passed: 1, failed: 0, total: 1 },
      { criterion: 'C4', passed: 1, failed: 0, total: 1 },
      { criterion: 'X9', passed: 1, failed: 0, total: 1 },
    ]);
  });

  it('summarises an empty run and tolerates results with no checks', () => {
    expect(summarizeEvalResults([])).toEqual({
      passed: 0,
      failed: 0,
      notScored: 0,
      flaky: 0,
      bySplit: { dev: counts(0, 0, 0), heldOut: counts(0, 0, 0) },
      byCategory: [],
      byCriterion: [],
    });
    expect(
      summarizeEvalResults([{ id: 'x', passed: true } as never]),
    ).toMatchObject({ passed: 1, byCriterion: [] });
  });
});

describe('withStatusDefaults (agents-evals R147, old records)', () => {
  it('derives the statuses of a result saved before they existed', () => {
    const old = {
      id: 'champion-2022',
      question: 'Who won?',
      scores: {},
      checkResults: [
        { id: 'check-includes', description: 'd', score: 1, passed: true },
        { id: 'llm-judge', description: 'j', score: 0, passed: false },
      ],
      answer: '',
      toolCalls: [],
      passed: false,
      durationMs: 1,
    };
    const read = withStatusDefaults(old);
    expect(read.status).toBe('failed');
    expect(read.checkResults.map((c) => c.status)).toEqual([
      'passed',
      'failed',
    ]);
    expect(read.category).toBeUndefined();
  });

  it('keeps statuses that are already there', () => {
    const current = result('a', 'out-of-scope', [check('not-scored', 'G2')]);
    expect(withStatusDefaults(current)).toEqual(current);
  });
});

describe('withResultDefaults (data-model 3.8, BA-242 read-time defaults)', () => {
  const old = {
    id: 'shot-conversion-2022',
    question: 'What share of shots were converted?',
    category: 'ratio',
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    status: 'passed' as const,
    passed: true,
    durationMs: 1,
  };

  it('reads a result saved before BA-242 as one attempt, its split from the question bank', () => {
    const read = withResultDefaults(old, (id) =>
      id === 'shot-conversion-2022' ? 'held-out' : undefined,
    );
    expect(read).toMatchObject({
      split: 'held-out',
      passes: 1,
      runs: 1,
      flaky: false,
      category: 'ratio',
    });
    expect(read).not.toHaveProperty('usage');
    expect(read).not.toHaveProperty('costUsd');
  });

  it('reads dev when the question bank has no case with its id', () => {
    expect(
      withResultDefaults({ ...old, passed: false, status: 'failed' }),
    ).toMatchObject({ split: 'dev', passes: 0, runs: 1 });
  });

  it('keeps the attempt counts and split already there', () => {
    const current = {
      ...old,
      split: 'dev' as const,
      passes: 2,
      runs: 3,
      flaky: true,
      status: 'failed' as const,
      passed: false,
    };
    expect(withResultDefaults(current, () => 'held-out')).toMatchObject({
      split: 'dev',
      passes: 2,
      runs: 3,
      flaky: true,
    });
  });

  it('is safe to map with as withStatusDefaults', () => {
    expect([old].map(withStatusDefaults)[0].split).toBe('dev');
  });
});

describe('summarizeEvalResults splits, flaky and intervals (R212, R213)', () => {
  const flakyHeldOut = {
    ...result('b', 'lookup', [check('failed', 'D1')], undefined, 'held-out'),
    passes: 2,
    runs: 3,
    flaky: true,
    attempts: [
      { checkResults: [check('passed', 'D1')] },
      { checkResults: [check('failed', 'D1')] },
      { checkResults: [check('passed', 'D1')] },
    ],
  };

  it('counts dev and held-out side by side, with flaky questions as failed', () => {
    const summary = summarizeEvalResults([
      result('a', 'lookup', [check('passed', 'D1')]),
      flakyHeldOut,
      result('c', 'ratio', [check('not-scored', 'G2')], undefined, 'held-out'),
    ]);
    expect(summary).toMatchObject({
      passed: 1,
      failed: 1,
      notScored: 1,
      flaky: 1,
    });
    expect(summary.bySplit.dev).toMatchObject(counts(1, 0, 0));
    expect(summary.bySplit.heldOut).toMatchObject(counts(0, 1, 1, 1));
    const lookup = summary.byCategory.find((e) => e.category === 'lookup');
    expect(lookup).toMatchObject({
      ...counts(1, 1, 0, 1),
      dev: counts(1, 0, 0),
      heldOut: counts(0, 1, 0, 1),
    });
  });

  it('gives each split the Wilson interval of passed over scored, and none when nothing was scored', () => {
    const summary = summarizeEvalResults([
      ...Array.from({ length: 9 }, (_, i) =>
        result(`p${i}`, 'lookup', [check('passed')]),
      ),
      result('f', 'lookup', [check('failed')]),
      result('n', 'lookup', [check('not-scored')]),
    ]);
    const interval = summary.bySplit.dev.interval!;
    // 9 of 10 scored; the not-scored question is in neither count.
    expect(interval.low).toBeCloseTo(0.596, 3);
    expect(interval.high).toBeCloseTo(0.982, 3);
    expect(summary.bySplit.heldOut).not.toHaveProperty('interval');
  });

  it('counts criteria over every attempt of a question', () => {
    const summary = summarizeEvalResults([flakyHeldOut]);
    expect(summary.byCriterion).toEqual([
      { criterion: 'D1', passed: 2, failed: 1, total: 3 },
    ]);
  });

  it('counts a result with no split as dev', () => {
    const summary = summarizeEvalResults([{ id: 'x', passed: true } as never]);
    expect(summary.bySplit.dev.passed).toBe(1);
  });
});

describe('split cells and lines (R216, R218)', () => {
  const summary = summarizeEvalResults([
    result('a', 'lookup', [check('passed')]),
    result('b', 'lookup', [check('failed')], undefined, 'dev'),
  ]);

  it('writes a split as passed over scored with its interval, or a dash', () => {
    expect(splitCell(summary.bySplit.dev)).toBe('1/2 (9–91%)');
    expect(splitCell(summary.bySplit.heldOut)).toBe('—');
  });

  it('writes the Dev and Held-out lines', () => {
    expect(splitLines(summary)).toEqual([
      'Dev: 1/2 passed · 95% interval 9–91%',
      'Held-out: 0/0 passed · 95% interval —',
    ]);
  });
});

describe('tokensText and costText (R218, R221)', () => {
  const entries: ModelUsageEntry[] = [
    {
      agent: 'assistant',
      model: 'gpt-4o-mini',
      inputTokens: 1_234_567,
      cachedInputTokens: 1_000,
      outputTokens: 2_345,
      reasoningTokens: 0,
      calls: 3,
      unreportedCalls: 0,
    },
    {
      agent: 'sql-fixer',
      model: 'gpt-4o-mini',
      inputTokens: 433,
      cachedInputTokens: 0,
      outputTokens: 55,
      reasoningTokens: 12,
      calls: 1,
      unreportedCalls: 2,
    },
  ];

  it('sums every agent, with thousands separators and the calls without usage', () => {
    expect(tokensText(entries)).toBe(
      '1,235,000 in (1,000 cached) · 2,400 out (12 reasoning) · 6 calls · 2 without usage',
    );
    expect(tokensText(entries.slice(0, 1))).toBe(
      '1,234,567 in (1,000 cached) · 2,345 out (0 reasoning) · 3 calls',
    );
    expect(tokensText([])).toBe(
      '0 in (0 cached) · 0 out (0 reasoning) · 0 calls',
    );
  });

  it('writes one call in the singular', () => {
    const one = { ...entries[0], calls: 1, unreportedCalls: 0 };
    expect(tokensText([one])).toBe(
      '1,234,567 in (1,000 cached) · 2,345 out (0 reasoning) · 1 call',
    );
    const unreported = { ...entries[0], calls: 0, unreportedCalls: 1 };
    expect(tokensText([unreported])).toBe(
      '1,234,567 in (1,000 cached) · 2,345 out (0 reasoning) · 1 call · 1 without usage',
    );
  });

  it('says not recorded with no usage', () => {
    expect(tokensText(undefined)).toBe('not recorded');
    expect(costText(undefined, undefined)).toBe('not recorded');
    expect(costText(0.5, undefined)).toBe('not recorded');
  });

  it('writes the cost to four decimals, per question when asked', () => {
    expect(costText(0.123456, entries)).toBe('$0.1235');
    expect(costText(0.123456, entries, undefined, 4)).toBe(
      '$0.1235 · $0.0309 per question',
    );
    expect(costText(0, [], undefined, 0)).toBe('$0.0000');
  });

  it('names the models with no rate, from the rates of the run when it has them', () => {
    const unpriced = [{ ...entries[0], model: 'llama-3' }, entries[1]];
    expect(costText(null, unpriced)).toBe('not priced (llama-3)');
    // A model priced now but missing from the run's snapshot.
    expect(costText(null, entries, {})).toBe('not priced (gpt-4o-mini)');
  });
});

describe('renderSummaryMarkdown (agents-evals R153)', () => {
  it('renders the By category and By criterion tables', () => {
    const lines = renderSummaryMarkdown(
      summarizeEvalResults([
        result('a', 'lookup', [check('passed', 'D1')]),
        result('b', 'out-of-scope', [check('not-scored', 'G2')]),
      ]),
    );
    const markdown = lines.join('\n');
    expect(markdown).toContain(
      [
        '## By category',
        '',
        '| Category | Dev | Held-out | Flaky | Not scored | Total |',
        '| --- | --- | --- | --- | --- | --- |',
        '| lookup | 1/1 (21–100%) | — | 0 | 0 | 1 |',
        '| out-of-scope | — | — | 0 | 1 | 1 |',
      ].join('\n'),
    );
    expect(markdown).toContain(
      [
        '## By criterion',
        '',
        '| Criterion | Passed | Failed | Total |',
        '| --- | --- | --- | --- |',
        '| D1 | 1 | 0 | 1 |',
      ].join('\n'),
    );
  });

  it('says so instead of an empty table', () => {
    const markdown = renderSummaryMarkdown(summarizeEvalResults([])).join('\n');
    expect(markdown).toContain('## By category\n\nNo finished questions yet.');
    expect(markdown).toContain(
      '## By criterion\n\nNo scored check names a criterion.',
    );
  });
});
