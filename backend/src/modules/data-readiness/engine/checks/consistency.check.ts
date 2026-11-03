import type {
  CheckContext,
  CheckResult,
  EntityProfile,
  Finding,
} from '../types';

/**
 * Consistency (DMBOK): case / whitespace inconsistencies in the same
 * conceptual value (spec R14). Denominator: one check per field that has both
 * a raw and a normalized distinct count.
 */
export function consistencyCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void ctx;
  const findings: Finding[] = [];
  let checksRun = 0;
  for (const field of entity.fields) {
    const raw = field.distinctCount;
    const normalized = field.normalizedDistinctCount;
    if (raw === undefined || normalized === undefined) continue;
    checksRun++;
    if (normalized >= raw) continue;
    const collapsed = raw - normalized;
    findings.push({
      dimension: 'consistency',
      level: 'entity',
      namespace: entity.namespace,
      entity: entity.name,
      field: field.name,
      severity: 'low',
      measured: `${raw} distinct → ${normalized} normalized`,
      description: `Column "${field.name}" has ${collapsed} value(s) that differ only by case or whitespace.`,
      recommendation:
        'Standardise casing/trimming on write (or with a constraint) so the same value is stored one way.',
    });
  }
  return { dimension: 'consistency', checksRun, findings };
}
