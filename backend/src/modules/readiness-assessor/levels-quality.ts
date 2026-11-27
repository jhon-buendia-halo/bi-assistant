// Rubric 3.3 for D2 Quality: each rate against its threshold, the field's
// level for G5, the entity's level from its worst measurement. Pure.
import { pct } from './ledger';
import { minLevel, type Issue, type Judgement, type Num } from './levels';
import type { FieldQuality, QualityMeasure, RateMeasure } from './measures';
import { SEVERE_RATE } from './rubric';
import type { ReadinessLevel } from './readiness.types';

// D2 -----------------------------------------------------------------------

/** One rate against its threshold: 1 above SEVERE_RATE, 2 above the threshold, 3 within. */
const rateLevel = (r: RateMeasure): Num =>
  r.rate > SEVERE_RATE ? 1 : r.rate > r.threshold ? 2 : 3;

/** A critical field's quality level (G5): 0 without a source, else its worst rate. */
export function fieldLevel(f: FieldQuality): ReadinessLevel {
  if (f.missing) return 0;
  const rates = [f.nulls, f.format, f.sentinels].filter(
    (r): r is RateMeasure => !!r,
  );
  return rates.length ? minLevel(rates.map(rateLevel)) : 'N/E';
}

function rateIssue(
  entity: string,
  column: string | undefined,
  what: string,
  r: RateMeasure,
  indispensable: boolean,
  count = '',
): Issue | undefined {
  const level = rateLevel(r);
  if (level === 3) return undefined;
  const blocking = indispensable && level === 1;
  return {
    dimension: 'D2',
    ...(blocking ? { gate: 'G5' as const } : {}),
    severity: blocking
      ? 'blocking'
      : level === 1 || indispensable
        ? 'high'
        : 'medium',
    entity,
    column,
    measured: `${pct(r.rate)} ${what}${count}`,
    threshold: `<= ${pct(r.threshold)} ${what}`,
    description: `${column ? `\`${column}\` of ${entity}` : entity}: ${pct(r.rate)} ${what}${count}${level === 1 ? ' (severe: above 20%)' : ''}.`,
    evidenceIds: [r.evidenceId],
  };
}

export function qualityLevel(m: QualityMeasure): Judgement {
  const issues: Issue[] = [];
  const levels: Num[] = [];
  const evidence = new Set<string>();
  for (const f of m.fields) {
    f.evidenceIds.forEach((id) => evidence.add(id));
    const lvl = fieldLevel(f);
    if (lvl !== 'N/E') levels.push(lvl);
    if (f.missing) {
      issues.push({
        dimension: 'D2',
        ...(f.indispensable ? { gate: 'G5' as const } : {}),
        severity: f.indispensable ? 'blocking' : 'high',
        entity: m.entity,
        column: f.column,
        measured: 'column not found',
        threshold: 'the field exists',
        description: `Critical field \`${f.column}\` has no source in ${m.entity}.`,
        evidenceIds: f.evidenceIds,
      });
    }
    const checks: [string, RateMeasure | undefined][] = [
      ['null or blank', f.nulls],
      [`invalid ${f.format?.rule ?? ''} format`, f.format],
      ['sentinel values', f.sentinels],
    ];
    for (const [what, r] of checks) {
      const issue =
        r && rateIssue(m.entity, f.column, what, r, f.indispensable);
      if (issue) issues.push(issue);
    }
  }
  if (m.duplicates) {
    evidence.add(m.duplicates.evidenceId);
    levels.push(rateLevel(m.duplicates));
    const issue = rateIssue(
      m.entity,
      m.duplicates.columns.join(', '),
      'duplicate grain keys',
      m.duplicates,
      false,
      ` (${m.duplicates.duplicates} rows)`,
    );
    if (issue) issues.push(issue);
  }
  for (const v of m.validity) {
    evidence.add(v.evidenceId);
    levels.push(rateLevel(v));
    const what = v.check === 'format' ? 'invalid format' : 'sentinel values';
    const issue = rateIssue(m.entity, v.column, what, v, false);
    if (issue) issues.push(issue);
  }
  for (const o of m.orphans) {
    evidence.add(o.evidenceId);
    const issue = rateIssue(
      m.entity,
      o.column,
      `orphan references to ${o.target}`,
      o,
      false,
    );
    if (!o.declared) {
      // An inferred join may be wrong: reported, never scored.
      if (issue)
        issues.push({
          ...issue,
          severity: 'low',
          description: `${issue.description} The reference is inferred, so it does not change the level.`,
        });
      continue;
    }
    levels.push(rateLevel(o));
    if (issue) issues.push(issue);
  }
  const base = { entity: m.entity, evidenceIds: [...evidence], issues };
  if (!levels.length) {
    return {
      ...base,
      level: 'N/E',
      reason: `Not evaluated: ${[...m.notes, ...m.fields.flatMap((f) => (f.notEvaluated ? [`\`${f.column}\`: ${f.notEvaluated}`] : []))].join('; ') || 'nothing could be measured'}.`,
    };
  }
  const level = minLevel(levels);
  const scope = m.window ? ` (${m.window})` : '';
  const reason =
    level <= 1
      ? `Level 1: severe failures in key fields${scope}.`
      : level === 2
        ? `Level 2: moderate failures above the use's thresholds${scope}; no tests known.`
        : `Level 3: within the use's thresholds${scope}. Level 4 needs automatic tests and alerts, not evaluated.`;
  return { ...base, level, reason };
}
