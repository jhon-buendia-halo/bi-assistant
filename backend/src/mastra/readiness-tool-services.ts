// DI bridge for the data readiness tools (BA-251), same pattern as
// tool-services.ts: tools are built at module load with no Nest DI, so the
// sessions module installs the implementation at boot (unit 10, BA-261).
// Types mirror modules/data-readiness/engine/types.ts without importing Nest code.

import type {
  ReadinessReport,
  ReadinessReportSummary,
} from '../modules/data-readiness/engine/types';

export interface ReadinessToolServices {
  /** Assess the datasource behind `datasourceId`; stores and returns the report. */
  assessReadiness(input: {
    sessionId: string;
    datasourceId: string;
    namespace?: string;
    entity?: string;
  }): Promise<ReadinessReport>;
  getReadinessReport(id: string): Promise<ReadinessReport>;
  listReadinessReports(datasourceId: string): Promise<ReadinessReportSummary[]>;
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
