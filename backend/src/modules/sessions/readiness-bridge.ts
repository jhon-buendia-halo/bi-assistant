// The Data Readiness Agent's side of a session (BA-261; agents.md 2.10, 3.13,
// 4.1 Block D1): the readiness tool-services bridge, the dataset resolution
// the three tools share, the summary the model sees, and the panel item and
// answer reference a report becomes. Kept out of sessions.service.ts so the
// orchestrator only wires it in.

import { HttpException } from '@nestjs/common';
import type { DatasourceKind } from '../datasources/entities/datasource.entity';
import type {
  ReadinessReportList,
  ReadinessToolReport,
  ReadinessToolServices,
} from '../../mastra/readiness-tool-services';
import type {
  Finding,
  ReadinessReport,
  ReadinessReportSummary,
  ReadinessSummary,
  Severity,
} from '../data-readiness/engine/types';
import type { ReadinessProgressListener } from '../data-readiness/progress';
import type {
  ReadinessPanelItem,
  ReadinessReportRef,
} from './entities/session.entity';

/** The Data Readiness Agent's registry key (agents.md 2.10, ADR-0031). */
export const DATA_READINESS_AGENT_KEY = 'data-readiness';
/** Max steps of a Data Readiness Agent turn (agents.md 2.10). */
export const READINESS_MAX_STEPS = 10;
/** The readiness tools of agents.md 3.13: each shows its step. */
export const READINESS_TOOLS: ReadonlySet<string> = new Set([
  'assess_data_readiness',
  'get_readiness_report',
  'list_readiness_reports',
]);
/** The tools whose successful result is a report (data-readiness R5). */
export const READINESS_REPORT_TOOLS: ReadonlySet<string> = new Set([
  'assess_data_readiness',
  'get_readiness_report',
]);
/** `topFindings` cap of the model-facing summary (agents.md 3.13). */
export const SUMMARY_TOP_FINDINGS = 20;
/** Reports remembered for the stream event, newest kept. */
const REPORT_CACHE_SIZE = 50;

const READINESS_KINDS: readonly DatasourceKind[] = ['postgres', 'databricks'];
const UNSUPPORTED_KIND =
  'Data readiness supports PostgreSQL and Databricks datasources only';
const KIND_LABELS: Partial<Record<DatasourceKind, string>> = {
  postgres: 'PostgreSQL',
  databricks: 'Databricks',
};
const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** A session dataset as the bridge needs it. */
export interface ReadinessDataset {
  name: string;
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
  /** Inventory entity keys: the assessment's scope. */
  tables: string[];
}

/** The data-readiness service calls the bridge makes (api.md 2.17). */
export interface ReadinessReports {
  assess(
    input: {
      datasourceId: string;
      entities?: string[];
      sessionId?: string;
    },
    now?: Date,
    options?: {
      signal?: AbortSignal;
      onProgress?: ReadinessProgressListener;
    },
  ): Promise<ReadinessReport>;
  list(datasourceId: string): Promise<{ reports: ReadinessReportSummary[] }>;
  get(id: string): Promise<ReadinessReport>;
}

export interface ReadinessBridgeDeps {
  /** The session's dataset names, in session order. */
  sessionDatasetNames(sessionId: string): Promise<string[]>;
  /** The stored datasets of those names, bound to a datasource. */
  datasets(names: string[]): Promise<ReadinessDataset[]>;
  /** A datasource's name; its id when it cannot be read. */
  datasourceName(datasourceId: string): Promise<string>;
  readiness: ReadinessReports;
}

/** The model-facing summary of a report (agents.md 3.13). */
export function readinessSummary(report: ReadinessReport): ReadinessSummary {
  return {
    reportId: report.id,
    datasourceName: report.datasourceName,
    generatedAt: report.generatedAt,
    entityCount: report.entityCount,
    overallScore: report.overallScore,
    maturity: report.maturity,
    dimensionScores: report.dimensionScores.map((d) => ({ ...d })),
    findingCount: report.findings.length,
    ...(report.notProfiled?.length
      ? { notProfiled: report.notProfiled.map((n) => ({ ...n })) }
      : {}),
    topFindings: topFindings(report.findings).map((f) => ({
      severity: f.severity,
      dimension: f.dimension,
      entity: f.entity,
      field: f.field,
      measured: f.measured,
      description: f.description,
      recommendation: f.recommendation,
    })),
  };
}

