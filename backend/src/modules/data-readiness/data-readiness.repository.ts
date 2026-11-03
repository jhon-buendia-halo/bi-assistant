import { Inject, Injectable } from '@nestjs/common';
import { READINESS_REPORTS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import type { ReadinessReport } from './engine/types';

/** Stored assessments, collection `readiness_reports` (unit 8, BA-259). */
@Injectable()
export class DataReadinessRepository {
  constructor(
    @Inject(READINESS_REPORTS_STORE)
    private readonly store: DocStore<ReadinessReport>,
  ) {}

  insert(report: ReadinessReport): Promise<ReadinessReport> {
    return this.store.insert(report);
  }

  /** Newest `generatedAt` first (data-model 3.15). */
  listByDatasource(datasourceId: string): Promise<ReadinessReport[]> {
    return this.store.find({ datasourceId }, { sort: { generatedAt: -1 } });
  }

  get(id: string): Promise<ReadinessReport | null> {
    return this.store.findOne({ id });
  }
}
