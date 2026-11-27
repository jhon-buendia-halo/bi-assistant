// Data Readiness Assessor contracts (Dana, `data-readiness-assessor`).
// Shared by the engine (modules/readiness-assessor), the agent's tool
// (mastra/tools/readiness.tools.ts) and the specs. No framework import.
// Rubric: specs/capabilities/data-readiness/spec.md (v1.0).

/** The rubric version every assessment records (guardrail 7.3). */
export const READINESS_RUBRIC_VERSION = '1.0';

/** Rubric 3.5: what the data is for. Decides the weights and whether D6 applies. */
export type ReadinessUseType = 'analytics' | 'dashboard' | 'ml' | 'rag-agent';

/** Scoping: the risk level, which decides the rigour (sample size, escalation). */
export type ReadinessRisk = 'low' | 'medium' | 'high';

/** Rubric 3.1. D6 applies only to `ml` and `rag-agent`. */
export type ReadinessDimension = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';

/** Rubric 3.4: the blocking gates. */
export type ReadinessGate = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';

/** Rubric 3.2. `'N/E'`: not evaluated, never averaged as 0 or 4. */
export type ReadinessLevel = 0 | 1 | 2 | 3 | 4 | 'N/E';

export type GateStatus = 'pass' | 'fail' | 'not-evaluated';

/** Rubric 3.6. Decided by the gates and the minimums, never by the average. */
export type ReadinessVerdict = 'ready' | 'ready-with-conditions' | 'not-ready';

export type FindingSeverity = 'blocking' | 'high' | 'medium' | 'low';

/** A field the use case cannot do without (scoping card). */
export interface CriticalField {
  /** The entity key as the dataset names it (`schema.table`). */
  entity: string;
  column: string;
  /** Indispensable: its quality at level <= 1 fails G5. */
  indispensable: boolean;
  /** Tolerated share of null or empty values, 0..1 (default 0.05). */
  maxNullRate?: number;
}

/**
 * The scoping card (skill `readiness-scoping`), built by Dana with the
 * requester and passed to `assess_readiness`. Everything not stated is an
 * assumption she writes down in `assumptions`.
 */
export interface ReadinessScope {
  /** What the data will be used for, in the requester's words. */
  useCase: string;
  useType: ReadinessUseType;
  risk: ReadinessRisk;
  consumer?: string;
  decision?: string;
  /** Critical entities (`schema.table`); empty means every entity of the datasets. */
  entities: string[];
  criticalFields: CriticalField[];
  /** The grain's key per entity, for the duplicates check; else the declared key. */
  grainKeys?: { entity: string; columns: string[] }[];
  /** Maximum tolerated age of the newest row, in hours; absent: G6 not evaluated. */
  requiredFreshnessHours?: number;
  /** Tolerated share of duplicate grain keys, 0..1 (default 0.02). */
  maxDuplicateRate?: number;
  /** Whether the use case needs personal data at all. */
  personalDataNeeded: boolean;
  /** The documented legal basis or purpose for personal data, when the requester gave one. */
  legalBasis?: string;
  /** The owner of each dataset, when the requester named one (the app keeps no owner metadata). */
  owners?: { dataset: string; owner: string }[];
  /** Every assumption made instead of asking. */
  assumptions: string[];
}

/**
 * One piece of evidence (`EV-001`…). Every level and gate cites at least one;
 * without evidence there is no level (`N/E`). Results are aggregates only:
 * never an individual personal value (guardrail 7.1).
 */
export interface ReadinessEvidence {
  id: string;
  dimension: ReadinessDimension | 'gate';
  /** What was measured, in business words. */
  description: string;
  /** `sql`: an aggregate query; `sample`: computed in code over sampled rows; `metadata`: the dataset's saved schema. */
  source: 'sql' | 'sample' | 'metadata';
  /** The statement that ran, for `sql` (shown in the query inspector). */
  sql?: string;
  datasourceId?: string;
  entity?: string;
  /** How much of the data it covers. */
  coverage: 'whole-table' | 'sample' | 'metadata';
  sampleSize?: number;
  /** The aggregate result, e.g. `{ null_rate: 0.3, rows: 1200 }`. */
  result: Record<string, number | string | boolean | null>;
}

export interface ReadinessFinding {
  /** `F-001`… */
  id: string;
  dimension: ReadinessDimension;
  gate?: ReadinessGate;
  severity: FindingSeverity;
  entity?: string;
  column?: string;
  /** The measured value with its unit, e.g. `30% null`. */
  measured: string;
  /** The use case's threshold, e.g. `<= 5% null`. */
  threshold?: string;
  description: string;
  evidenceIds: string[];
}

export interface GateResult {
  gate: ReadinessGate;
  status: GateStatus;
  reason: string;
  evidenceIds: string[];
}

export interface DimensionResult {
  dimension: ReadinessDimension;
  applicable: boolean;
  level: ReadinessLevel;
  /** The rubric 3.5 weight for the use type, 0..1; null when not applicable. */
  weight: number | null;
  /** Why this level, citing the rubric 3.3 criterion it meets. */
  reason: string;
  evidenceIds: string[];
}

/** Compared with the previous assessment of the same use case and datasets. */
export interface ReadinessBaselineDelta {
  previousId: string;
  previousAt: string;
  previousRubricVersion: string;
  previousVerdict: ReadinessVerdict;
  dimensions: {
    dimension: ReadinessDimension;
    from: ReadinessLevel;
    to: ReadinessLevel;
  }[];
  gates: { gate: ReadinessGate; from: GateStatus; to: GateStatus }[];
}

/** One assessment, stored as the baseline of the next (collection `readiness_assessments`). */
export interface ReadinessAssessment {
  id: string;
  createdAt: string;
  rubricVersion: string;
  /** Same use case and datasets → same key (normalised use case + sorted dataset names). */
  useCaseKey: string;
  sessionId?: string;
  datasets: string[];
  scope: ReadinessScope;
  verdict: ReadinessVerdict;
  /** Rubric 3.5 weighted score 0..4; null when a dimension weighing >= 20% is N/E. */
  weightedScore: number | null;
  /** How N/E weights were redistributed, or why there is no score. */
  weightedScoreNote?: string;
  /** Verifiable conditions for `ready-with-conditions` (one per level-2 dimension at least). */
  conditions: string[];
  gates: GateResult[];
  dimensions: DimensionResult[];
  findings: ReadinessFinding[];
  evidence: ReadinessEvidence[];
  /** What was not evaluated and why (always declared). */
  notEvaluated: { item: string; reason: string }[];
  /** Why a human must look at it (rubric: "escala a un humano cuando"). */
  escalations: string[];
  previous?: ReadinessBaselineDelta;
}

/** What the engine needs from the host; the tool builds it from the dataset tool services. */
export interface ReadinessPort {
  datasets(
    names: string[],
  ): Promise<import('../../mastra/tool-services').DatasetSnapshot[]>;
  runSql(
    datasourceId: string,
    sql: string,
    signal?: AbortSignal,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  sampleRows(
    datasourceId: string,
    entity: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  previous(useCaseKey: string): Promise<ReadinessAssessment | null>;
  save(assessment: ReadinessAssessment): Promise<void>;
}

export interface AssessReadinessOptions {
  /** The session's dataset names the assessment covers. */
  datasets: string[];
  sessionId?: string;
  signal?: AbortSignal;
  /** Injected clock for tests. */
  now?: Date;
}
