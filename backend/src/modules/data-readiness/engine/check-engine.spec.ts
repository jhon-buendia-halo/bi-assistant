import { DEFAULT_THRESHOLDS } from './types';
import type { CheckContext, Finding, SourceProfile } from './types';
import { runAssessment } from './check-engine';

const order: string[] = [];
const fnd = (
  dimension: Finding['dimension'],
  severity: Finding['severity'],
  entity?: string,
): Finding => ({
  dimension,
  level: entity ? 'entity' : 'source',
  entity,
  severity,
  description: 'd',
  recommendation: 'r',
});

jest.mock('./checks', () => ({
  ENTITY_CHECKS: [
    (e: { name: string }) => {
      order.push(`c:${e.name}`);
      return {
        dimension: 'completeness',
        checksRun: 5,
        findings: e.name === 'a' ? [fnd('completeness', 'high', 'a')] : [],
      };
    },
    (e: { name: string }) => {
      order.push(`r:${e.name}`);
      return { dimension: 'reasonability', checksRun: 1, findings: [] };
    },
  ],
  SOURCE_CHECKS: [
    () => {
      order.push('s');
      return {
        dimension: 'integrity',
        checksRun: 2,
        findings: [fnd('integrity', 'medium')],
      };
    },
  ],
}));

const entity = (name: string) => ({
  namespace: 'public',
  name,
  rowCount: 1,
  fields: [],
  keys: [],
});
const profile: SourceProfile = {
  sourceId: 's',
  sourceType: 'postgres',
  entities: [entity('a'), entity('b')],
  relationships: [],
};
const ctx: CheckContext = {
  thresholds: DEFAULT_THRESHOLDS,
  now: new Date('2026-01-01T00:00:00Z'),
};

describe('runAssessment', () => {
  beforeEach(() => {
    order.length = 0;
  });

  it('runs entity checks per entity then source checks, and scores', () => {
    const r = runAssessment(profile, ctx);
    expect(order).toEqual(['c:a', 'r:a', 'c:b', 'r:b', 's']);
    expect(r.entityCount).toBe(2);
    expect(r.findings.map((x) => x.dimension)).toEqual([
      'completeness',
      'integrity',
    ]);
    expect(r.dimensionScores).toHaveLength(10);
    const comp = r.dimensionScores.find((d) => d.dimension === 'completeness')!;
    expect(comp.totalChecks).toBe(10);
    expect(comp.score).toBe(90);
    const integ = r.dimensionScores.find((d) => d.dimension === 'integrity')!;
    expect(integ.score).toBe(80);
    expect(r.overallScore).toBe(Math.round((90 + 80 + 6 * 100) / 8));
    expect(r.maturity).toBe('Optimised');
  });

  it('is deterministic', () => {
    expect(runAssessment(profile, ctx)).toEqual(runAssessment(profile, ctx));
  });
});
