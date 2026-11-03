// Data readiness contracts (BA-251). Ported from data-readiness-agent's
// deterministic engine (src/assessment/). FINAL types shared by every unit:
// change them only through the coordinator.

export type Dimension =
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

export type Severity = 'info' | 'low' | 'medium' | 'high';

export type Maturity =
  'Initial' | 'Repeatable' | 'Defined' | 'Managed' | 'Optimised';

export type SemanticType =
  'numeric' | 'temporal' | 'text' | 'boolean' | 'uuid' | 'json' | 'other';

export type FormatRule = 'email' | 'phone' | 'url' | 'uuid' | 'date-string';

export interface FieldProfile {
  name: string;
  type: string;
  semanticType: SemanticType;
  nullable: boolean;
  nullCount?: number;
  distinctCount?: number;
  min?: string;
  max?: string;
  formatRule?: FormatRule;
  invalidFormatCount?: number;
  normalizedDistinctCount?: number;
}

export interface KeyProfile {
  kind: 'primary' | 'unique' | 'natural';
  fields: string[];
  duplicateCount?: number;
}

export interface EntityProfile {
  namespace: string;
  name: string;
  rowCount: number;
  fields: FieldProfile[];
  keys: KeyProfile[];
  readable?: boolean;
  lastModifiedAt?: string;
}

export interface RelationshipProfile {
  fromNamespace: string;
  fromEntity: string;
  fromField: string;
  toNamespace: string;
  toEntity: string;
  toField: string;
  orphanCount?: number;
  origin?: 'declared' | 'inferred';
}

export interface SourceProfile {
  sourceId: string;
  sourceType: string;
  entities: EntityProfile[];
  relationships: RelationshipProfile[];
}

export interface Finding {
  dimension: Dimension;
  level: 'entity' | 'source';
  namespace?: string;
  entity?: string;
  field?: string;
  severity: Severity;
  /** The measured value behind the finding, e.g. a null fraction. */
  measured?: number | string;
  description: string;
  recommendation: string;
}

export interface DimensionScore {
  dimension: Dimension;
  score: number;
  findingCount: number;
  maxSeverity: Severity | null;
  assessed: boolean;
  totalChecks: number;
}

/** The pure engine output (no persistence fields). */
export interface EngineResult {
  findings: Finding[];
  dimensionScores: DimensionScore[];
  overallScore: number;
  maturity: Maturity;
  entityCount: number;
}

/** A stored assessment (collection `readiness_reports`). */
export interface ReadinessReport extends EngineResult {
  id: string;
  datasourceId: string;
  datasourceName: string;
  datasourceKind: 'postgres' | 'databricks';
  /** ISO time the assessment ran (the engine's `now`). */
  generatedAt: string;
  sessionId?: string;
}

/** Compact list row for `GET /data-readiness/assessments`. */
export type ReadinessReportSummary = Pick<
  ReadinessReport,
  | 'id'
  | 'datasourceId'
  | 'datasourceName'
  | 'datasourceKind'
  | 'generatedAt'
  | 'overallScore'
  | 'maturity'
  | 'entityCount'
  | 'sessionId'
>;

/** What the readiness tools return to the model (agents.md 3.13). */
export interface ReadinessSummary {
  reportId: string;
  datasourceName: string;
  generatedAt: string;
  entityCount: number;
  overallScore: number;
  maturity: Maturity;
  dimensionScores: DimensionScore[];
  findingCount: number;
  /** At most 20, most severe first, then in report order. */
  topFindings: Pick<
    Finding,
    | 'severity'
    | 'dimension'
    | 'entity'
    | 'field'
    | 'measured'
    | 'description'
    | 'recommendation'
  >[];
}

export interface Thresholds {
  completeness: { medium: number; high: number };
  reasonability: { ancientYear: number };
  timeliness: { staleDays: number };
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  completeness: { medium: 0.1, high: 0.5 },
  reasonability: { ancientYear: 1900 },
  timeliness: { staleDays: 365 },
};

/** Everything a check may read besides the profile. `now` replaces Date.now(). */
export interface CheckContext {
  thresholds: Thresholds;
  now: Date;
}

export interface CheckResult {
  dimension: Dimension;
  /** Units evaluated: the proportional-score denominator. */
  checksRun: number;
  findings: Finding[];
}

export type EntityCheck = (
  entity: EntityProfile,
  ctx: CheckContext,
) => CheckResult;

export type SourceCheck = (
  profile: SourceProfile,
  ctx: CheckContext,
) => CheckResult;

/** Optional narrowing of an assessment to one schema or one table. */
export interface AssessScope {
  namespace?: string;
  entity?: string;
}
