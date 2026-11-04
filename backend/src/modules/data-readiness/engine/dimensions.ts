import type { Dimension } from './types';

export interface DimensionDef {
  id: Dimension;
  label: string;
  /** False for accuracy and currency: listed, never scored. */
  assessed: boolean;
}

const DIMENSIONS: readonly DimensionDef[] = [
  { id: 'completeness', label: 'Completeness', assessed: true },
  { id: 'accuracy', label: 'Accuracy', assessed: false },
  { id: 'validity', label: 'Validity', assessed: true },
  { id: 'consistency', label: 'Consistency', assessed: true },
  { id: 'integrity', label: 'Integrity', assessed: true },
  { id: 'uniqueness', label: 'Uniqueness', assessed: true },
  { id: 'timeliness', label: 'Timeliness', assessed: true },
  { id: 'currency', label: 'Currency', assessed: false },
  { id: 'reasonability', label: 'Reasonability', assessed: true },
  { id: 'accessibility', label: 'Accessibility', assessed: true },
];

/** All ten DMBOK dimensions in display order. */
export function dimensions(): DimensionDef[] {
  return DIMENSIONS.map((d) => ({ ...d }));
}