/** At most 20 findings, most severe first, then in report order. */
export function topFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] ||
        a.index - b.index,
    )
    .slice(0, SUMMARY_TOP_FINDINGS)
    .map(({ finding }) => finding);
}

/** The `readiness` panel item of a report (data-model 3.4.4). */
export function readinessPanelItem(
  report: ReadinessReport,
  now: Date = new Date(),
): ReadinessPanelItem {
  return {
    id: `readiness:${report.id}`,
    kind: 'readiness',
    title: `Data readiness — ${report.datasourceName}`,
    shownAt: now.toISOString(),
    reportId: report.id,
  };
}

/** The answer's `readinessReport` reference (data-model 3.4.1). */
export function readinessReportRef(
  report: ReadinessReport,
): ReadinessReportRef {
  return {
    reportId: report.id,
    datasourceName: report.datasourceName,
    overallScore: report.overallScore,
    maturity: report.maturity,
    generatedAt: report.generatedAt,
  };
}

/**
 * The answer of a turn that ended on a readiness report without prose, so
 * its readiness card is kept (data-readiness R5).
 */
export function readinessAnswerFallback(ref: ReadinessReportRef): string {
  return `Data readiness of "${ref.datasourceName}": ${ref.overallScore}/100, ${ref.maturity}. The scorecard is open in the panel.`;
}

/**
 * The report id a readiness tool's result names: the summary's `reportId`,
 * or, should a tool return the bridge's `{ report, summary }` as is, theirs.
 * Undefined for an error or any other shape.
 */
export function readinessReportIdOf(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = result as {
    error?: unknown;
    reportId?: unknown;
    summary?: { reportId?: unknown };
    report?: { id?: unknown };
  };
  if (typeof value.error === 'string') return undefined;
  const id =
    value.reportId ?? value.summary?.reportId ?? value.report?.id ?? undefined;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * The full report a readiness tool's raw result carries: the bridge's
 * `{ report, summary }` as the tool returns it (its `toModelOutput` shows the
 * model only `summary`). Undefined for an error or any other shape.
 */
export function readinessReportOf(
  result: unknown,
): ReadinessReport | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = result as { error?: unknown; report?: unknown };
  if (typeof value.error === 'string') return undefined;
  const report = value.report as Partial<ReadinessReport> | undefined;
  return report &&
    typeof report === 'object' &&
    typeof report.id === 'string' &&
    Array.isArray(report.findings) &&
    Array.isArray(report.dimensionScores)
    ? (report as ReadinessReport)
    : undefined;
}

/** One dataset line of Block D1. */
export interface ReadinessOrientationRow {
  name: string;
  datasourceKind?: DatasourceKind;
  datasourceName: string;
  entityCount: number;
}

/** Block D1 (agents.md 4.1): the session's datasets and today; no score. */
export function readinessOrientationBlock(
  rows: readonly ReadinessOrientationRow[],
  today: string,
): string {
  return [
    'Datasets for this session (data readiness):',
    ...rows.map(
      (row) =>
        `- ${row.name} — ${kindLabel(row.datasourceKind)} datasource "${row.datasourceName}", ${row.entityCount} entities`,
    ),
    `Today is ${today}.`,
  ].join('\n');
}

function kindLabel(kind: DatasourceKind | undefined): string {
  return (kind && KIND_LABELS[kind]) ?? kind ?? 'unknown';
}

/**
 * The readiness tool-services bridge (agents.md 3.13), installed by
 * `SessionsService.onModuleInit`. Every failure throws an Error whose message
 * is the text the model sees. The reports it resolves are remembered by id,
 * so the orchestrator can send the full report on the `readiness-report`
 * event while the model only gets the summary.
 */
export class ReadinessBridge implements ReadinessToolServices {
  private readonly reports = new Map<string, ReadinessReport>();

  constructor(private readonly deps: ReadinessBridgeDeps) {}

  async assessReadiness(input: {
    sessionId: string;
    datasetName?: string;
    signal?: AbortSignal;
    onProgress?: ReadinessProgressListener;
  }): Promise<ReadinessToolReport> {
    const dataset = await this.resolveDataset(
      input.sessionId,
      input.datasetName,
    );
    let report: ReadinessReport;
    try {
      const request = {
        datasourceId: dataset.datasourceId,
        entities: dataset.tables,
        sessionId: input.sessionId,
      };
      report =
        input.signal || input.onProgress
          ? await this.deps.readiness.assess(request, undefined, {
              signal: input.signal,
              onProgress: input.onProgress,
            })
          : await this.deps.readiness.assess(request);
    } catch (error) {
      if (statusOf(error) === 502) {
        const name = await this.deps.datasourceName(dataset.datasourceId);
        throw new Error(`Could not reach "${name}": ${messageOf(error)}`);
      }
      throw error;
    }
    return this.toolReport(report);
  }

