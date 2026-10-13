import {
  checkStatusOf,
  questionStatus,
  renderSummaryMarkdown,
  summarizeEvalResults,
  withStatusDefaults,
} from './eval-summary';
import type { EvalStatus } from './eval-summary';

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
) {
  const status = questionStatus(checks, error);
  return {
    id,
    question: `question ${id}`,
    ...(category ? { category } : {}),
    scores: {},
    checkResults: checks,
    answer: '',
    toolCalls: [],
    status,
    passed: status === 'passed',
    ...(error ? { error } : {}),
    durationMs: 1,
  };
}

describe('questionStatus (agents-evals R103)', () => {
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

describe('summarizeEvalResults (agents-evals R104)', () => {
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
      { category: 'lookup', passed: 1, failed: 2, notScored: 0, total: 3 },
      { category: 'join', passed: 0, failed: 1, notScored: 0, total: 1 },
      {
        category: 'out-of-scope',
        passed: 0,
        failed: 0,
        notScored: 1,
        total: 1,
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
      byCategory: [],
      byCriterion: [],
    });
    expect(
      summarizeEvalResults([{ id: 'x', passed: true } as never]),
    ).toMatchObject({ passed: 1, byCriterion: [] });
  });
});

describe('withStatusDefaults (agents-evals R103, old records)', () => {
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

describe('renderSummaryMarkdown (agents-evals R109)', () => {
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
        '| Category | Passed | Failed | Not scored | Total |',
        '| --- | --- | --- | --- | --- |',
        '| lookup | 1 | 0 | 0 | 1 |',
        '| out-of-scope | 0 | 0 | 1 | 1 |',
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
