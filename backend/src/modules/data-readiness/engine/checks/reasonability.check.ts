import type { CheckContext, CheckResult, EntityProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** reasonability check (unit 3, BA-254). */
export function reasonabilityCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void entity;
  void ctx;
  return notImplemented('reasonabilityCheck');
}
