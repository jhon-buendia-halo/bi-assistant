import type { CheckContext, CheckResult, SourceProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** integrity check (unit 3, BA-254). */
export function integrityCheck(
  profile: SourceProfile,
  ctx: CheckContext,
): CheckResult {
  void profile;
  void ctx;
  return notImplemented('integrityCheck');
}
