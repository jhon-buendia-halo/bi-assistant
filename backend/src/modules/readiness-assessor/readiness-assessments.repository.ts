import { Inject, Injectable } from '@nestjs/common';
import { READINESS_ASSESSMENTS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import type { ReadinessAssessment } from './readiness.types';

/**
 * One stored assessment (collection `readiness_assessments`). The assessment
 * is kept whole under `assessment`, so the store's own `createdAt` (the
 * write time) never overwrites the assessment's.
 */
export interface ReadinessAssessmentDoc {
  id: string;
  useCaseKey: string;
  assessedAt: string;
  assessment: ReadinessAssessment;
  createdAt?: string;
  updatedAt?: string;
}

/** Dana's assessments, each the baseline of the next with the same `useCaseKey`. */
@Injectable()
export class ReadinessAssessmentsRepository {
  constructor(
    @Inject(READINESS_ASSESSMENTS_STORE)
    private readonly store: DocStore<ReadinessAssessmentDoc>,
  ) {}

  /** Store one assessment; it becomes the baseline of the next with the same `useCaseKey`. */
  async save(assessment: ReadinessAssessment): Promise<void> {
    await this.store.insert({
      id: assessment.id,
      useCaseKey: assessment.useCaseKey,
      assessedAt: assessment.createdAt,
      assessment,
    });
  }

  /** The newest assessment with this `useCaseKey`, or null. */
  async latest(useCaseKey: string): Promise<ReadinessAssessment | null> {
    const doc = await this.store.findOne(
      { useCaseKey },
      { sort: { assessedAt: -1, createdAt: -1 } },
    );
    return doc?.assessment ?? null;
  }
}
