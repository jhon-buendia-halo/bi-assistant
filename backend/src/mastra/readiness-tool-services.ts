import type { ReadinessAssessment } from '../modules/readiness-assessor/readiness.types';

// DI bridge for Dana's `assess_readiness` (plan data-readiness-assessor 2),
// the same pattern as tool-services: the tool is built at module load with
// no Nest DI, so `SessionsService.onModuleInit` installs the stored
// assessments (`ReadinessAssessmentsRepository`) at boot.

/** What `assess_readiness` needs from the store of past assessments. */
export interface ReadinessToolServices {
  /** The newest assessment with this `useCaseKey`, or null: the baseline. */
  previous(useCaseKey: string): Promise<ReadinessAssessment | null>;
  /** Store one assessment, the baseline of the next. */
  save(assessment: ReadinessAssessment): Promise<void>;
}

let services: ReadinessToolServices | null = null;

export function setReadinessToolServices(impl: ReadinessToolServices): void {
  services = impl;
}

export function getReadinessToolServices(): ReadinessToolServices {
  if (!services) {
    throw new Error('Readiness tool services not installed yet');
  }
  return services;
}
