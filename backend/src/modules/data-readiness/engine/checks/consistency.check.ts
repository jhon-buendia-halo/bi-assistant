import type { CheckContext, CheckResult, EntityProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** consistency check (unit 2, BA-253). */
export function consistencyCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void entity;
  void ctx;
  return notImplemented('consistencyCheck');
}
