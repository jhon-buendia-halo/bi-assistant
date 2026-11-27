// Rubric 3.3 applied to the measures, per critical entity, then per
// dimension (the weakest critical source, never the average). Between two
// levels the lower one; level 4 needs automatic controls the app cannot see.
// Pure: measures in, levels and finding drafts out. D1, D4 and the combining
// rule here; D2 in levels-quality.ts, D3 in levels-freshness.ts, D5 and D6 in
// levels-privacy.ts.
import { pct } from './ledger';
import type { AvailabilityMeasure, SemanticsMeasure } from './measures';
import type {
  ReadinessDimension,
  ReadinessFinding,
  ReadinessLevel,
} from './readiness.types';

export type Issue = Omit<ReadinessFinding, 'id'>;

export interface Judgement {
  entity: string;
  level: ReadinessLevel;
  reason: string;
  evidenceIds: string[];
  issues: Issue[];
}

export type Num = 0 | 1 | 2 | 3 | 4;
export const minLevel = (levels: Num[]): Num =>
  levels.reduce<Num>((a, b) => (b < a ? b : a), 3);
// D1 -----------------------------------------------------------------------

export function availabilityLevel(m: AvailabilityMeasure): Judgement {
  const j = {
    entity: m.entity,
    evidenceIds: m.evidenceIds,
    issues: [] as Issue[],
  };
  if (!m.found || !m.accessible) {
    const reason = m.found
      ? `not accessible (${m.reason ?? 'unknown error'})`
      : `does not exist (${m.reason ?? 'not found'})`;
    j.issues.push({
      dimension: 'D1',
      gate: 'G1',
      severity: 'blocking',
      entity: m.entity,
      measured: m.found ? 'query failed' : 'not found',
      threshold: 'answers COUNT(*)',
      description: `${m.entity} ${reason}.`,
      evidenceIds: m.evidenceIds,
    });
    return { ...j, level: 0, reason: `Level 0: ${reason}.` };
  }
  const rows = `${m.rowCount ?? 0} rows`;
  if (!m.owner) {
    j.issues.push({
      dimension: 'D1',
      severity: 'high',
      entity: m.entity,
      measured: 'no owner',
      threshold: 'an identifiable owner',
      description: `Dataset ${m.dataset || m.entity} has no owner named in the scoping card.`,
      evidenceIds: m.evidenceIds,
    });
    return {
      ...j,
      level: 1,
      reason: `Level 1: exists (${rows}) but has no owner.`,
    };
  }
  if (m.manualAccess) {
    j.issues.push({
      dimension: 'D1',
      severity: 'medium',
      entity: m.entity,
      measured: 'uploaded file',
      threshold: 'programmatic access to the source',
      description: `${m.entity} comes from an uploaded file (manual export), not from the source system.`,
      evidenceIds: m.evidenceIds,
    });
    return {
      ...j,
      level: 2,
      reason: `Level 2: accessible (${rows}) only through a manual export (uploaded file); owner ${m.owner}.`,
    };
  }
  return {
    ...j,
    level: 3,
    reason: `Level 3: programmatic access (SQL, ${rows}) and an owner (${m.owner}, from the scoping card). Level 4 needs governed self-service and a support channel, not evaluated.`,
  };
}
// D4 -----------------------------------------------------------------------

export function semanticsLevel(m: SemanticsMeasure): Judgement {
  const evidenceIds = m.evidenceId ? [m.evidenceId] : [];
  const base = { entity: m.entity, evidenceIds, issues: [] as Issue[] };
  if (!m.measured || !m.keyColumns.length) {
    return {
      ...base,
      level: 'N/E',
      reason: 'Not evaluated: the dataset keeps no column metadata for it.',
    };
  }
  const share =
    (m.keyColumns.length - m.undocumentedKeys.length) / m.keyColumns.length;
  if (m.undocumentedKeys.length) {
    base.issues.push({
      dimension: 'D4',
      severity: share < 0.5 ? 'high' : 'medium',
      entity: m.entity,
      measured: `${pct(share)} of key columns described`,
      threshold: '100% of key columns described',
      description: `Key columns without a useful description in ${m.entity}: ${m.undocumentedKeys
        .slice(0, 10)
        .map((c) => `\`${c}\``)
        .join(', ')}${m.undocumentedKeys.length > 10 ? '…' : ''}.`,
      evidenceIds,
    });
  }
  if (m.cryptic.length) {
    base.issues.push({
      dimension: 'D4',
      severity: 'low',
      entity: m.entity,
      measured: `${m.cryptic.length} cryptic column name(s)`,
      description: `Cryptic names in ${m.entity}: ${m.cryptic
        .slice(0, 10)
        .map((c) => `\`${c}\``)
        .join(', ')}.`,
      evidenceIds,
    });
  }
  const level: Num = share === 0 ? 1 : share < 1 ? 2 : 3;
  const reason =
    level === 1
      ? 'Level 1: no key column is documented.'
      : level === 2
        ? `Level 2: partial documentation (${pct(share)} of key columns).`
        : 'Level 3: every key column is documented. Level 4 needs governed metrics and lineage, not evaluated.';
  return { ...base, level, reason };
}
// Per dimension -------------------------------------------------------------

/**
 * The dimension takes the level of its weakest critical source (scoring
 * rule); sources not evaluated are left out and declared by the caller.
 */
export function combine(
  dimension: ReadinessDimension,
  judgements: Judgement[],
): { level: ReadinessLevel; reason: string; evidenceIds: string[] } {
  const scored = judgements.filter((j) => j.level !== 'N/E');
  if (!scored.length) {
    const why = judgements.map((j) => `${j.entity}: ${j.reason}`).join(' ');
    return {
      level: 'N/E',
      reason: why || `${dimension}: nothing to evaluate.`,
      evidenceIds: [],
    };
  }
  const weakest = scored.reduce((a, b) =>
    (b.level as Num) < (a.level as Num) ? b : a,
  );
  const evidenceIds = [...new Set(scored.flatMap((j) => j.evidenceIds))];
  const reason =
    judgements.length > 1
      ? `Weakest critical source ${weakest.entity}. ${weakest.reason}`
      : weakest.reason;
  return { level: weakest.level, reason, evidenceIds };
}
