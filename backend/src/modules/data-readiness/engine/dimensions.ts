import type { Dimension } from './types';
import { notImplemented } from './not-implemented';

export interface DimensionDef {
  id: Dimension;
  label: string;
  /** False for accuracy and currency: listed, never scored. */
  assessed: boolean;
}

/** All ten DMBOK dimensions in display order (unit 1, BA-252). */
export function dimensions(): DimensionDef[] {
  return notImplemented('dimensions');
}
