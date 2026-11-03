import type { Dimension, DimensionScore, Finding, Maturity } from './types';
import { notImplemented } from './not-implemented';

export type CheckCounts = Partial<Record<Dimension, number>>;

/** Per-dimension proportional scores (unit 1, BA-252). */
export function scoreDimensions(
  findings: Finding[],
  checkCounts: CheckCounts,
): DimensionScore[] {
  void findings;
  void checkCounts;
  return notImplemented('scoreDimensions');
}

/** Mean of assessed dimensions and its maturity band (unit 1, BA-252). */
export function overallMaturity(scores: DimensionScore[]): {
  overallScore: number;
  maturity: Maturity;
} {
  void scores;
  return notImplemented('overallMaturity');
}
