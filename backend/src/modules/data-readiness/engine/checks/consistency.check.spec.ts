import { consistencyCheck } from './consistency.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext } from '../types';
import type { EntityProfile, FieldProfile } from '../types';

const CTX: CheckContext = {
  thresholds: DEFAULT_THRESHOLDS,
  now: new Date('2026-01-01T00:00:00Z'),
};

function entity(fields: FieldProfile[]): EntityProfile {
  return {
    namespace: 'public',
    name: 'customers',
    rowCount: 100,
    fields,
    keys: [],
  };
}

function textField(p: Partial<FieldProfile>): FieldProfile {
  return {
    name: 'country',
    type: 'text',
    semanticType: 'text',
    nullable: true,
    ...p,
  };
}

describe('consistencyCheck', () => {
  it('flags case/whitespace variants when normalized distinct is lower', () => {
    const { findings } = consistencyCheck(
      entity([textField({ distinctCount: 12, normalizedDistinctCount: 10 })]),
      CTX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('consistency');
    expect(findings[0].description).toMatch(/2 value/);
  });

  it('does not flag when normalized equals raw distinct', () => {
    const { findings } = consistencyCheck(
      entity([textField({ distinctCount: 10, normalizedDistinctCount: 10 })]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('skips fields with no normalized count measured', () => {
    const { findings } = consistencyCheck(
      entity([textField({ distinctCount: 10 })]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('counts one check per field with both raw + normalized distinct (denominator)', () => {
    const e = entity([
      textField({ name: 'a', distinctCount: 10, normalizedDistinctCount: 10 }),
      textField({ name: 'b', distinctCount: 5, normalizedDistinctCount: 5 }),
      textField({ name: 'c', distinctCount: 10 }), // no normalized → not checked
    ]);
    expect(consistencyCheck(e, CTX).checksRun).toBe(2);
  });
});
