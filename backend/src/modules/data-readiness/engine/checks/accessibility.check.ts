import type { CheckContext, CheckResult, SourceProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** accessibility check (unit 3, BA-254). */
export function accessibilityCheck(
  profile: SourceProfile,
  ctx: CheckContext,
): CheckResult {
  void profile;
  void ctx;
  return notImplemented('accessibilityCheck');
}
