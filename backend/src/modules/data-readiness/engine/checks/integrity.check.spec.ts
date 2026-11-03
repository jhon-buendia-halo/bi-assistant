import { integrityCheck as integrityCheckRaw } from './integrity.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type {
  CheckContext,
  RelationshipProfile,
  SourceProfile,
} from '../types';

const NOW = new Date('2026-06-15T12:00:00Z');
const CTX: CheckContext = { thresholds: DEFAULT_THRESHOLDS, now: NOW };
const integrityCheck = (p: SourceProfile) => integrityCheckRaw(p, CTX);

function rel(p: Partial<RelationshipProfile>): RelationshipProfile {
  return {
    fromNamespace: 'public',
    fromEntity: 'orders',
    fromField: 'customer_id',
    toNamespace: 'public',
    toEntity: 'customers',
    toField: 'id',
    ...p,
  };
}

function profile(relationships: RelationshipProfile[]): SourceProfile {
  return {
    sourceId: 's1',
    sourceType: 'postgres',
    entities: [],
    relationships,
  };
}

describe('integrityCheck', () => {
  it('flags an FK edge with orphan rows, attributed to the child entity', () => {
    const { findings } = integrityCheck(profile([rel({ orphanCount: 5 })]));
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('integrity');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].namespace).toBe('public');
    expect(findings[0].entity).toBe('orders');
    expect(findings[0].field).toBe('customer_id');
  });

  it('does not flag sound relationships (zero orphans)', () => {
    const { findings } = integrityCheck(
      profile([rel({ orphanCount: 0 }), rel({ orphanCount: undefined })]),
    );
    expect(findings).toHaveLength(0);
  });

  it('flags each broken edge independently', () => {
    const { findings } = integrityCheck(
      profile([
        rel({ fromEntity: 'orders', orphanCount: 2 }),
        rel({ fromEntity: 'invoices', orphanCount: 1 }),
      ]),
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.entity).sort()).toEqual([
      'invoices',
      'orders',
    ]);
  });

  it('counts one check per declared relationship (denominator)', () => {
    expect(
      integrityCheck(
        profile([rel({ orphanCount: 0 }), rel({ orphanCount: 3 })]),
      ).checksRun,
    ).toBe(2);
    expect(integrityCheck(profile([])).checksRun).toBe(0);
  });

  // F1.20.3 — inferred (name-matched) relationships are severity-capped + labeled.
  it('caps inferred-relationship orphan findings at medium with the inferred ruleId', () => {
    const { findings } = integrityCheck(
      profile([rel({ orphanCount: 7, origin: 'inferred' })]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].description).toContain('inferred relationship');
  });

  it('declared (or unmarked) relationships stay high severity', () => {
    expect(
      integrityCheck(profile([rel({ orphanCount: 1, origin: 'declared' })]))
        .findings[0].severity,
    ).toBe('high');
    expect(
      integrityCheck(profile([rel({ orphanCount: 1 })])).findings[0].severity,
    ).toBe('high');
  });
});
