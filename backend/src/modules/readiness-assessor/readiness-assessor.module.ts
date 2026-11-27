import { Module } from '@nestjs/common';
import { ReadinessAssessmentsRepository } from './readiness-assessments.repository';

@Module({
  providers: [ReadinessAssessmentsRepository],
  exports: [ReadinessAssessmentsRepository],
})
export class ReadinessAssessorModule {}
