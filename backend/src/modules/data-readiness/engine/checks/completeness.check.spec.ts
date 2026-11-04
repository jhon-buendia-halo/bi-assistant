import { completenessCheck } from './completeness.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext } from '../types';
import type { EntityProfile, FieldProfile } from '../types';

const CTX: CheckContext = {
  thresholds: DEFAULT_THRESHOLDS,
  now: new Date('2026-01-01T00:00:00Z'),
};

function field(p: Partial<FieldProfile>): FieldProfile {
  return {
    name: 'col',
    type: 'text',
    semanticType: 'text',
    nullable: true,
    ...p,
  };
}

function entity(fields: FieldProfile[], rowCount = 100): EntityProfile {
  return { namespace: 'public', name: 'customers', rowCount, fields, keys: [] };
}

describe('completenessCheck', () => {
  it('flags a nullable column with nulls and scales severity by null fraction', () => {
    const e = entity([
      field({ name: 'low', nullable: true, nullCount: 5 }), // 5% -> low
      field({ name: 'mid', nullable: true, nullCount: 20 }), // 20% -> medium
      field({ name: 'hi', nullable: true, nullCount: 80 }), // 80% -> high
    ]);
    const { findings } = completenessCheck(e, CTX);
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.dimension === 'completeness')).toBe(true);
    expect(findings.find((f) => f.field === 'low')?.severity).toBe('low');
    expect(findings.find((f) => f.field === 'mid')?.severity).toBe('medium');
    expect(findings.find((f) => f.field === 'hi')?.severity).toBe('high');
  });

  it('ignores NOT NULL columns and columns with zero nulls', () => {
    const e = entity([
      field({ name: 'notnull', nullable: false, nullCount: 0 }),
      field({ name: 'full', nullable: true, nullCount: 0 }),
    ]);
    expect(completenessCheck(e, CTX).findings).toHaveLength(0);
  });

  it('returns nothing for an empty table (no rows to be incomplete)', () => {
    const e = entity([field({ name: 'c', nullable: true, nullCount: 0 })], 0);
    expect(completenessCheck(e, CTX).findings).toHaveLength(0);
  });

  it('counts one check per nullable field (denominator), zero for an empty table', () => {
    const e = entity([
      field({ name: 'a', nullable: true, nullCount: 0 }),
      field({ name: 'b', nullable: true, nullCount: 0 }),
      field({ name: 'c', nullable: false, nullCount: 0 }), // NOT NULL → not checked
    ]);
    expect(completenessCheck(e, CTX).checksRun).toBe(2);
    const empty = entity([field({ name: 'a', nullable: true })], 0);
    expect(completenessCheck(empty, CTX).checksRun).toBe(0);
  });

  it('uses >= at the exact medium and high boundaries', () => {
    const e = entity([
      field({ name: 'm', nullable: true, nullCount: 10 }), // exactly 10%
      field({ name: 'h', nullable: true, nullCount: 50 }), // exactly 50%
    ]);
    const { findings } = completenessCheck(e, CTX);
    expect(findings.find((f) => f.field === 'm')?.severity).toBe('medium');
    expect(findings.find((f) => f.field === 'h')?.severity).toBe('high');
  });

  it('reads thresholds from ctx', () => {
    const e = entity([field({ name: 'a', nullable: true, nullCount: 5 })]);
    const strict: CheckContext = {
      ...CTX,
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        completeness: { medium: 0.01, high: 0.05 },
      },
    };
    expect(completenessCheck(e, strict).findings[0].severity).toBe('high');
  });
});
