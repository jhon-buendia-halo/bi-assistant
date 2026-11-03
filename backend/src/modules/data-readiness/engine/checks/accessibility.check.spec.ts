import { accessibilityCheck as accessibilityCheckRaw } from './accessibility.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext, EntityProfile, SourceProfile } from '../types';

const NOW = new Date('2026-06-15T12:00:00Z');
const CTX: CheckContext = { thresholds: DEFAULT_THRESHOLDS, now: NOW };
const accessibilityCheck = (p: SourceProfile) => accessibilityCheckRaw(p, CTX);

function entity(
  name: string,
  readable: boolean | undefined,
  namespace = 'public',
): EntityProfile {
  return { namespace, name, rowCount: 0, fields: [], keys: [], readable };
}

function profile(entities: EntityProfile[]): SourceProfile {
  return {
    sourceId: 'src-1',
    sourceType: 'databricks',
    entities,
    relationships: [],
  };
}

// F1.20.8 — source-level: locked tables aggregate to ONE finding per namespace.
describe('accessibilityCheck (per-namespace aggregation)', () => {
  it('aggregates locked tables into one finding per namespace with the count', () => {
    const { findings } = accessibilityCheck(
      profile([
        entity('a', false, 'locked.ns'),
        entity('b', false, 'locked.ns'),
        entity('c', false, 'locked.ns'),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('accessibility');
    expect(findings[0].level).toBe('source');
    expect(findings[0].namespace).toBe('locked.ns');
    expect(findings[0].measured).toContain('3 of 3');
  });

  it('fully-locked namespace is high; partially-locked is medium', () => {
    const all = accessibilityCheck(
      profile([entity('a', false), entity('b', false)]),
    );
    expect(all.findings[0].severity).toBe('high');

    const partial = accessibilityCheck(
      profile([entity('a', false), entity('b', true)]),
    );
    expect(partial.findings[0].severity).toBe('medium');
    expect(partial.findings[0].measured).toContain('1 of 2');
  });

  it('separate namespaces yield separate findings', () => {
    const { findings } = accessibilityCheck(
      profile([entity('a', false, 'ns1'), entity('b', false, 'ns2')]),
    );
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => f.namespace))).toEqual(
      new Set(['ns1', 'ns2']),
    );
  });

  it('does not flag readable or unknown-readability tables', () => {
    expect(
      accessibilityCheck(profile([entity('a', true), entity('b', undefined)]))
        .findings,
    ).toHaveLength(0);
  });

  it('keeps one check per entity as the denominator', () => {
    expect(
      accessibilityCheck(
        profile([
          entity('a', false),
          entity('b', true),
          entity('c', undefined),
        ]),
      ).checksRun,
    ).toBe(3);
  });
});

describe('accessibilityCheck (truncated sample)', () => {
  it('lists at most 5 locked tables then an ellipsis', () => {
    const entities = Array.from({ length: 7 }, (_, i) =>
      entity(`t${i}`, false),
    );
    const { findings } = accessibilityCheck(profile(entities));
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toContain('t4, …');
    expect(findings[0].description).not.toContain('t5');
    expect(findings[0].measured).toBe('7 of 7 table(s) not readable');
  });
});
