import type {
  CheckContext,
  CheckResult,
  SourceProfile,
  Finding,
} from '../types';

/**
 * Integrity (DMBOK): relationship validity — orphan foreign keys, broken
 * parent-child links. A SOURCE-level check (it reads the whole relationship
 * graph). Pure function over the adapter-measured `relationship.orphanCount`.
 * Findings are attributed to the child entity so they surface in that table's
 * Quality tab.
 * Denominator (F1.6.8): one check per declared relationship (FK edge).
 */
export function integrityCheck(
  profile: SourceProfile,
  ctx: CheckContext,
): CheckResult {
  void ctx;
  const findings: Finding[] = [];
  for (const rel of profile.relationships) {
    const orphans = rel.orphanCount ?? 0;
    if (orphans <= 0) continue;
    // F1.20.3 — inferred (name-matched) relationships are capped at medium and
    // labeled: a heuristic join candidate never carries declared-FK authority.
    const inferred = rel.origin === 'inferred';
    findings.push({
      dimension: 'integrity',
      level: 'entity',
      namespace: rel.fromNamespace,
      entity: rel.fromEntity,
      field: rel.fromField,
      severity: inferred ? 'medium' : 'high',
      measured: `${orphans} orphan row(s)`,
      description:
        `"${rel.fromNamespace}.${rel.fromEntity}.${rel.fromField}" has ${orphans} value(s) with no matching "${rel.toNamespace}.${rel.toEntity}.${rel.toField}"` +
        (inferred
          ? ' (inferred relationship — no FK is declared; matched by naming convention).'
          : '.'),
      recommendation: inferred
        ? 'If these tables are meant to join, repair the orphan values and declare the foreign key; if not, ignore or mark this finding a false positive.'
        : 'Restore the missing parent rows or add a foreign-key constraint to stop new orphans.',
    });
  }
  return {
    dimension: 'integrity',
    checksRun: profile.relationships.length,
    findings,
  };
}
