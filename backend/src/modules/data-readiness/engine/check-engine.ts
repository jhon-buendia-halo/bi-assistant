import type { CheckContext, EngineResult, SourceProfile } from './types';
import { notImplemented } from './not-implemented';

/**
 * Run every check over the profile and score it (unit 1, BA-252). Pure: the
 * same profile and ctx always give the same result. Uses ENTITY_CHECKS and
 * SOURCE_CHECKS from ./checks.
 */
export function runAssessment(
  profile: SourceProfile,
  ctx: CheckContext,
): EngineResult {
  void profile;
  void ctx;
  return notImplemented('runAssessment');
}
