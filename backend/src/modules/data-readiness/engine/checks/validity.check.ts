import type { CheckContext, CheckResult, EntityProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** validity check (unit 2, BA-253). */
export function validityCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void entity;
  void ctx;
  return notImplemented('validityCheck');
}
