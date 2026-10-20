import {
  AgentEvalCaseResult,
  EvalCheckResult,
  EvalRunSummary,
  EvalRunView,
} from './agents-api.service';
import {
  EVAL_STATUS_LABELS,
  checkStatus,
  evalRunSummary,
  formatCost,
  resultCostLabel,
  resultFlaky,
  resultPasses,
  resultRuns,
  resultSplit,
  resultStatus,
  runCost,
  runFlakyCount,
  runRepeats,
  splitCell,
  splitLine,
  usageLabel,
  runCounts,
  runHeadline,
  runVerdict,
} from './eval-run.util';

function check(over: Partial<EvalCheckResult> = {}): EvalCheckResult {
  return {
    id: 'check-includes',
    description: 'Checks if output includes "Argentina"',
    score: 1,
    passed: true,
    ...over,
  };
}

function result(over: Partial<AgentEvalCaseResult> = {}): AgentEvalCaseResult {
  return {
    id: 'champion-2022',
    question: 'Who won the 2022 World Cup?',
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    passed: true,
    durationMs: 10,
    ...over,
  };
}

function run(over: Partial<EvalRunView> = {}): EvalRunView {
  return {
    jobId: 'job-1',
    agentKey: 'assistant',
    datasourceId: 'ds-1',
    datasets: ['World Cup Core'],
    caseIds: [],
    status: 'completed',
    results: [],
    totalCases: 0,
    startedAt: '2026-10-13T10:00:00.000Z',
    ...over,
  };
}

const JUDGE_OFF = check({
  id: 'llm-judge',
  description: 'LLM judge: says it cannot answer for 1970',
  score: 0,
  passed: false,
  status: 'not-scored',
  reason: 'Judge off for this run',
});

describe('eval run statuses', () => {
  it('labels each status as the Evals tab prints it', () => {
    expect(EVAL_STATUS_LABELS).toEqual({
      passed: 'Passed',
      failed: 'Failed',
      'not-scored': 'Not scored',
    });
  });

  it('reads a check status, or derives it from passed on older runs', () => {
    expect(checkStatus(JUDGE_OFF)).toBe('not-scored');
    expect(checkStatus(check({ status: 'failed', passed: false }))).toBe(
      'failed',
    );
    expect(checkStatus(check())).toBe('passed');
    expect(checkStatus(check({ passed: false }))).toBe('failed');
  });

  it('reads a question status, or derives it from passed on older runs', () => {
    expect(resultStatus(result({ status: 'not-scored', passed: false }))).toBe(
      'not-scored',
    );
    expect(resultStatus(result())).toBe('passed');
    expect(resultStatus(result({ passed: false }))).toBe('failed');
  });
});

describe('eval run headline and verdict', () => {
  const mixed = [
    result({ id: 'a', status: 'passed' }),
    result({ id: 'b', status: 'failed', passed: false }),
    result({ id: 'c', status: 'not-scored', passed: false }),
  ];

  it('counts each status', () => {
    expect(runCounts(mixed)).toEqual({ passed: 1, failed: 1, notScored: 1 });
  });

  it('adds the not-scored count only when there is one', () => {
    expect(runHeadline(mixed, 3)).toBe('1/3 passed · 1 not scored');
    expect(runHeadline([result()], 2)).toBe('1/2 passed');
    expect(runHeadline([], 10)).toBe('0/10 passed');
  });

  it('gives a run a tick, a cross, or the neutral mark', () => {
    expect(runVerdict(run({ status: 'running' }))).toBe('running');
    expect(runVerdict(run({ results: [result()], totalCases: 1 }))).toBe(
      'passed',
    );
    expect(runVerdict(run({ results: mixed, totalCases: 3 }))).toBe('failed');
    // Nothing failed, one not scored.
    expect(
      runVerdict(
        run({
          results: [result(), result({ status: 'not-scored', passed: false })],
          totalCases: 2,
        }),
      ),
    ).toBe('not-scored');
    // A run that stopped short failed, whatever its results say.
    expect(
      runVerdict(run({ status: 'failed', results: [result()], totalCases: 2 })),
    ).toBe('failed');
  });
});

describe('evalRunSummary', () => {
  const stored: EvalRunSummary = {
    passed: 1,
    failed: 0,
    notScored: 1,
    byCategory: [
      { category: 'lookup', passed: 1, failed: 0, notScored: 0, total: 1 },
    ],
    byCriterion: [{ criterion: 'G1', passed: 1, failed: 1, total: 2 }],
  };

  it('uses the summary the backend sent once a question has finished', () => {
    expect(evalRunSummary(run({ results: [result()], summary: stored }))).toBe(
      stored,
    );
  });

  it('follows a run that is still going', () => {
    expect(
      evalRunSummary(
        run({ status: 'running', results: [result()], summary: stored }),
      ),
    ).toBe(stored);
  });

  it('shows nothing before the first question finishes', () => {
    expect(evalRunSummary(run({ status: 'running', summary: stored }))).toBe(
      null,
    );
  });

  it('shows nothing when a run carries no summary', () => {
    expect(evalRunSummary(run({ results: [result()] }))).toBeNull();
  });
});

