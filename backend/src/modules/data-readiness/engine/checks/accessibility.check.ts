import type {
  CheckContext,
  CheckResult,
  SourceProfile,
  Finding,
} from '../types';

/**
 * Accessibility (the product's 9th, retrievability-focused dimension): whether
 * the connecting role can actually read the data. Owns access/retrieval
 * barriers. Pure function over the adapter-measured `entity.readable` (a
 * per-table SELECT-privilege probe).
 *
 * F1.20.8 — source-level since M1.20: a browse-only catalog used to yield one
 * high finding PER locked table (hundreds on a real Unity Catalog source),
 * drowning every other dimension. Unreadable entities now aggregate to ONE
 * finding per namespace, severity `high` when the whole namespace is locked
 * and `medium` when partial. The denominator stays one check per entity
 * (readability is still evaluated for every table), so the proportional score
 * (ADR-0022) keeps its meaning.
 */
export function accessibilityCheck(
  profile: SourceProfile,
  ctx: CheckContext,
): CheckResult {
  void ctx;
  const findings: Finding[] = [];
  const byNamespace = new Map<string, { total: number; locked: string[] }>();
  for (const entity of profile.entities) {
    const bucket = byNamespace.get(entity.namespace) ?? {
      total: 0,
      locked: [],
    };
    bucket.total += 1;
    if (entity.readable === false) bucket.locked.push(entity.name);
    byNamespace.set(entity.namespace, bucket);
  }

  for (const [namespace, { total, locked }] of byNamespace) {
    if (locked.length === 0) continue;
    const allLocked = locked.length === total;
    const sample =
      locked.slice(0, 5).join(', ') + (locked.length > 5 ? ', …' : '');
    findings.push({
      dimension: 'accessibility',
      level: 'source',
      namespace,
      severity: allLocked ? 'high' : 'medium',
      measured: `${locked.length} of ${total} table(s) not readable`,
      description:
        `The connecting role cannot SELECT from ${locked.length} of ${total} table(s) in ` +
        `"${namespace}" (${sample}), so their data can't be assessed or consumed.`,
      recommendation:
        'Grant SELECT to the agent role, or exclude the schema from the readiness scope if access is intentionally restricted.',
    });
  }

  return {
    dimension: 'accessibility',
    checksRun: profile.entities.length,
    findings,
  };
}
