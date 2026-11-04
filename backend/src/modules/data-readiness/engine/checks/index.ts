import type { EntityCheck, SourceCheck } from '../types';
import { completenessCheck } from './completeness.check';
import { validityCheck } from './validity.check';
import { consistencyCheck } from './consistency.check';
import { uniquenessCheck } from './uniqueness.check';
import { timelinessCheck } from './timeliness.check';
import { reasonabilityCheck } from './reasonability.check';
import { integrityCheck } from './integrity.check';
import { accessibilityCheck } from './accessibility.check';

/** Entity-level checks, in the reference engine's order. */
export const ENTITY_CHECKS: EntityCheck[] = [
  completenessCheck,
  reasonabilityCheck,
  uniquenessCheck,
  timelinessCheck,
  validityCheck,
  consistencyCheck,
];

/** Source-level checks, run once over the whole profile. */
export const SOURCE_CHECKS: SourceCheck[] = [
  integrityCheck,
  accessibilityCheck,
];
