import { BadRequestException } from '@nestjs/common';
import { parseUsageQuery } from './dto/usage-query';
import { estimateCostUsd } from './model-prices';
import {
  DELETED_WORKFLOW_NAME,
  NO_AGENT_NAME,
  NO_WORKFLOW_NAME,
  dayKey,
  median,
  percentile,
  runIdOf,
  summarizeUsage,
  type UsageCallRecord,
} from './usage-summary';

const MODEL = 'claude-sonnet-5-5';

function call(
  startedAt: string,
  over: Partial<UsageCallRecord> = {},
): UsageCallRecord {
  return {
    startedAt,
    traceId: `t-${startedAt}`,
    agentId: 'assistant',
    agentName: 'Assistant',
    sessionId: 'chat-1',
    model: MODEL,
    provider: 'anthropic',
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  };
}

const ONE_CALL = estimateCostUsd(MODEL, {
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}) as number;

const NOW = new Date('2026-11-15T12:00:00Z');
const RUNS = new Map([
  [
    'r1',
    {
      workflowId: 'wf-answer',
      workflowName: 'Answer a Business Question',
      title: 'Top scorers?',
    },
  ],
]);

describe('summarizeUsage (Costs)', () => {
  it('prices the test model', () => {
    expect(ONE_CALL).toBeGreaterThan(0);
  });

  it('sums today, this month, the period and the 12 months', () => {
    const summary = summarizeUsage({
      rows: [
        call('2026-11-15T09:00:00Z'),
        call('2026-11-14T09:00:00Z'),
        call('2026-10-31T09:00:00Z'),
        call('2025-12-01T09:00:00Z'),
        call('2025-11-30T09:00:00Z'), // 13 months back: outside the series
      ],
      from: new Date('2026-11-01T00:00:00Z'),
      to: NOW,
      now: NOW,
      timeZone: 'UTC',
      runs: RUNS,
    });

    expect(summary.today).toEqual({ costUsd: ONE_CALL, calls: 1 });
    expect(summary.thisMonth.calls).toBe(2);
    expect(summary.totals.calls).toBe(2);
    expect(summary.totals.pricedCalls).toBe(2);
    expect(summary.totals.costUsd).toBeCloseTo(2 * ONE_CALL);
    expect(summary.totals.inputTokens).toBe(2_000_000);

    expect(summary.monthly).toHaveLength(12);
    expect(summary.monthly[0].month).toBe('2025-12');
    expect(summary.monthly[11]).toEqual({
      month: '2026-11',
      costUsd: 2 * ONE_CALL,
      calls: 2,
    });
    expect(summary.monthly[10]).toEqual({
      month: '2026-10',
      costUsd: ONE_CALL,
      calls: 1,
    });
    expect(summary.monthly[0].calls).toBe(1);
  });

  it('fills every day of the period, days without calls at 0', () => {
    const summary = summarizeUsage({
      rows: [call('2026-11-14T09:00:00Z')],
      from: new Date('2026-11-12T00:00:00Z'),
      to: NOW,
      now: NOW,
      timeZone: 'UTC',
      runs: RUNS,
    });
    expect(summary.daily.map((d) => [d.date, d.calls])).toEqual([
      ['2026-11-12', 0],
      ['2026-11-13', 0],
      ['2026-11-14', 1],
      ['2026-11-15', 0],
    ]);
  });

  it('starts an all-time series on the first call', () => {
    const summary = summarizeUsage({
      rows: [call('2026-11-14T09:00:00Z')],
      from: null,
      to: NOW,
      now: NOW,
      timeZone: 'UTC',
      runs: RUNS,
    });
    expect(summary.from).toBeNull();
    expect(summary.daily.map((d) => d.date)).toEqual([
      '2026-11-14',
      '2026-11-15',
    ]);
  });

  it('buckets days in the requested time zone', () => {
    // 03:00 UTC on the 15th is still the 14th in Bogotá (UTC-5).
    expect(dayKey(new Date('2026-11-15T03:00:00Z'), 'America/Bogota')).toBe(
      '2026-11-14',
    );
    const summary = summarizeUsage({
      rows: [call('2026-11-15T03:00:00Z')],
      from: null,
      to: NOW,
      now: NOW,
      timeZone: 'America/Bogota',
      runs: RUNS,
    });
    expect(summary.today.calls).toBe(0);
    expect(summary.daily[0]).toEqual({
      date: '2026-11-14',
      costUsd: ONE_CALL,
      calls: 1,
    });
  });

  it('groups by model, workflow and agent, highest cost first', () => {
    const summary = summarizeUsage({
      rows: [
        call('2026-11-15T09:00:00Z', { sessionId: 'run-r1' }),
        // A step agent's own thread belongs to the same run (agent-threads.ts).
        call('2026-11-15T09:01:00Z', {
          sessionId: 'run-r1:insights-analyst',
          agentId: 'writer',
          agentName: 'Answer Writer',
        }),
        call('2026-11-15T09:02:00Z', { sessionId: 'run-gone' }),
        call('2026-11-15T09:03:00Z', {
          sessionId: null,
          agentId: null,
          agentName: null,
        }),
        call('2026-11-15T09:04:00Z', {
          model: 'local-llama',
          provider: 'custom',
        }),
      ],
      from: null,
      to: NOW,
      now: NOW,
      timeZone: 'UTC',
      runs: RUNS,
    });

    expect(summary.totals.calls).toBe(5);
    expect(summary.totals.pricedCalls).toBe(4);

    expect(summary.byModel).toEqual([
      expect.objectContaining({ model: MODEL, calls: 4, priced: true }),
      expect.objectContaining({
        model: 'local-llama',
        provider: 'custom',
        calls: 1,
        costUsd: 0,
        priced: false,
      }),
    ]);

    expect(summary.byWorkflow).toEqual([
      {
        id: 'wf-answer',
        name: 'Answer a Business Question',
        kind: 'workflow',
        costUsd: 2 * ONE_CALL,
        calls: 2,
        runs: 1,
        avgCostUsd: 2 * ONE_CALL,
        medianCostUsd: 2 * ONE_CALL,
        p95CostUsd: 2 * ONE_CALL,
      },
      {
        id: null,
        name: NO_WORKFLOW_NAME,
        kind: 'none',
        costUsd: ONE_CALL,
        calls: 2,
        runs: null,
        avgCostUsd: null,
        medianCostUsd: null,
        p95CostUsd: null,
      },
      {
        id: null,
        name: DELETED_WORKFLOW_NAME,
        kind: 'workflow',
        costUsd: ONE_CALL,
        calls: 1,
        runs: 1,
        avgCostUsd: ONE_CALL,
        medianCostUsd: ONE_CALL,
        p95CostUsd: ONE_CALL,
      },
    ]);

    expect(summary.byAgent.map((a) => [a.id, a.name, a.calls])).toEqual([
      ['assistant', 'Assistant', 3],
      ['writer', 'Answer Writer', 1],
      [null, NO_AGENT_NAME, 1],
    ]);
  });

  it('costs each run and each question outside runs, and lists the top runs', () => {
    const summary = summarizeUsage({
      rows: [
        // Run r1: two calls (host and a step agent) = 2 units.
        call('2026-11-15T08:00:00Z', { sessionId: 'run-r1' }),
        call('2026-11-15T08:05:00Z', { sessionId: 'run-r1:planner' }),
        // Run r2 (deleted): one call.
        call('2026-11-15T09:00:00Z', { sessionId: 'run-r2' }),
        // One chat question (trace q1) with two calls, one with none (q2).
        call('2026-11-15T10:00:00Z', { traceId: 'q1' }),
        call('2026-11-15T10:01:00Z', { traceId: 'q1' }),
        call('2026-11-15T10:02:00Z', { traceId: 'q2', sessionId: null }),
      ],
      from: null,
      to: NOW,
      now: NOW,
      timeZone: 'UTC',
      runs: RUNS,
    });

    expect(summary.perRun.count).toBe(2);
    expect(summary.perRun.avgCostUsd).toBeCloseTo(1.5 * ONE_CALL);
    expect(summary.perQuestion.count).toBe(2);
    expect(summary.perQuestion.avgCostUsd).toBeCloseTo(1.5 * ONE_CALL);

    expect(summary.topRuns).toEqual([
      {
        runId: 'r1',
        workflowId: 'wf-answer',
        workflowName: 'Answer a Business Question',
        title: 'Top scorers?',
        startedAt: '2026-11-15T08:00:00.000Z',
        costUsd: 2 * ONE_CALL,
        calls: 2,
      },
      {
        runId: 'r2',
        workflowId: null,
        workflowName: DELETED_WORKFLOW_NAME,
        title: null,
        startedAt: '2026-11-15T09:00:00.000Z',
        costUsd: ONE_CALL,
        calls: 1,
      },
    ]);
  });

  it('splits the cost by token kind and counts what the cache saved', () => {
    const summary = summarizeUsage({
      rows: [
        call('2026-11-15T09:00:00Z', {
          inputTokens: 1_000_000,
          cacheReadTokens: 600_000,
          cacheWriteTokens: 100_000,
          outputTokens: 10_000,
        }),
      ],
      from: null,
      to: NOW,
      now: NOW,
      timeZone: 'UTC',
      runs: RUNS,
    });
    const { split, totals } = summary;
    expect(split.inputTokens).toBe(300_000);
    expect(split.cacheReadTokens).toBe(600_000);
    expect(split.cacheWriteTokens).toBe(100_000);
    expect(split.outputTokens).toBe(10_000);
    expect(
      split.inputUsd +
        split.cacheReadUsd +
        split.cacheWriteUsd +
        split.outputUsd,
    ).toBeCloseTo(totals.costUsd, 12);
    expect(split.cacheSavedUsd).toBeGreaterThan(split.cacheReadUsd);
  });
});

describe('run ids and statistics', () => {
  it('reads the run of a host or step-agent thread', () => {
    expect(runIdOf('run-abc')).toBe('abc');
    expect(runIdOf('run-abc:insights-analyst')).toBe('abc');
    expect(runIdOf('chat-1')).toBeNull();
    expect(runIdOf(null)).toBeNull();
    expect(runIdOf('run-')).toBeNull();
  });

  it('takes the median and the nearest-rank percentile', () => {
    expect(median([])).toBe(0);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(19);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('parseUsageQuery', () => {
  it('defaults to now and UTC', () => {
    expect(parseUsageQuery({}, NOW)).toEqual({
      from: null,
      to: NOW,
      timeZone: 'UTC',
    });
  });

  it.each([
    [{ from: 'nope' }, 'From is not a valid date'],
    [{ to: 'nope' }, 'To is not a valid date'],
    [{ from: '2026-11-15', to: '2026-11-01' }, 'From must not be after To'],
    [{ tz: 'Mars/Olympus' }, 'Time zone is not valid'],
  ])('rejects %j with 400', (query, message) => {
    expect(() => parseUsageQuery(query)).toThrow(
      new BadRequestException(message),
    );
  });
});
