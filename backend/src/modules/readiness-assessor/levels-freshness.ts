// Rubric 3.3 for D3 Freshness, from the load proxy, and the G6 test. Pure.
import { pct } from './ledger';
import type { Issue, Judgement } from './levels';
import type { FreshnessMeasure } from './measures';
import { ON_TIME_LEVEL_1, ON_TIME_LEVEL_3 } from './rubric';
import type { ReadinessScope } from './readiness.types';

// D3 -----------------------------------------------------------------------

/** G6 for one entity: the newest row is older than required, or rows come less often. */
export function freshnessFails(
  m: FreshnessMeasure,
  requiredHours?: number,
): boolean {
  if (requiredHours === undefined || m.ageHours === undefined) return false;
  const gap = m.volume?.medianGapDays;
  return (
    m.ageHours > requiredHours ||
    (gap !== null && gap !== undefined && gap * 24 > requiredHours)
  );
}

export function freshnessLevel(
  m: FreshnessMeasure,
  scope: ReadinessScope,
): Judgement {
  const required = scope.requiredFreshnessHours;
  const evidenceIds = [m.maxEvidenceId, m.volume?.evidenceId].filter(
    (id): id is string => !!id,
  );
  const base = { entity: m.entity, evidenceIds, issues: [] as Issue[] };
  if (m.ageHours === undefined || !m.dateColumn) {
    return {
      ...base,
      level: 'N/E',
      reason: `Not evaluated: ${m.reason ?? 'no date column'}.`,
    };
  }
  const v = m.volume;
  const share = v?.onTimeShare ?? null;
  const facts = `newest \`${m.dateColumn}\` ${m.ageHours} h old${v ? `; rows on ${v.daysWithRows} of the last ${v.windowDays} days${v.medianGapDays !== null ? `, every ${v.medianGapDays} days (median)` : ''}` : ''}`;
  if (freshnessFails(m, required)) {
    base.issues.push({
      dimension: 'D3',
      gate: 'G6',
      severity: 'blocking',
      entity: m.entity,
      measured: facts,
      threshold: `newest row and load cadence <= ${required} h`,
      description: `${m.entity} arrives less often than the use needs (${facts}).`,
      evidenceIds,
    });
  }
  const issue = (
    severity: Issue['severity'],
    measured: string,
    threshold: string,
    description: string,
  ) =>
    base.issues.push({
      dimension: 'D3',
      severity,
      entity: m.entity,
      measured,
      threshold,
      description,
      evidenceIds,
    });
  if (
    v &&
    (v.daysWithRows === 0 || (share !== null && share < ON_TIME_LEVEL_1))
  ) {
    issue(
      'high',
      `${pct(share ?? 0)} of periods with rows`,
      `>= ${pct(ON_TIME_LEVEL_3)}`,
      `${m.entity} loads irregularly (${facts}).`,
    );
    return {
      ...base,
      level: 1,
      reason: `Level 1: irregular loads (${facts}).`,
    };
  }
  if (required === undefined) {
    issue(
      'medium',
      'no freshness requirement',
      'a required freshness (SLA)',
      `No freshness requirement was set for the use, so there is no SLA to meet.`,
    );
    return {
      ...base,
      level: 2,
      reason: `Level 2: no SLA declared (${facts}).`,
    };
  }
  if (freshnessFails(m, required)) {
    return {
      ...base,
      level: 2,
      reason: `Level 2: below the required ${required} h (${facts}).`,
    };
  }
  if (!v) {
    return {
      ...base,
      level: 2,
      reason: `Level 2: fresh now (${facts}), but the load history could not be measured.`,
    };
  }
  if (share !== null && share < ON_TIME_LEVEL_3) {
    issue(
      'medium',
      `${pct(share)} of periods with rows`,
      `>= ${pct(ON_TIME_LEVEL_3)}`,
      `${m.entity} misses loads (${facts}).`,
    );
    return {
      ...base,
      level: 2,
      reason: `Level 2: ${pct(share)} of periods on time, below 95% (${facts}).`,
    };
  }
  return {
    ...base,
    level: 3,
    reason: `Level 3: meets the required ${required} h${share !== null ? ` in ${pct(share)} of periods` : ''} (${facts}). Level 4 needs monitoring and schema history, not evaluated.`,
  };
}
