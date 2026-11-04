import type {
  CheckContext,
  CheckResult,
  EntityProfile,
  Finding,
} from '../types';

/**
 * Validity (DMBOK): conformance to format (spec R13). Pure function over the
 * profiler-measured `field.invalidFormatCount`. Denominator: one check per
 * field that carries a format rule.
 */
export function validityCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void ctx;
  const findings: Finding[] = [];
  let checksRun = 0;
  for (const field of entity.fields) {
    if (!field.formatRule) continue;
    checksRun++;
    const bad = field.invalidFormatCount ?? 0;
    if (bad <= 0) continue;
    findings.push({
      dimension: 'validity',
      level: 'entity',
      namespace: entity.namespace,
      entity: entity.name,
      field: field.name,
      severity: 'medium',
      measured: `${bad} value(s) fail ${field.formatRule} format`,
      description: `Column "${field.name}" has ${bad} value(s) that don't match a valid ${field.formatRule}.`,
      recommendation: `Validate ${field.formatRule} values on ingest, or correct the malformed records.`,
    });
  }
  return { dimension: 'validity', checksRun, findings };
}
