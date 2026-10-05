import { resolveEngineOptions } from '../engine/engine-options';
import { buildLogCase, buildRunLogRecordV2 } from './eval-run-record';
import type { EvalRunLogAttempt, TokenUsage } from './eval-telemetry';

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  calls: 1,
});

const attempt = (
  n: number,
  verdict: EvalRunLogAttempt['verdict'],
  extra: Partial<EvalRunLogAttempt> = {},
): EvalRunLogAttempt => ({
  attempt: n,
  verdict,
  checks:
    verdict === 'PASS'
      ? [{ id: 'result-set-match', passed: true }]
      : [{ id: 'result-set-match', passed: false, reason: 'rows differ' }],
  sql: [],
  steps: 2,
  calledTools: ['run_readonly_sql'],
  repairs: [],
  warnings: [],
  answer: 'An answer.',
  durationMs: 1000,
  usage: usage(1000, 100),
  ...extra,
});

const pricing = {
  model: 'openai/gpt-5',
  table: { 'gpt-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 10 } },
};

describe('buildLogCase', () => {
  it('folds attempts into pass^k, sums usage and prices the case', () => {
    const logCase = buildLogCase(
      { id: 'denial-rate', category: 'metric-definition', difficulty: 'hard' },
      [attempt(1, 'PASS'), attempt(2, 'FAIL'), attempt(3, 'PASS')],
      pricing,
    );
    expect(logCase).toMatchObject({
      id: 'denial-rate',
      category: 'metric-definition',
      difficulty: 'hard',
      verdict: 'FAIL',
      runs: 3,
      passes: 2,
      flaky: true,
      reason: 'result-set-match',
      durationMs: 3000,
    });
    expect(logCase.usage?.totalTokens).toBe(3300);
    // 3000 in × $1/M + 300 out × $10/M
    expect(logCase.estimatedCostUsd).toBeCloseTo(0.006, 6);
  });

  it('marks an errored representative attempt as a run error and never prices unobserved usage', () => {
    const logCase = buildLogCase(
      { id: 'x' },
      [attempt(1, 'ERROR', { usage: undefined, error: 'timeout' })],
      pricing,
    );
    expect(logCase.verdict).toBe('ERROR');
    expect(logCase.reason).toBe('run-error');
    expect(logCase.usage).toBeUndefined();
    expect(logCase.estimatedCostUsd).toBeUndefined();
  });
});

describe('buildRunLogRecordV2', () => {
  const engine = resolveEngineOptions();
  const base = {
    runId: '11111111-2222-3333-4444-555555555555',
    harness: 'in-app' as const,
    suite: 'health-insurance',
    datasets: ['Health Insurance'],
    model: 'openai/gpt-5',
    repeat: 3,
    arm: 'baseline',
    engine,
    configHash: 'abc123def456',
    startedAt: '2026-09-23T10:00:00.000Z',
    finishedAt: '2026-09-23T10:05:00.000Z',
    status: 'completed' as const,
    environment: { appVersion: '0.10.1', gitCommit: 'f04defd' },
  };

  it('totals verdicts, excludes gaps from the rate and prices the run', () => {
    const cases = [
      buildLogCase({ id: 'a', category: 'control' }, [attempt(1, 'PASS')], pricing),
      buildLogCase({ id: 'b', category: 'ratio-trap' }, [attempt(1, 'FAIL')], pricing),
      buildLogCase(
        { id: 'c', category: 'ratio-trap' },
        [attempt(1, 'GAP', { usage: undefined })],
        pricing,
      ),
    ];
    const record = buildRunLogRecordV2({
      ...base,
      cases,
      notReached: 1,
      pricing: pricing.table,
    });
    expect(record.schemaVersion).toBe(2);
    expect(record.totals).toEqual({
      cases: 4,
      passed: 1,
      failed: 1,
      errored: 0,
      gaps: 1,
      skipped: 1,
    });
    expect(record.summary.passK).toBe(1);
    expect(record.summary.scored).toBe(2);
    expect(record.summary.passKRate).toBeCloseTo(0.5);
    expect(record.durationMs).toBe(300_000);
    expect(record.estimatedCostUsd).toBeCloseTo(0.004, 6);
    expect(record.costIncomplete).toBeUndefined();
    expect(record.categories['ratio-trap']).toEqual({ total: 1, passed: 0 });
    expect(record.gitCommit).toBe('f04defd');
  });

  it('reports an unpriced run as incomplete rather than free', () => {
    const record = buildRunLogRecordV2({
      ...base,
      cases: [buildLogCase({ id: 'a' }, [attempt(1, 'PASS')])],
      pricing: {},
    });
    expect(record.estimatedCostUsd).toBeUndefined();
    expect(record.costIncomplete).toBe(true);
    expect(record.usage.calls).toBe(1);
  });
});
