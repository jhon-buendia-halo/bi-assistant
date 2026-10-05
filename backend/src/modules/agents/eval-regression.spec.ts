import {
  computeRegressionDiff,
  type ComparableCaseResult,
} from './eval-regression';

function result(
  id: string,
  passed: boolean,
  question = `question ${id}`,
): ComparableCaseResult {
  return { id, question, passed };
}

describe('computeRegressionDiff', () => {
  it('reports no regressions/improvements when both runs pass', () => {
    const previous = [result('a', true), result('b', true)];
    const current = [result('a', true), result('b', true)];

    const diff = computeRegressionDiff(previous, current);

    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(diff.unchanged.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('flags a case that passed before and fails now as a regression', () => {
    const previous = [result('a', true)];
    const current = [result('a', false)];

    const diff = computeRegressionDiff(previous, current);

    expect(diff.regressions).toEqual([{ id: 'a', question: 'question a' }]);
    expect(diff.improvements).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('flags a case that failed before and passes now as an improvement', () => {
    const previous = [result('a', false)];
    const current = [result('a', true)];

    const diff = computeRegressionDiff(previous, current);

    expect(diff.improvements).toEqual([{ id: 'a', question: 'question a' }]);
    expect(diff.regressions).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('treats two failing runs as unchanged, not a regression', () => {
    const previous = [result('a', false)];
    const current = [result('a', false)];

    const diff = computeRegressionDiff(previous, current);

    expect(diff.unchanged).toEqual([{ id: 'a', question: 'question a' }]);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
  });

  it('skips cases that only exist in one of the two runs', () => {
    const previous = [result('a', true), result('old-case', false)];
    const current = [result('a', true), result('new-case', true)];

    const diff = computeRegressionDiff(previous, current);

    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(diff.unchanged.map((d) => d.id)).toEqual(['a']);
  });

  it('computes a mixed diff across several cases', () => {
    const previous = [
      result('champion-2022', true),
      result('final-score-2018', true),
      result('top-scorer-2022', false),
      result('shootouts', false),
    ];
    const current = [
      result('champion-2022', true), // unchanged (pass)
      result('final-score-2018', false), // regression
      result('top-scorer-2022', true), // improvement
      result('shootouts', false), // unchanged (fail)
    ];

    const diff = computeRegressionDiff(previous, current);

    expect(diff.regressions).toEqual([
      { id: 'final-score-2018', question: 'question final-score-2018' },
    ]);
    expect(diff.improvements).toEqual([
      { id: 'top-scorer-2022', question: 'question top-scorer-2022' },
    ]);
    expect(diff.unchanged.map((d) => d.id)).toEqual([
      'champion-2022',
      'shootouts',
    ]);
  });

  it('returns empty diffs for two empty runs', () => {
    const diff = computeRegressionDiff([], []);

    expect(diff).toEqual({
      regressions: [],
      improvements: [],
      unchanged: [],
      unmeasured: [],
      flakyChanges: [],
    });
  });
});

describe('computeRegressionDiff — pass^k verdicts', () => {
  function v(
    id: string,
    verdict: ComparableCaseResult['verdict'],
    flaky = false,
  ): ComparableCaseResult {
    // `passed` deliberately disagrees: the verdict must win when present.
    return { id, question: `question ${id}`, passed: verdict !== 'PASS', verdict, flaky };
  }

  it('reads the pass^k verdict, not `passed`, when a result carries one', () => {
    const diff = computeRegressionDiff(
      [v('a', 'PASS'), v('b', 'FAIL'), v('c', 'ERROR')],
      [v('a', 'FAIL', true), v('b', 'PASS'), v('c', 'PASS')],
    );
    expect(diff.regressions.map((d) => d.id)).toEqual(['a']);
    expect(diff.improvements.map((d) => d.id)).toEqual(['b', 'c']);
  });

  it('compares a pass^k run against a run recorded before pass^k', () => {
    const diff = computeRegressionDiff(
      [
        { id: 'a', question: 'q', passed: true },
        { id: 'b', question: 'q', passed: false, error: 'timeout' },
      ],
      [v('a', 'FAIL'), v('b', 'PASS')],
    );
    expect(diff.regressions.map((d) => d.id)).toEqual(['a']);
    expect(diff.improvements.map((d) => d.id)).toEqual(['b']);
  });

  it('treats GAP and SKIP as unmeasured — neither better nor worse', () => {
    const diff = computeRegressionDiff(
      [v('a', 'PASS'), v('b', 'GAP'), v('c', 'FAIL')],
      [v('a', 'GAP'), v('b', 'PASS'), v('c', 'SKIP')],
    );
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(diff.unmeasured.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('flags cases whose flakiness changed either way', () => {
    const diff = computeRegressionDiff(
      [v('a', 'FAIL', true), v('b', 'FAIL', false), v('c', 'FAIL', true)],
      [v('a', 'PASS', false), v('b', 'FAIL', true), v('c', 'FAIL', true)],
    );
    expect(diff.flakyChanges.map((d) => d.id)).toEqual(['a', 'b']);
  });
});
