import { Inject, Injectable } from '@nestjs/common';
import { READINESS_REPORTS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import type { ReadinessReport } from './engine/types';
import { notImplemented } from './engine/not-implemented';

/** Stored assessments, collection `readiness_reports` (unit 8, BA-259). */
@Injectable()
export class DataReadinessRepository {
  constructor(
    @Inject(READINESS_REPORTS_STORE)
    private readonly store: DocStore<ReadinessReport>,
  ) {}

  insert(report: ReadinessReport): Promise<ReadinessReport> {
    void report;
    void this.store;
    return Promise.resolve(notImplemented('DataReadinessRepository.insert'));
  }

  /** Newest first. */
  listByDatasource(datasourceId: string): Promise<ReadinessReport[]> {
    void datasourceId;
    return Promise.resolve(notImplemented('DataReadinessRepository.list'));
  }

  get(id: string): Promise<ReadinessReport | null> {
    void id;
    return Promise.resolve(notImplemented('DataReadinessRepository.get'));
  }
}
