import type {
  CheckContext,
  CheckResult,
  EntityProfile,
  Finding,
} from '../types';

/**
 * Reasonability (DMBOK): plausibility of values in business context. Owns
 * implausible values, extreme outliers, and impossible dates. Per ADR-0011,
 * impossible dates are filed here (detected by plausibility heuristics) rather
 * than under Accuracy, which requires trusted reference data and is out of
 * automated scope. Pure function over the profile's min/max extremes.
 * Denominator (F1.6.8): one check per numeric or temporal field (the fields
 * eligible for a plausibility check).
 */
export function reasonabilityCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  const findings: Finding[] = [];
  const nowYear = ctx.now.getUTCFullYear();
  let checksRun = 0;

  for (const field of entity.fields) {
    if (field.semanticType === 'numeric') {
      checksRun++;
      const min = field.min !== undefined ? Number(field.min) : NaN;
      if (Number.isFinite(min) && min < 0) {
        findings.push({
          dimension: 'reasonability',
          level: 'entity',
          namespace: entity.namespace,
          entity: entity.name,
          field: field.name,
          severity: 'low',
          measured: `min = ${field.min}`,
          description: `Column "${field.name}" contains negative values.`,
          recommendation:
            'Confirm negatives are valid for this column (e.g. adjustments/refunds) or treat them as anomalies.',
        });
      }
    } else if (field.semanticType === 'temporal') {
      checksRun++;
      const maxYear = parseYear(field.max);
      const minYear = parseYear(field.min);
      if (maxYear !== undefined && maxYear > nowYear) {
        findings.push({
          dimension: 'reasonability',
          level: 'entity',
          namespace: entity.namespace,
          entity: entity.name,
          field: field.name,
          severity: 'medium',
          measured: `max = ${field.max}`,
          description: `Column "${field.name}" has future-dated values (latest year ${maxYear}).`,
          recommendation:
            'Future timestamps usually indicate data-entry or timezone errors; verify the source.',
        });
      }
      if (
        minYear !== undefined &&
        minYear < ctx.thresholds.reasonability.ancientYear
      ) {
        findings.push({
          dimension: 'reasonability',
          level: 'entity',
          namespace: entity.namespace,
          entity: entity.name,
          field: field.name,
          severity: 'low',
          measured: `min = ${field.min}`,
          description: `Column "${field.name}" has implausibly old values (earliest year ${minYear}).`,
          recommendation: `Values before ${ctx.thresholds.reasonability.ancientYear} are often placeholders or parse errors; verify the source.`,
        });
      }
    }
  }

  // F1.20.6a — ratio/percentage bounds. A numeric column whose NAME promises a
  // bounded range gets its profiled MAX checked against it: pct/percent → 100,
  // fraction/share/ratio/probability → 1. (Negative minimums are already
  // covered by the negative-numeric rule above.)
  for (const field of entity.fields) {
    if (field.semanticType !== 'numeric' || field.max === undefined) continue;
    const bound = ratioBound(field.name);
    if (bound === undefined) continue;
    checksRun++;
    const max = Number(field.max);
    if (!Number.isFinite(max) || max <= bound) continue;
    findings.push({
      dimension: 'reasonability',
      level: 'entity',
      namespace: entity.namespace,
      entity: entity.name,
      field: field.name,
      severity: 'medium',
      measured: `max = ${field.max}`,
      description: `Column "${field.name}" reads as a ${bound === 100 ? 'percentage' : 'ratio'} but its maximum (${field.max}) exceeds ${bound}.`,
      recommendation: `Values above ${bound} contradict the column's name — verify the unit (percent vs fraction) or the upstream calculation.`,
    });
  }

  // F1.20.6b — swapped temporal ranges. For name-paired start/end columns,
  // fire ONLY when the end column's whole profiled range sits before the
  // start's (both min AND max inverted) — the conservative shape that almost
  // certainly means the columns are swapped or mislabeled. Partial overlap is
  // normal (open-ended rows) and never fires.
  for (const [startField, endField] of temporalPairs(entity)) {
    checksRun++;
    const sMin = Date.parse(startField.min ?? '');
    const sMax = Date.parse(startField.max ?? '');
    const eMin = Date.parse(endField.min ?? '');
    const eMax = Date.parse(endField.max ?? '');
    if ([sMin, sMax, eMin, eMax].some(Number.isNaN)) continue;
    if (!(eMin < sMin && eMax < sMax)) continue;
    findings.push({
      dimension: 'reasonability',
      level: 'entity',
      namespace: entity.namespace,
      entity: entity.name,
      field: `${startField.name}, ${endField.name}`,
      severity: 'low',
      measured: `"${endField.name}" range [${endField.min} … ${endField.max}] precedes "${startField.name}" range [${startField.min} … ${startField.max}]`,
      description: `The "${endField.name}" column's entire value range precedes "${startField.name}" — the pair looks swapped or mislabeled.`,
      recommendation:
        'Verify the two columns are populated in the intended order; swapped start/end columns silently corrupt duration logic.',
    });
  }

  return { dimension: 'reasonability', checksRun, findings };
}

/** Bound implied by a numeric column's name, or undefined when none. */
function ratioBound(name: string): number | undefined {
  const n = name.toLowerCase();
  if (/(^|_)(pct|percent|percentage)($|_)/.test(n) || /pct$|percent$/.test(n))
    return 100;
  if (/(^|_)(fraction|share|ratio|probability|prob)($|_)/.test(n)) return 1;
  return undefined;
}

/** Name-paired temporal columns: start/end, from/to, begin/finish, created/updated. */
const RANGE_PAIRS: Array<[RegExp, RegExp]> = [
  [/(^|_)start/i, /(^|_)end/i],
  [/(^|_)from/i, /(^|_)to($|_)/i],
  [/(^|_)begin/i, /(^|_)finish/i],
];

function temporalPairs(
  entity: EntityProfile,
): Array<
  [
    { name: string; min?: string; max?: string },
    { name: string; min?: string; max?: string },
  ]
> {
  const temporal = entity.fields.filter(
    (f) =>
      f.semanticType === 'temporal' &&
      f.min !== undefined &&
      f.max !== undefined,
  );
  const out: Array<[(typeof temporal)[number], (typeof temporal)[number]]> = [];
  for (const [startRe, endRe] of RANGE_PAIRS) {
    const start = temporal.find((f) => startRe.test(f.name));
    const end = temporal.find((f) => endRe.test(f.name));
    if (start && end && start.name !== end.name) out.push([start, end]);
  }
  return out;
}

/** Extract a 4-digit year from a text-cast min/max value. */
function parseYear(value?: string): number | undefined {
  if (!value) return undefined;
  const m = /(\d{4})/.exec(value.trim());
  if (m) return Number(m[1]);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.getUTCFullYear();
}
