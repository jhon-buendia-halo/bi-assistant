// DI bridge for the data readiness tools (BA-251, agents.md 3.13), same
// pattern as tool-services.ts: tools are built at module load with no Nest DI,
// so SessionsService installs the implementation at boot (unit 10, BA-261).
// Kept beside tool-services.ts so DatasetToolServices' implementers are untouched.

import type { ReadinessProgressListener } from '../modules/data-readiness/progress';
import type {
  Dimension,
  Finding,
  ReadinessReport,
  ReadinessSummary,
} from '../modules/data-readiness/engine/types';

/**
 * One page of every finding of a dimension, read from the stored report
 * (`get_readiness_report` with `dimension`, agents.md 3.13, story 1.27.12):
 * most severe first, then in report order; never recomputed.
 */
export interface ReadinessFindingsPage {
  dimension: Dimension;
  /** Findings of the dimension in the report. */
  total: number;
  /** 1-based. */
  page: number;
  /** At least 1, even with no finding. */
  pageCount: number;
  pageSize: number;
  items: Pick<
    Finding,
    | 'severity'
    | 'entity'
    | 'field'
    | 'measured'
    | 'description'
    | 'recommendation'
  >[];
}

/** A report plus what the model may see; only `summary` reaches the model. */
export interface ReadinessToolReport {
  report: ReadinessReport;
  /** `findings` only when `get_readiness_report` was given a dimension. */
  summary: ReadinessSummary & { findings?: ReadinessFindingsPage };
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
    /** Adds that dimension's findings page to the summary (story 1.27.12). */
    dimension?: string;
    /** 1-based page of those findings; the first when absent. */
    page?: number;
  }): Promise<ReadinessToolReport>;
  listReadinessReports(input: {
    sessionId: string;
    datasetName?: string;
  }): Promise<ReadinessReportList>;
}

/**
 * The RequestContext key of the report a workflow run has just stored
 * (the Assess Data Readiness workflow's Explain report step): while set,
 * `assess_data_readiness` refuses and points at that report.
 */
export const ASSESSED_REPORT_CONTEXT_KEY = 'readiness-assessed-report';

/** What `assess_data_readiness` answers once the run has assessed. */
export function alreadyAssessed(reportId: string): string {
  return `This run has already assessed the dataset. Call get_readiness_report with reportId "${reportId}" instead.`;
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
