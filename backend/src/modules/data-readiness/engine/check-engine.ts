import { ENTITY_CHECKS, SOURCE_CHECKS } from './checks';
import { overallMaturity, scoreDimensions } from './scoring';
import type {
  CheckContext,
  CheckResult,
  Dimension,
  EngineResult,
  Finding,
  SourceProfile,
} from './types';

/**
 * Run every check over the profile and score it. Pure: the same profile and
 * ctx always give the same result. Entity checks run per entity in profile
 * order, then the source checks.
 */
export function runAssessment(
  profile: SourceProfile,
  ctx: CheckContext,
): EngineResult {
  const findings: Finding[] = [];
  const checkCounts: Partial<Record<Dimension, number>> = {};
  const tally = (r: CheckResult): void => {
    findings.push(...r.findings);
    checkCounts[r.dimension] = (checkCounts[r.dimension] ?? 0) + r.checksRun;
  };
  for (const entity of profile.entities) {
    for (const check of ENTITY_CHECKS) tally(check(entity, ctx));
  }
  for (const check of SOURCE_CHECKS) tally(check(profile, ctx));

  const dimensionScores = scoreDimensions(findings, checkCounts);
  const { overallScore, maturity } = overallMaturity(dimensionScores);
  return {
    findings,
    dimensionScores,
    overallScore,
    maturity,
    entityCount: profile.entities.length,
  };
}