describe('repeats, split and cost helpers', () => {
  const none = { passed: 0, failed: 0, notScored: 0, flaky: 0, total: 0 };

  it('reads a run saved before repeats as one attempt', () => {
    expect(runRepeats(run())).toBe(1);
    expect(runRepeats(run({ repeats: 3 }))).toBe(3);
    expect(resultRuns(result())).toBe(1);
    expect(resultPasses(result())).toBe(1);
    expect(resultPasses(result({ passed: false, status: 'failed' }))).toBe(0);
    expect(resultPasses(result({ passes: 2, runs: 3 }))).toBe(2);
    expect(resultFlaky(result())).toBeFalse();
    expect(resultSplit(result())).toBe('dev');
    expect(resultSplit(result({ split: 'held-out' }))).toBe('held-out');
  });

  it('counts flaky questions from the summary, else the results', () => {
    expect(
      runFlakyCount(
        run({
          results: [result({ flaky: true }), result({ id: 'b' })],
        }),
      ),
    ).toBe(1);
    expect(
      runFlakyCount(
        run({
          results: [],
          summary: {
            passed: 0,
            failed: 0,
            notScored: 0,
            flaky: 4,
            byCategory: [],
            byCriterion: [],
          },
        }),
      ),
    ).toBe(4);
  });

  it('prices a run to four decimals, or says Not priced', () => {
    expect(formatCost(0.5)).toBe('$0.5000');
    expect(runCost(run())).toBeNull();
    expect(runCost(run({ costUsd: 0.01234 }))).toEqual({
      label: '$0.0123',
      priced: true,
      title: null,
    });
    const usage = (model: string) => ({
      agent: 'assistant' as const,
      model,
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      calls: 1,
      unreportedCalls: 0,
    });
    expect(
      runCost(
        run({
          costUsd: null,
          usage: [usage('gpt-4o-mini'), usage('acme-1')],
          rates: {
            'gpt-4o-mini': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
          },
        }),
      ),
    ).toEqual({
      label: 'Not priced',
      priced: false,
      title: 'No price for acme-1',
    });
    expect(runCost(run({ costUsd: null }))?.title).toBeNull();
    expect(resultCostLabel(result())).toBeNull();
    expect(resultCostLabel(result({ costUsd: null }))).toBe('Not priced');
    expect(resultCostLabel(result({ costUsd: 0.002 }))).toBe('$0.0020');
  });

  it('formats a split as passed/scored with its interval, or a dash', () => {
    expect(
      splitCell({
        passed: 20,
        failed: 5,
        notScored: 2,
        flaky: 0,
        total: 27,
        interval: { low: 0.609, high: 0.911 },
      }),
    ).toBe('20/25 (61–91%)');
    expect(splitCell({ ...none, notScored: 1, total: 1 })).toBe('—');
    expect(splitCell(undefined)).toBe('—');
  });

  it('writes the split line, with — for a side with nothing scored', () => {
    const base = {
      passed: 0,
      failed: 0,
      notScored: 0,
      byCategory: [],
      byCriterion: [],
    };
    expect(
      splitLine({
        ...base,
        bySplit: {
          dev: {
            passed: 20,
            failed: 5,
            notScored: 0,
            flaky: 0,
            total: 25,
            interval: { low: 0.61, high: 0.91 },
          },
          heldOut: none,
        },
      }),
    ).toBe('Dev 20/25 (61–91%) · Held-out —');
    expect(splitLine(base)).toBeNull();
  });

  it('labels token use, leaving out zero cached and reasoning parts', () => {
    const entry = {
      agent: 'assistant' as const,
      model: 'gpt-4o-mini',
      inputTokens: 12345,
      cachedInputTokens: 0,
      outputTokens: 678,
      reasoningTokens: 0,
      calls: 2,
      unreportedCalls: 0,
    };
    expect(usageLabel(entry)).toBe('12,345 in · 678 out');
    expect(
      usageLabel({
        ...entry,
        cachedInputTokens: 1000,
        reasoningTokens: 50,
        unreportedCalls: 1,
      }),
    ).toBe(
      '12,345 in · 1,000 cached · 678 out · 50 reasoning · 1 call reported no usage',
    );
    expect(usageLabel({ ...entry, unreportedCalls: 2 })).toContain(
      '2 calls reported no usage',
    );
  });
});
