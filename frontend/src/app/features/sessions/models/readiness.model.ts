// Mirror of backend/src/modules/data-readiness/engine/types.ts (BA-251).
// Keep the two in step; the backend file is the source of truth.

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
 * Payload of the `readiness-report` stream event (api.md): `{ report, panelItem }`.
 * `panelItem` is the session's PanelItem of kind `readiness` (unit 11 types it).
 */
export interface ReadinessReportEvent {
  report: ReadinessReport;
  panelItem: unknown;
}
