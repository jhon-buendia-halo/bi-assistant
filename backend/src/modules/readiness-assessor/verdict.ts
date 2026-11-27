// Rubric 3.5 (weighted score) and 3.6 (verdict), applied literally. The
// verdict comes from the gates and the minimums, never from the average, and
// is never rounded up: whatever the table does not clearly allow is
// `not-ready`. Pure.
import { round } from './ledger';
import { DIMENSION_NAMES, isCritical } from './rubric';
import type {
  DimensionResult,
  GateResult,
  ReadinessDimension,
  ReadinessFinding,
  ReadinessVerdict,
} from './readiness.types';

const numeric = (
  d: DimensionResult,
): d is DimensionResult & { level: 0 | 1 | 2 | 3 | 4 } => d.level !== 'N/E';

export interface VerdictDecision {
  verdict: ReadinessVerdict;
  /** Why, rule by rule, in the order of table 3.6. */
  reasons: string[];
}

/**
 * Table 3.6. `mitigated` names the level-2 dimensions that carry at least
 * one verifiable condition.
 */
export function decideVerdict(
  gates: GateResult[],
  dimensions: DimensionResult[],
  mitigated: ReadinessDimension[],
): VerdictDecision {
  const applicable = dimensions.filter((d) => d.applicable);
  const reasons: string[] = [];
  const failed = gates.filter((g) => g.status === 'fail');
  const unpassed = gates.filter((g) => g.status === 'not-evaluated');
  const below2 = applicable.filter((d) => numeric(d) && d.level < 2);
  const criticalNE = applicable.filter(
    (d) => d.level === 'N/E' && isCritical(d.weight),
  );
  if (failed.length)
    reasons.push(`Gate failed: ${failed.map((g) => g.gate).join(', ')}.`);
  if (below2.length)
    reasons.push(
      `Dimension below level 2: ${below2.map((d) => `${d.dimension} = ${d.level}`).join(', ')}.`,
    );
  if (criticalNE.length)
    reasons.push(
      `Critical dimension not evaluated: ${criticalNE.map((d) => d.dimension).join(', ')}.`,
    );
  if (reasons.length) return { verdict: 'not-ready', reasons };
  if (unpassed.length) {
    // "All gates pass" is not met, and a gate without evidence is never a pass.
    return {
      verdict: 'not-ready',
      reasons: [
        `Gate not evaluated, so not every gate passes: ${unpassed.map((g) => g.gate).join(', ')}.`,
      ],
    };
  }
  const below3 = applicable.filter((d) => numeric(d) && d.level < 3);
  if (!below3.length) {
    return {
      verdict: 'ready',
      reasons: [
        'Every gate passes, no applicable dimension is below 3 and no critical dimension is N/E.',
      ],
    };
  }
  const level2 = applicable.filter((d) => d.level === 2);
  const unmitigated = level2.filter((d) => !mitigated.includes(d.dimension));
  if (unmitigated.length) {
    return {
      verdict: 'not-ready',
      reasons: [
        `Level-2 dimension without a documented mitigation: ${unmitigated.map((d) => d.dimension).join(', ')}.`,
      ],
    };
  }
  return {
    verdict: 'ready-with-conditions',
    reasons: [
      `Every gate passes, no dimension is below 2, and each level-2 dimension (${level2.map((d) => d.dimension).join(', ')}) carries a condition.`,
    ],
  };
}

/**
 * Rubric 3.5 weighted score, 0..4, a progress indicator only. N/E weights
 * are redistributed proportionally (and said); no score when a dimension
 * weighing >= 20% is N/E.
 */
export function weightedScore(dimensions: DimensionResult[]): {
  score: number | null;
  note?: string;
} {
  const applicable = dimensions.filter(
    (d) => d.applicable && d.weight !== null,
  );
  const missing = applicable.filter((d) => d.level === 'N/E');
  const heavy = missing.filter((d) => isCritical(d.weight));
  if (heavy.length) {
    return {
      score: null,
      note: `No weighted score: ${heavy.map((d) => `${d.dimension} (${Math.round(d.weight! * 100)}%)`).join(', ')} not evaluated, and a dimension weighing 20% or more cannot be left out.`,
    };
  }
  const scored = applicable.filter(numeric);
  const total = scored.reduce((s, d) => s + d.weight!, 0);
  if (!scored.length || total <= 0)
    return { score: null, note: 'No dimension was evaluated.' };
  const score = round(
    scored.reduce((s, d) => s + d.weight! * d.level, 0) / total,
    2,
  );
  if (!missing.length) return { score };
  return {
    score,
    note: `${missing.map((d) => `${d.dimension} (${Math.round(d.weight! * 100)}%)`).join(', ')} not evaluated: its weight was redistributed proportionally over ${scored.map((d) => d.dimension).join(', ')}.`,
  };
}

/**
 * One verifiable condition per finding of each level-2 dimension (measured
 * value back within its threshold), else one from the level's reason.
 */
export function buildConditions(
  dimensions: DimensionResult[],
  findings: ReadinessFinding[],
): Map<ReadinessDimension, string[]> {
  const out = new Map<ReadinessDimension, string[]>();
  for (const d of dimensions.filter((x) => x.applicable && x.level === 2)) {
    const own = findings.filter(
      (f) => f.dimension === d.dimension && f.severity !== 'low',
    );
    const list = own.map((f) => {
      const where = f.column
        ? `\`${f.column}\` of ${f.entity}`
        : (f.entity ?? 'the critical sources');
      return f.threshold
        ? `${d.dimension}: ${where} from ${f.measured} to ${f.threshold}, re-measured before relying on it (${f.id}); until then use it with that limitation stated.`
        : `${d.dimension}: ${f.description} (${f.id})`;
    });
    if (!list.length) {
      list.push(
        `${d.dimension} (${DIMENSION_NAMES[d.dimension]}): ${d.reason} Re-assess once this is addressed; until then use it with that limitation stated.`,
      );
    }
    out.set(d.dimension, list);
  }
  return out;
}
