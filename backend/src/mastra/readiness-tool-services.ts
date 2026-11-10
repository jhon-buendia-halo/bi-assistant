// DI bridge for the data readiness tools (BA-251, agents.md 3.13), same
// pattern as tool-services.ts: tools are built at module load with no Nest DI,
// so SessionsService installs the implementation at boot (unit 10, BA-261).
// Kept beside tool-services.ts so DatasetToolServices' implementers are untouched.

import type { ReadinessProgressListener } from '../modules/data-readiness/progress';
import type {
  ReadinessReport,
  ReadinessSummary,
} from '../modules/data-readiness/engine/types';

/** A report plus what the model may see; only `summary` reaches the model. */
export interface ReadinessToolReport {
  report: ReadinessReport;
  summary: ReadinessSummary;
}

/** `list_readiness_reports` output (agents.md 3.13). */
export interface ReadinessReportList {
  datasourceName: string;
  reports: {
    reportId: string;
    generatedAt: string;
    overallScore: number;
    maturity: ReadinessReport['maturity'];
    entityCount: number;
  }[];
  total: number;
}

/**
 * Every method resolves the dataset as agents.md 3.13 "Dataset resolution"
 * says and throws an Error whose message is the text the model should see;
 * the tools turn it into `{ error }`.
 */
export interface ReadinessToolServices {
  assessReadiness(input: {
    sessionId: string;
    datasetName?: string;
    /** BA-324: the turn's abort signal; an abort rejects with AbortError. */
    signal?: AbortSignal;
    /** BA-324: live progress, streamed to the chat; never shown to the model. */
    onProgress?: ReadinessProgressListener;
  }): Promise<ReadinessToolReport>;
  getReadinessReport(input: {
    sessionId: string;
    reportId?: string;
    datasetName?: string;
  }): Promise<ReadinessToolReport>;
  listReadinessReports(input: {
    sessionId: string;
    datasetName?: string;
  }): Promise<ReadinessReportList>;
}

/** The stream event the session emits when a readiness tool returns a report. */
export const READINESS_REPORT_EVENT = 'readiness-report';

let services: ReadinessToolServices | null = null;

export function setReadinessToolServices(impl: ReadinessToolServices): void {
  services = impl;
}

export function getReadinessToolServices(): ReadinessToolServices {
  if (!services) throw new Error('Readiness tool services not installed yet');
  return services;
}
