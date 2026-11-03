import type { CheckContext, CheckResult, EntityProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** uniqueness check (unit 2, BA-253). */
export function uniquenessCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void entity;
  void ctx;
  return notImplemented('uniquenessCheck');
}
