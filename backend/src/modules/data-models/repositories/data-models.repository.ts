import { Inject, Injectable } from '@nestjs/common';
import { DATA_MODELS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { DataModel } from '../entities/data-model.entity';
import type { DriftReport } from '../drift';

/**
 * One immutable version of a dataset's data model. Versions are
 * append-only — a save (or a bootstrap refresh) always adds one rather than
 * mutating an existing entry (ADR-0006).
 */
export interface DataModelVersion {
  version: number;
  createdAt: string;
  source: 'bootstrap' | 'user' | 'import';
  yaml: string;
  model: DataModel;
  /** Set on machine-written (`source: 'bootstrap'`) versions produced by the
   * metrics-panel sync or a snapshot merge, e.g. "metric avg_attendance
   * synced from the metrics panel" — distinguishes an automatic version
   * from a genuine re-bootstrap in the version history. */
  note?: string;
}

/** One document per dataset. `dataset` is the dataset's own `name` — the
 * identifier it is addressed by everywhere else in the app. */
export interface DataModelDoc {
  dataset: string;
  currentVersion: number;
  versions: DataModelVersion[];
  lastDrift?: DriftReport;
  /**
   * Metric names authored directly through the model-metrics API (roadmap
   * 1.2.3), lowercase. This is what lets `DataModelsService.syncMetric` /
   * `removeMetric` (the legacy metrics-panel mirror, ADR-0006) tell "a name
   * this model now manages itself" from "a name only the legacy `metrics`
   * store ever wrote" — the model wins for the former; the mirror still
   * applies for the latter. Doc-level (not per-version) because it is
   * mutable mirror bookkeeping, the same shape as `lastDrift`.
   */
  localMetricNames?: string[];
  /**
   * Metric names explicitly removed through the model-metrics API
   * (lowercase) — a tombstone (review finding 6) so `rebootstrap`,
   * `mergeSnapshot` and `syncMetric` never reintroduce a copy sourced from
   * the legacy `metrics` store just because a name the model deleted still
   * exists there. Cleared for a name when `createModelMetric`/
   * `updateModelMetric` brings it back under model management.
   */
  deletedMetricNames?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Versioned data models, one document per dataset, upserted by `dataset`
 * name. Callers (the service layer) hand in the whole next document state —
 * `DocStore.update`'s patch only ever shallow-merges, so appending a version
 * or moving the current pointer is a read-modify-write at the service layer,
 * not something this repository can express as a partial patch.
 */
@Injectable()
export class DataModelsRepository {
  constructor(
    @Inject(DATA_MODELS_STORE)
    private readonly store: DocStore<DataModelDoc>,
  ) {}

  list(): Promise<DataModelDoc[]> {
    return this.store.find({});
  }

  findByDataset(dataset: string): Promise<DataModelDoc | null> {
    return this.store.findOne({ dataset });
  }

  save(doc: DataModelDoc): Promise<DataModelDoc | null> {
    return this.store.update({ dataset: doc.dataset }, doc, { upsert: true });
  }

  delete(dataset: string): Promise<number> {
    return this.store.deleteOne({ dataset });
  }
}
