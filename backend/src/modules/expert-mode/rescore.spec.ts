import { withVerifiedMatch } from './rescore';
import type {
  ConfidenceSignal,
  MetricBlock,
  ReasoningTrace,
  SqlBlock,
} from './entities/reasoning-trace.entity';

function signal(
  id: ConfidenceSignal['id'],
  value: number,
  weight: number,
): ConfidenceSignal {
  return { id, label: id, value, weight, note: `measured ${id}` };
}

const SQL_BLOCK: SqlBlock = {
  kind: 'sql',
  sql: 'SELECT 1',
  annotations: [],
  confidence: {
    score: 0.5,
    band: 'medium',
    signals: [signal('execution', 0.5, 0.25)],
  },
};

const METRIC_BLOCK: MetricBlock = {
  kind: 'metric',
  name: 'Net revenue',
  formula: 'SUM(x)',
  grain: 'per order',
  basis: 'assumption',
  confidence: {
    score: 0.4,
    band: 'low',
    signals: [signal('knowledge_coverage', 0.4, 0.4)],
  },
};

function trace(overallSignals: ConfidenceSignal[] = []): ReasoningTrace {
  return {
    id: 'trace-1',
    version: 1,
    blocks: [SQL_BLOCK, METRIC_BLOCK],
    overall: {
      score: 0.62,
      band: 'medium',
      signals: overallSignals,
    },
    generatedAt: '2026-09-30T00:00:00.000Z',
  };
}

describe('withVerifiedMatch', () => {
  it('raises the sql and metric blocks — a verified match is worth more than either existing signal', () => {
    const result = withVerifiedMatch(trace());

    const sql = result.blocks.find((b) => b.kind === 'sql')!;
    const metric = result.blocks.find((b) => b.kind === 'metric')!;
    expect(sql.confidence.score).toBeGreaterThan(SQL_BLOCK.confidence.score);
    expect(metric.confidence.score).toBeGreaterThan(
      METRIC_BLOCK.confidence.score,
    );
    expect(
      sql.confidence.signals.filter((s) => s.id === 'verified_match'),
    ).toHaveLength(1);
    expect(sql.confidence.signals.find((s) => s.id === 'verified_match')?.value).toBe(1);
  });

  it('floors the overall score at 0.85 even with no cross-check evidence', () => {
    const result = withVerifiedMatch(trace());

    // Sanity: the raw weighted blend of the (raised) block scores is still
    // below the floor, so the assertion below is actually exercising it.
    const sql = result.blocks.find((b) => b.kind === 'sql')!;
    const metric = result.blocks.find((b) => b.kind === 'metric')!;
    const raw =
      (0.3 * sql.confidence.score + 0.1 * metric.confidence.score) / 0.4;
    expect(raw).toBeLessThan(0.85);

    expect(result.overall.score).toBe(0.85);
    expect(result.overall.band).toBe('high');
  });

  it('keeps the disagree-cap-then-floor order: a disagreeing cross-check still ends up floored at 0.85', () => {
    const disagreeing = trace([signal('cross_check', 0, 0.3)]);

    const result = withVerifiedMatch(disagreeing);

    // cap(0.5) then floor(0.85) — the floor wins, exactly as overallConfidence orders it.
    expect(result.overall.score).toBe(0.85);
    expect(result.overall.band).toBe('high');
  });

  it('recovers "agree" from an existing cross_check signal of 1 without capping', () => {
    const agreeing = trace([signal('cross_check', 1, 0.3)]);

    const result = withVerifiedMatch(agreeing);

    expect(result.overall.score).toBe(0.85);
  });

  it('is idempotent — applying it twice matches applying it once', () => {
    const once = withVerifiedMatch(trace());
    const twice = withVerifiedMatch(once);

    expect(twice).toEqual(once);
    const sqlOnce = once.blocks.find((b) => b.kind === 'sql')!;
    const sqlTwice = twice.blocks.find((b) => b.kind === 'sql')!;
    expect(
      sqlTwice.confidence.signals.filter((s) => s.id === 'verified_match'),
    ).toHaveLength(1);
    expect(sqlTwice.confidence.signals).toHaveLength(
      sqlOnce.confidence.signals.length,
    );
  });

  it('adds a verified_match entry to the overall signals with the sql block\'s weight', () => {
    const result = withVerifiedMatch(trace());
    const overallVerified = result.overall.signals.find(
      (s) => s.id === 'verified_match',
    );
    expect(overallVerified?.value).toBe(1);
    expect(overallVerified?.note).toMatch(/floors the overall confidence/);
  });
});
