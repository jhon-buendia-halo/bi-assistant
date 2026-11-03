import { dimensions } from './dimensions';
import type {
  Dimension,
  DimensionScore,
  Finding,
  Maturity,
  Severity,
} from './types';

export type CheckCounts = Partial<Record<Dimension, number>>;

const WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 0.1,
  medium: 0.4,
  high: 1.0,
};

const SEVERITY_RANK: Record<Severity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
};

function maxSeverityOf(findings: Finding[]): Severity | null {
  let max: Severity | null = null;
  for (const f of findings) {
    if (max === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[max]) {
      max = f.severity;
    }
  }
  return max;
}

/**
 * Per-dimension proportional score: round(100 x (1 - sum(weight) / checks)),
 * clamped to 0..100; 100 when no checks ran. Accuracy and currency are listed
 * as not assessed: score 100, 0 checks.
 */
export function scoreDimensions(
  findings: Finding[],
  checkCounts: CheckCounts,
): DimensionScore[] {
  return dimensions().map((dim) => {
    const dimFindings = findings.filter((f) => f.dimension === dim.id);
    const totalChecks = dim.assessed ? (checkCounts[dim.id] ?? 0) : 0;
    const weighted = dimFindings.reduce(
      (sum, f) => sum + WEIGHT[f.severity],
      0,
    );
    const score =
      !dim.assessed || totalChecks <= 0
        ? 100
        : Math.max(
            0,
            Math.min(100, Math.round(100 * (1 - weighted / totalChecks))),
          );
    return {
      dimension: dim.id,
      score,
      findingCount: dimFindings.length,
      maxSeverity: maxSeverityOf(dimFindings),
      assessed: dim.assessed,
      totalChecks,
    };
  });
}

/** Mean of assessed dimensions and its maturity band. */
export function overallMaturity(scores: DimensionScore[]): {
  overallScore: number;
  maturity: Maturity;
} {
  const assessed = scores.filter((s) => s.assessed);
  if (assessed.length === 0) return { overallScore: 0, maturity: 'Initial' };
  const overallScore = Math.round(
    assessed.reduce((sum, s) => sum + s.score, 0) / assessed.length,
  );
  const maturity: Maturity =
    overallScore >= 95
      ? 'Optimised'
      : overallScore >= 85
        ? 'Managed'
        : overallScore >= 70
          ? 'Defined'
          : overallScore >= 50
            ? 'Repeatable'
            : 'Initial';
  return { overallScore, maturity };
}
