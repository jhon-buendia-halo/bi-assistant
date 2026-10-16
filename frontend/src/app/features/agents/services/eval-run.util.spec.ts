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
  resultStatus,
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
