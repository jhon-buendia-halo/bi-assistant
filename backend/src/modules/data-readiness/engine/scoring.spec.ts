import { dimensions } from './dimensions';
import { overallMaturity, scoreDimensions } from './scoring';
import type { DimensionScore, Finding } from './types';

function f(
  dimension: Finding['dimension'],
  severity: Finding['severity'],
): Finding {
  return {
    dimension,
    level: 'entity',
    severity,
    description: 'x',
    recommendation: 'y',
  };
}
const get = (s: DimensionScore[], d: string) =>
  s.find((x) => x.dimension === d)!;

describe('dimensions', () => {
  it('lists ten, accuracy and currency not assessed', () => {
    const d = dimensions();
    expect(d).toHaveLength(10);
    expect(d.filter((x) => !x.assessed).map((x) => x.id)).toEqual([
      'accuracy',
      'currency',
    ]);
  });
});

describe('scoreDimensions', () => {
  it('scores 100 with no checks', () => {
    const c = get(scoreDimensions([], {}), 'completeness');
    expect(c.score).toBe(100);
    expect(c.totalChecks).toBe(0);
    expect(c.maxSeverity).toBeNull();
  });

  it('2 high of 10 -> 80', () => {
    const s = scoreDimensions(
      [f('completeness', 'high'), f('completeness', 'high')],
      { completeness: 10 },
    );
    expect(get(s, 'completeness')).toMatchObject({
      score: 80,
      findingCount: 2,
      maxSeverity: 'high',
      totalChecks: 10,
    });
  });

  it('weights medium and low', () => {
    expect(
      get(
        scoreDimensions([f('reasonability', 'medium')], { reasonability: 10 }),
        'reasonability',
      ).score,
    ).toBe(96);
    expect(
      get(
        scoreDimensions([f('reasonability', 'low')], { reasonability: 10 }),
        'reasonability',
      ).score,
    ).toBe(99);
  });

  it('info weighs nothing', () => {
    expect(
      get(scoreDimensions([f('validity', 'info')], { validity: 5 }), 'validity')
        .score,
    ).toBe(100);
  });

  it('does not saturate: 49 high of 50 -> 2', () => {
    const findings = Array.from({ length: 49 }, () =>
      f('completeness', 'high'),
    );
    expect(
      get(scoreDimensions(findings, { completeness: 50 }), 'completeness')
        .score,
    ).toBe(2);
  });

  it('clamps to 0', () => {
    const findings = Array.from({ length: 5 }, () => f('completeness', 'high'));
    expect(
      get(scoreDimensions(findings, { completeness: 2 }), 'completeness').score,
    ).toBe(0);
  });

  it('keeps accuracy and currency unassessed at 100 with 0 checks', () => {
    const s = scoreDimensions([f('accuracy', 'high')], { accuracy: 4 });
    expect(get(s, 'accuracy')).toMatchObject({
      score: 100,
      assessed: false,
      totalChecks: 0,
    });
    expect(s).toHaveLength(10);
  });
});

describe('overallMaturity', () => {
  it('completeness 0, others 100 -> 88 Managed', () => {
    const s = scoreDimensions(
      Array.from({ length: 2 }, () => f('completeness', 'high')),
      { completeness: 2 },
    );
    expect(overallMaturity(s)).toEqual({
      overallScore: 88,
      maturity: 'Managed',
    });
  });

  it('applies the bands', () => {
    const mk = (n: number): DimensionScore[] => [
      {
        dimension: 'completeness',
        score: n,
        findingCount: 0,
        maxSeverity: null,
        assessed: true,
        totalChecks: 1,
      },
    ];
    expect(overallMaturity(mk(95)).maturity).toBe('Optimised');
    expect(overallMaturity(mk(85)).maturity).toBe('Managed');
    expect(overallMaturity(mk(70)).maturity).toBe('Defined');
    expect(overallMaturity(mk(50)).maturity).toBe('Repeatable');
    expect(overallMaturity(mk(49)).maturity).toBe('Initial');
  });

  it('no assessed dimensions -> 0 Initial', () => {
    expect(overallMaturity([])).toEqual({
      overallScore: 0,
      maturity: 'Initial',
    });
  });
});
