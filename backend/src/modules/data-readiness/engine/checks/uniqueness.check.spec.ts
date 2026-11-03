import { uniquenessCheck } from './uniqueness.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext } from '../types';
import type { EntityProfile, KeyProfile } from '../types';

const CTX: CheckContext = {
  thresholds: DEFAULT_THRESHOLDS,
  now: new Date('2026-01-01T00:00:00Z'),
};

function entity(keys: KeyProfile[]): EntityProfile {
  return {
    namespace: 'public',
    name: 'customers',
    rowCount: 100,
    fields: [],
    keys,
  };
}

describe('uniquenessCheck', () => {
  it('flags a primary key with duplicate rows as high severity', () => {
    const { findings } = uniquenessCheck(
      entity([{ kind: 'primary', fields: ['id'], duplicateCount: 3 }]),
      CTX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('uniqueness');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].field).toBe('id');
  });

  it('flags a unique key with duplicates as medium severity', () => {
    const { findings } = uniquenessCheck(
      entity([{ kind: 'unique', fields: ['email'], duplicateCount: 1 }]),
      CTX,
    );
    expect(findings[0].severity).toBe('medium');
  });

  it('does not flag keys with zero duplicates', () => {
    const { findings } = uniquenessCheck(
      entity([{ kind: 'primary', fields: ['id'], duplicateCount: 0 }]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('joins composite key fields in the finding', () => {
    const { findings } = uniquenessCheck(
      entity([{ kind: 'unique', fields: ['a', 'b'], duplicateCount: 2 }]),
      CTX,
    );
    expect(findings[0].field).toBe('a, b');
  });

  it('counts one check per declared key (denominator)', () => {
    const e = entity([
      { kind: 'primary', fields: ['id'], duplicateCount: 0 },
      { kind: 'unique', fields: ['email'], duplicateCount: 0 },
    ]);
    expect(uniquenessCheck(e, CTX).checksRun).toBe(2);
    expect(uniquenessCheck(entity([]), CTX).checksRun).toBe(0);
  });
});

// F1.20.2 — inferred candidate keys on entities with NO declared keys.
describe('uniquenessCheck (inferred candidate keys)', () => {
  function keylessEntity(
    fields: Array<{ name: string; distinctCount?: number; nullCount?: number }>,
    rowCount = 100,
  ): EntityProfile {
    return {
      namespace: 'main.sales',
      name: 'orders_view',
      rowCount,
      keys: [],
      fields: fields.map((f) => ({
        name: f.name,
        type: 'bigint',
        semanticType: 'numeric' as const,
        nullable: true,
        distinctCount: f.distinctCount,
        nullCount: f.nullCount,
      })),
    };
  }

  it('flags an id-like column with duplicate values at medium severity, labeled inferred', () => {
    const { findings } = uniquenessCheck(
      keylessEntity([{ name: 'OrderId', distinctCount: 90 }]),
      CTX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].measured).toContain('10 duplicate');
    expect(findings[0].description).toContain('inferred');
  });

  it('a clean id-like column produces no finding but counts toward checksRun', () => {
    const result = uniquenessCheck(
      keylessEntity([{ name: 'order_id', distinctCount: 100 }]),
      CTX,
    );
    expect(result.findings).toHaveLength(0);
    expect(result.checksRun).toBe(1);
  });

  it('accounts for nulls in the excess (rows − nulls − distinct)', () => {
    const { findings } = uniquenessCheck(
      keylessEntity([{ name: 'id', distinctCount: 80, nullCount: 20 }]),
      CTX,
    );
    expect(findings).toHaveLength(0); // 100 − 20 − 80 = 0
  });

  it('ignores non-id-like columns and columns without measured distinct', () => {
    const result = uniquenessCheck(
      keylessEntity([
        { name: 'amount', distinctCount: 5 },
        { name: 'customer_id' },
      ]),
      CTX,
    );
    expect(result.checksRun).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('matches the ID/Id/_id/id shapes but not lowercase …id word-tails', () => {
    const result = uniquenessCheck(
      keylessEntity([
        { name: 'transactionID', distinctCount: 100 }, // matches
        { name: 'paid', distinctCount: 2 }, // must NOT match
        { name: 'grid', distinctCount: 2 }, // must NOT match
      ]),
      CTX,
    );
    expect(result.checksRun).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('never infers when a key is declared', () => {
    const declared: EntityProfile = {
      ...keylessEntity([{ name: 'id', distinctCount: 50 }]),
      keys: [{ kind: 'primary', fields: ['id'], duplicateCount: 0 }],
    };
    const result = uniquenessCheck(declared, CTX);
    expect(result.checksRun).toBe(1); // declared key only
    expect(result.findings).toHaveLength(0);
  });
});