  async getReadinessReport(input: {
    sessionId: string;
    reportId?: string;
    datasetName?: string;
  }): Promise<ReadinessToolReport> {
    const reportId = input.reportId?.trim();
    if (reportId) {
      // Only a report of one of this session's datasources (agents.md 3.13).
      const report = await this.deps.readiness.get(reportId);
      const names = await this.deps.sessionDatasetNames(input.sessionId);
      const sources = new Set(
        (await this.deps.datasets(names)).map((d) => d.datasourceId),
      );
      if (!sources.has(report.datasourceId)) {
        throw new Error(`Readiness report "${reportId}" not found`);
      }
      return this.toolReport(report);
    }
    const dataset = await this.resolveDataset(
      input.sessionId,
      input.datasetName,
    );
    const { reports } = await this.deps.readiness.list(dataset.datasourceId);
    if (!reports.length) {
      const name = await this.deps.datasourceName(dataset.datasourceId);
      throw new Error(`No assessment has been run for "${name}" yet.`);
    }
    return this.toolReport(await this.deps.readiness.get(reports[0].id));
  }

  async listReadinessReports(input: {
    sessionId: string;
    datasetName?: string;
  }): Promise<ReadinessReportList> {
    const dataset = await this.resolveDataset(
      input.sessionId,
      input.datasetName,
    );
    const [{ reports }, datasourceName] = await Promise.all([
      this.deps.readiness.list(dataset.datasourceId),
      this.deps.datasourceName(dataset.datasourceId),
    ]);
    return {
      datasourceName,
      reports: reports.map((r) => ({
        reportId: r.id,
        generatedAt: r.generatedAt,
        overallScore: r.overallScore,
        maturity: r.maturity,
        entityCount: r.entityCount,
      })),
      total: reports.length,
    };
  }

  /**
   * The full report a readiness tool result names: the one this bridge
   * resolved, else read from the store; undefined when neither has it.
   */
  async reportFor(reportId: string): Promise<ReadinessReport | undefined> {
    const cached = this.reports.get(reportId);
    if (cached) return cached;
    try {
      return await this.deps.readiness.get(reportId);
    } catch {
      return undefined;
    }
  }

  private toolReport(report: ReadinessReport): ReadinessToolReport {
    this.reports.delete(report.id);
    this.reports.set(report.id, report);
    for (const oldest of [...this.reports.keys()]) {
      if (this.reports.size <= REPORT_CACHE_SIZE) break;
      this.reports.delete(oldest);
    }
    return { report, summary: readinessSummary(report) };
  }

  /** Dataset resolution shared by the three tools (agents.md 3.13). */
  private async resolveDataset(
    sessionId: string,
    datasetName?: string,
  ): Promise<ReadinessDataset & { datasourceId: string }> {
    const names = await this.deps.sessionDatasetNames(sessionId);
    const list = names.join(', ');
    const wanted = datasetName?.trim();
    let name: string | undefined;
    if (!wanted) {
      if (names.length > 1) {
        throw new Error(
          `This session has several datasets: ${list}. Name the one to assess.`,
        );
      }
      name = names[0];
    } else {
      name =
        names.find((n) => n === wanted) ??
        names.find((n) => n.toLowerCase() === wanted.toLowerCase());
      if (!name) {
        throw new Error(
          `Dataset "${wanted}" is not in this session. Choose one of: ${list}.`,
        );
      }
    }
    if (!name) throw new Error('This session has no dataset to assess.');
    const dataset = (await this.deps.datasets([name])).find(
      (d) => d.name === name,
    );
    if (!dataset) throw new Error(`Dataset "${name}" no longer exists.`);
    if (
      !dataset.datasourceId ||
      !dataset.datasourceKind ||
      !READINESS_KINDS.includes(dataset.datasourceKind)
    ) {
      throw new Error(UNSUPPORTED_KIND);
    }
    return { ...dataset, datasourceId: dataset.datasourceId };
  }
}

function statusOf(error: unknown): number | undefined {
  return error instanceof HttpException ? error.getStatus() : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
