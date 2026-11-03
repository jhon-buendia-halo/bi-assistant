import type {
  CheckContext,
  CheckResult,
  EntityProfile,
  Finding,
} from '../types';

/**
 * Uniqueness (DMBOK): duplicate keys (spec R15). Denominator: one check per
 * declared key, plus one per id-like column when the entity declares no key.
 */
export function uniquenessCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void ctx;
  const findings: Finding[] = [];
  for (const key of entity.keys) {
    const dups = key.duplicateCount ?? 0;
    if (dups <= 0) continue;
    const fields = key.fields.join(', ');
    findings.push({
      dimension: 'uniqueness',
      level: 'entity',
      namespace: entity.namespace,
      entity: entity.name,
      field: fields,
      severity: key.kind === 'primary' ? 'high' : 'medium',
      measured: `${dups} duplicate row(s)`,
      description: `The ${key.kind} key (${fields}) has ${dups} duplicate row(s).`,
      recommendation:
        'De-duplicate the rows or enforce the key — duplicates break joins and inflate counts.',
    });
  }

  // Inferred candidate keys: entities with no declared key get id-like columns
  // treated as candidates. Capped at medium and labeled inferred.
  let inferredChecks = 0;
  if (entity.keys.length === 0 && entity.rowCount > 0) {
    for (const field of entity.fields) {
      if (!isIdLike(field.name) || field.distinctCount === undefined) continue;
      inferredChecks += 1;
      const excess = Math.max(
        0,
        entity.rowCount - (field.nullCount ?? 0) - field.distinctCount,
      );
      if (excess <= 0) continue;
      findings.push({
        dimension: 'uniqueness',
        level: 'entity',
        namespace: entity.namespace,
        entity: entity.name,
        field: field.name,
        severity: 'medium',
        measured: `${excess} duplicate value(s)`,
        description:
          `Column "${field.name}" looks like an identifier (inferred — no key is declared) ` +
          `but carries ${excess} duplicate value(s).`,
        recommendation:
          `If "${field.name}" is meant to be unique, de-duplicate and declare the key; ` +
          'if not, rename it so it stops reading as an identifier.',
      });
    }
  }
  return {
    dimension: 'uniqueness',
    checksRun: entity.keys.length + inferredChecks,
    findings,
  };
}

/** `id`, `*_id`, `*Id`, `*ID`; a bare lowercase `…id` tail (paid, grid) does not match. */
function isIdLike(name: string): boolean {
  return /(^id$|_id$|Id$|ID$)/.test(name);
}
