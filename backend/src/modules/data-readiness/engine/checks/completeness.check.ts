import type { CheckContext, CheckResult, EntityProfile } from '../types';
import { notImplemented } from '../not-implemented';

/** completeness check (unit 2, BA-253). */
export function completenessCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  void entity;
  void ctx;
  return notImplemented('completenessCheck');
}
