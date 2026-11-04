import { computeMetrics, scoreCounts, scoreFindings } from './gold-scorer';
import type { GoldLabel } from './gold-scorer';
import type { Finding } from './types';

function finding(p: Partial<Finding>): Finding {
  return {
    dimension: 'completeness',
    level: 'entity',
    namespace: 's',
    entity: 't',
    field: 'c',
    severity: 'medium',
    description: 'd',
    recommendation: 'r',
    ...p,
  };
}

describe('gold scorer', () => {
  it('matches on identity with severity within one level', () => {
    const labels: GoldLabel[] = [
      {
        dimension: 'completeness',
        namespace: 's',
        entity: 't',
        field: 'c',
        severity: 'medium',
      },
    ];
    for (const severity of ['low', 'medium', 'high'] as const) {
      const r = scoreFindings([finding({ severity })], labels);
      expect(r.overall).toMatchObject({
        truePositives: 1,
        falsePositives: 0,
        falseNegatives: 0,
      });
    }
    const far = scoreFindings([finding({ severity: 'info' })], labels);
    expect(far.overall).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
    });
  });

  it('does not match when any identity part differs', () => {
    const labels: GoldLabel[] = [
      {
        dimension: 'completeness',
        namespace: 's',
        entity: 't',
        field: 'c',
        severity: 'medium',
      },
    ];
    for (const other of [
      { dimension: 'validity' as const },
      { namespace: 'x' },
      { entity: 'x' },
      { field: 'x' },
    ]) {
      const r = scoreFindings([finding(other)], labels);
      expect(r.overall.truePositives).toBe(0);
    }
  });

  it('is one-to-one and treats missing parts as equal when both omit them', () => {
    const src: GoldLabel = {
      dimension: 'accessibility',
      namespace: 's',
      severity: 'high',
    };
    const f = finding({
      dimension: 'accessibility',
      level: 'source',
      entity: undefined,
      field: undefined,
      severity: 'high',
    });
    const r = scoreFindings([f, f], [src]);
    expect(r.overall).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
    });
    expect(r.falseAlarms).toHaveLength(1);
  });

  it('computes precision, recall, F1 overall and per dimension', () => {
    const labels: GoldLabel[] = [
      {
        dimension: 'completeness',
        namespace: 's',
        entity: 't',
        field: 'a',
        severity: 'high',
      },
      {
        dimension: 'completeness',
        namespace: 's',
        entity: 't',
        field: 'b',
        severity: 'high',
      },
      {
        dimension: 'validity',
        namespace: 's',
        entity: 't',
        field: 'e',
        severity: 'medium',
      },
    ];
    const findings = [
      finding({ field: 'a', severity: 'high' }),
      finding({ field: 'z', severity: 'low' }),
      finding({ dimension: 'validity', field: 'e' }),
    ];
    const r = scoreFindings(findings, labels);
    expect(r.overall.precision).toBeCloseTo(2 / 3);
    expect(r.overall.recall).toBeCloseTo(2 / 3);
    expect(r.overall.f1).toBeCloseTo(2 / 3);
    expect(r.perDimension.completeness).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 1,
    });
    expect(r.perDimension.completeness?.f1).toBeCloseTo(0.5);
    expect(r.perDimension.validity?.f1).toBe(1);
    expect(r.missed).toHaveLength(1);
  });

  it('returns null metrics for empty slices', () => {
    expect(
      computeMetrics({
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
      }),
    ).toMatchObject({
      precision: null,
      recall: null,
      f1: null,
    });
    expect(scoreCounts([], []).overall.truePositives).toBe(0);
  });
});
