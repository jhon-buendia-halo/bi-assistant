import { DIMENSIONS, GATES, WEIGHTS } from './rubric';
import type {
  DimensionResult,
  GateResult,
  GateStatus,
  ReadinessDimension,
  ReadinessLevel,
  ReadinessUseType,
} from './readiness.types';
import { buildConditions, decideVerdict, weightedScore } from './verdict';

function dims(
  levels: Partial<Record<ReadinessDimension, ReadinessLevel>>,
  useType: ReadinessUseType = 'analytics',
): DimensionResult[] {
  return DIMENSIONS.map((d) => {
    const weight = WEIGHTS[useType][d];
    return {
      dimension: d,
      applicable: weight !== null,
      level: weight === null ? 'N/E' : (levels[d] ?? 3),
      weight,
      reason: `${d} reason`,
      evidenceIds: ['EV-001'],
    };
  });
}

function gates(status: Partial<Record<string, GateStatus>> = {}): GateResult[] {
  return GATES.map((g) => ({
    gate: g,
    status: status[g] ?? 'pass',
    reason: '',
    evidenceIds: ['EV-001'],
  }));
}

describe('rubric 3.5 weights', () => {
  it.each(Object.keys(WEIGHTS) as ReadinessUseType[])(
    'the %s weights sum to 1',
    (useType) => {
      const sum = Object.values(WEIGHTS[useType]).reduce<number>(
        (s, w) => s + (w ?? 0),
        0,
      );
      expect(sum).toBeCloseTo(1, 10);
    },
  );

  it('D6 applies only to ML and RAG / agent uses', () => {
    expect(WEIGHTS.analytics.D6).toBeNull();
    expect(WEIGHTS.dashboard.D6).toBeNull();
    expect(WEIGHTS.ml.D6).toBe(0.25);
    expect(WEIGHTS['rag-agent'].D6).toBe(0.2);
  });
});

describe('rubric 3.6 verdict', () => {
  it('ready: every gate passes and no applicable dimension is below 3', () => {
    expect(decideVerdict(gates(), dims({ D1: 4 }), []).verdict).toBe('ready');
  });

  it('ready-with-conditions: every gate passes, none below 2, level-2 dimensions mitigated', () => {
    const d = dims({ D2: 2, D4: 2 });
    expect(decideVerdict(gates(), d, ['D2', 'D4']).verdict).toBe(
      'ready-with-conditions',
    );
  });

  it('a level-2 dimension without a documented mitigation is not ready', () => {
    expect(decideVerdict(gates(), dims({ D2: 2 }), []).verdict).toBe(
      'not-ready',
    );
  });

  it('a failed gate is not ready even when every dimension is 4 (gates override averages)', () => {
    const all4 = dims({ D1: 4, D2: 4, D3: 4, D4: 4, D5: 4 });
    const d = decideVerdict(gates({ G4: 'fail' }), all4, []);
    expect(d.verdict).toBe('not-ready');
    expect(d.reasons.join(' ')).toContain('G4');
    expect(weightedScore(all4).score).toBe(4);
  });

  it('an applicable dimension below 2 is not ready, whatever the average', () => {
    const d = dims({ D1: 4, D2: 4, D3: 4, D4: 4, D5: 1 });
    expect(weightedScore(d).score).toBeGreaterThan(3.5);
    expect(decideVerdict(gates(), d, []).verdict).toBe('not-ready');
  });

  it('a critical dimension (>= 20%) in N/E is not ready', () => {
    expect(decideVerdict(gates(), dims({ D2: 'N/E' }), []).verdict).toBe(
      'not-ready',
    );
  });

  it('a non-critical dimension in N/E does not block ready (table 3.6 read literally)', () => {
    expect(decideVerdict(gates(), dims({ D1: 'N/E' }), []).verdict).toBe(
      'ready',
    );
  });

  it('never rounds up: a gate not evaluated is not a pass', () => {
    const d = decideVerdict(gates({ G6: 'not-evaluated' }), dims({}), []);
    expect(d.verdict).toBe('not-ready');
    expect(d.reasons.join(' ')).toContain('G6');
  });

  it('never rounds up: a level-2 dimension never makes ready, however high the rest', () => {
    const d = dims({ D1: 4, D2: 4, D3: 4, D4: 4, D5: 2 });
    expect(decideVerdict(gates(), d, ['D5']).verdict).toBe(
      'ready-with-conditions',
    );
  });

  it('D6 of an ML use in N/E is critical (25%)', () => {
    expect(decideVerdict(gates(), dims({ D6: 'N/E' }, 'ml'), []).verdict).toBe(
      'not-ready',
    );
  });
});

describe('rubric 3.5 weighted score', () => {
  it('redistributes the weight of a non-critical N/E dimension and says so', () => {
    const s = weightedScore(dims({ D1: 'N/E', D2: 2, D3: 3, D4: 3, D5: 3 }));
    // (0.3*2 + 0.15*3 + 0.25*3 + 0.15*3) / 0.85
    expect(s.score).toBeCloseTo(2.65, 2);
    expect(s.note).toContain('D1 (15%)');
    expect(s.note).toContain('redistributed');
  });

  it('has no score when a dimension weighing >= 20% is N/E', () => {
    const s = weightedScore(dims({ D4: 'N/E' }));
    expect(s.score).toBeNull();
    expect(s.note).toContain('D4 (25%)');
  });

  it('ignores a dimension that does not apply', () => {
    expect(weightedScore(dims({})).score).toBe(3);
    expect(weightedScore(dims({})).note).toBeUndefined();
  });
});

describe('conditions', () => {
  it('writes one verifiable condition per level-2 dimension at least', () => {
    const d = dims({ D2: 2, D3: 2 });
    const map = buildConditions(d, [
      {
        id: 'F-001',
        dimension: 'D2',
        severity: 'medium',
        entity: 'sales.orders',
        column: 'id',
        measured: '5% duplicate grain keys',
        threshold: '<= 2% duplicate grain keys',
        description: '',
        evidenceIds: ['EV-002'],
      },
    ]);
    expect(map.get('D2')![0]).toContain(
      'from 5% duplicate grain keys to <= 2%',
    );
    expect(map.get('D3')).toHaveLength(1);
    expect(map.has('D1')).toBe(false);
  });
});
