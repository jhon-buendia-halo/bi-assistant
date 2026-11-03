// Mirror of backend/src/modules/data-readiness/engine/types.ts (BA-251).
// Keep the two in step; the backend file is the source of truth.

import type { ReadinessPanelItem, ReadinessReportRef } from './session.model';

export type ReadinessDimension =
  | 'completeness'
  | 'accuracy'
  | 'validity'
  | 'consistency'
  | 'integrity'
  | 'uniqueness'
  | 'timeliness'
  | 'currency'
  | 'reasonability'
  | 'accessibility';

export type ReadinessSeverity = 'info' | 'low' | 'medium' | 'high';

export type ReadinessMaturity =
  | 'Initial'
  | 'Repeatable'
  | 'Defined'
  | 'Managed'
  | 'Optimised';

export interface ReadinessFinding {
  dimension: ReadinessDimension;
  level: 'entity' | 'source';
  namespace?: string;
  entity?: string;
  field?: string;
  severity: ReadinessSeverity;
  measured?: number | string;
  description: string;
  recommendation: string;
}

export interface ReadinessDimensionScore {
  dimension: ReadinessDimension;
  score: number;
  findingCount: number;
  maxSeverity: ReadinessSeverity | null;
  assessed: boolean;
  totalChecks: number;
}

export interface ReadinessReport {
  id: string;
  datasourceId: string;
  datasourceName: string;
  datasourceKind: 'postgres' | 'databricks';
  generatedAt: string;
  overallScore: number;
  maturity: ReadinessMaturity;
  dimensionScores: ReadinessDimensionScore[];
  findings: ReadinessFinding[];
  entityCount: number;
  sessionId?: string;
}

export interface ReadinessReportSummary {
  id: string;
  datasourceId: string;
  datasourceName: string;
  datasourceKind: 'postgres' | 'databricks';
  generatedAt: string;
  overallScore: number;
  maturity: ReadinessMaturity;
  entityCount: number;
  sessionId?: string;
}

/**
 * Payload of the `readiness-report` stream event (api.md 3.1): `{ report, panelItem }`.
 * `panelItem` is the session's panel item of kind `readiness`.
 */
export interface ReadinessReportEvent {
  report: ReadinessReport;
  panelItem: ReadinessPanelItem;
}

/** Scorecard order of the ten dimensions (data-readiness R25). */
export const READINESS_DIMENSION_ORDER: readonly ReadinessDimension[] = [
  'completeness',
  'validity',
  'consistency',
  'uniqueness',
  'integrity',
  'accessibility',
  'timeliness',
  'reasonability',
  'accuracy',
  'currency',
];

/** The two dimensions the engine never assesses (shown `Not assessed`). */
export const READINESS_UNASSESSED: readonly ReadinessDimension[] = [
  'accuracy',
  'currency',
];

/** Most severe first. */
export const READINESS_SEVERITY_RANK: Record<ReadinessSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** `completeness` -> `Completeness`. */
export function readinessLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The answer's reference to a report (data-model 3.4.1). */
export function readinessReportRef(report: ReadinessReport): ReadinessReportRef {
  return {
    reportId: report.id,
    datasourceName: report.datasourceName,
    overallScore: report.overallScore,
    maturity: report.maturity,
    generatedAt: report.generatedAt,
  };
}

/** A report's generation time, as the card and the scorecard show it. */
export function readinessTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** The panel item that shows a report (`readiness:<reportId>`). */
export function readinessPanelItemId(reportId: string): string {
  return `readiness:${reportId}`;
}

/** The panel item title for a report's datasource (data-model 3.4.4). */
export function readinessPanelTitle(datasourceName: string): string {
  return `Data readiness — ${datasourceName}`;
}
