// What the measure-*.ts files hand to levels.ts and gates.ts: per entity,
// the measured values with the evidence that holds them. No personal value.
import type { PiiColumn } from './sample-checks';

export interface AvailabilityMeasure {
  entity: string;
  dataset: string;
  found: boolean;
  accessible: boolean;
  /** Manual-export kind (`file`): rubric D1 "export manual o planillas" → <= 2. */
  manualAccess: boolean;
  rowCount?: number;
  owner?: string;
  reason?: string;
  evidenceIds: string[];
}

export interface RateMeasure {
  rate: number;
  threshold: number;
  evidenceId: string;
}

export interface FieldQuality {
  column: string;
  indispensable: boolean;
  /** The column is not in the entity's metadata: "campo crítico sin fuente". */
  missing?: boolean;
  nulls?: RateMeasure;
  format?: RateMeasure & { rule: string };
  sentinels?: RateMeasure;
  /** Why nothing could be measured on it. */
  notEvaluated?: string;
  evidenceIds: string[];
}

export interface QualityMeasure {
  entity: string;
  measured: boolean;
  /** Critical fields of the entity, measured. */
  fields: FieldQuality[];
  duplicates?: RateMeasure & { columns: string[]; duplicates: number };
  /** Format and sentinel checks of non-critical key columns (grain keys). */
  validity: (RateMeasure & {
    column: string;
    check: 'format' | 'sentinel';
  })[];
  orphans: (RateMeasure & {
    column: string;
    target: string;
    orphans: number;
    declared: boolean;
  })[];
  /** Window applied on a large table. */
  window?: string;
  notes: string[];
}

export interface FreshnessMeasure {
  entity: string;
  dateColumn?: string;
  newest?: string;
  ageHours?: number;
  maxEvidenceId?: string;
  volume?: {
    daysWithRows: number;
    windowDays: number;
    cadenceDays: number;
    medianGapDays: number | null;
    /** Share of periods of `cadenceDays` in the window that got rows. */
    onTimeShare: number | null;
    evidenceId: string;
  };
  reason?: string;
}

export interface SemanticsMeasure {
  entity: string;
  measured: boolean;
  columns: number;
  described: number;
  keyColumns: string[];
  undocumentedKeys: string[];
  cryptic: string[];
  schemaDescribed: boolean;
  layer?: string;
  evidenceId?: string;
}

export interface GovernanceMeasure {
  entity: string;
  scanned: boolean;
  sampleSize: number;
  pii: PiiColumn[];
  nameHints: string[];
  evidenceIds: string[];
  reason?: string;
}

export interface AiFitnessMeasure {
  entity: string;
  measured: boolean;
  describedShare: number;
  layer?: string;
  piiColumns: number;
  codedUndocumented: string[];
  evidenceIds: string[];
}
