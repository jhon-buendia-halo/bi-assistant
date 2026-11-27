// Stub owned by U1 (engine): replaced by the doc-store repository. Methods are the contract.
import { Injectable } from '@nestjs/common';
import type { ReadinessAssessment } from './readiness.types';

@Injectable()
export class ReadinessAssessmentsRepository {
  /** Store one assessment; it becomes the baseline of the next with the same `useCaseKey`. */
  save(_assessment: ReadinessAssessment): Promise<void> {
    return Promise.reject(new Error('not implemented yet'));
  }

  /** The newest assessment with this `useCaseKey`, or null. */
  latest(_useCaseKey: string): Promise<ReadinessAssessment | null> {
    return Promise.resolve(null);
  }
}
