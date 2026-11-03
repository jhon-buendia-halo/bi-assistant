import type {
  CheckContext,
  CheckResult,
  EntityProfile,
  Finding,
  Severity,
} from '../types';

/**
 * Completeness (DMBOK): presence of required values (spec R12). Pure function
 * over the profile; NOT NULL columns are skipped. Denominator: one check per
 * nullable field in a non-empty entity.
 */
export function completenessCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  const findings: Finding[] = [];
  if (entity.rowCount <= 0) {
    return { dimension: 'completeness', checksRun: 0, findings };
  }

  const { medium, high } = ctx.thresholds.completeness;
  let checksRun = 0;
  for (const field of entity.fields) {
    if (!field.nullable) continue;
    checksRun++;
    const nulls = field.nullCount ?? 0;
    if (nulls <= 0) continue;

    const frac = nulls / entity.rowCount;
    const severity: Severity =
      frac >= high ? 'high' : frac >= medium ? 'medium' : 'low';
    const pct = (frac * 100).toFixed(1);
    findings.push({
      dimension: 'completeness',
      level: 'entity',
      namespace: entity.namespace,
      entity: entity.name,
      field: field.name,
      severity,
      measured: `${pct}% null (${nulls}/${entity.rowCount})`,
      description: `Column "${field.name}" is missing values in ${nulls} of ${entity.rowCount} rows.`,
      recommendation:
        severity === 'high'
          ? 'High null rate — confirm the column is still populated upstream, or mark it optional.'
          : 'Investigate the source of the missing values or document them as expected.',
    });
  }

  return { dimension: 'completeness', checksRun, findings };
}
