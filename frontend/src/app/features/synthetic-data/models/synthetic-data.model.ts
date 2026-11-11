/**
 * Frontend mirror of backend/src/modules/synthetic-data/types.ts and limits.ts.
 * Keep the two in step.
 */

/** Mirrors backend data-readiness/engine/types.ts. */
export type SemanticType =
  'numeric' | 'temporal' | 'text' | 'boolean' | 'uuid' | 'json' | 'other';
export type FormatRule = 'email' | 'phone' | 'url' | 'uuid' | 'date-string';

export type SyntheticDialect = 'postgres' | 'databricks';
export type SampleMethod = 'full' | 'tablesample' | 'limit';
export type ColumnKind =
  | 'identifier' | 'categorical' | 'numeric' | 'temporal'
  | 'boolean' | 'formatted' | 'text' | 'unsupported';
export type SynthesisStrategy =
  | 'sequence' | 'uuid' | 'unique-pattern' | 'foreign-key'
  | 'categorical' | 'numeric-range' | 'temporal-range' | 'boolean-rate'
  | 'format-template' | 'pattern' | 'words' | 'null-only' | 'constant';

/** Statistics over the sampled rows. Every number is approximate. */
export interface SampledColumn {
  name: string;
  /** Declared type, exactly as the platform reports it. */
  type: string;
  semanticType: SemanticType;
  nullable: boolean;
  kind: ColumnKind;
  strategy: SynthesisStrategy;
  /** NULLs / sampled rows, 0..1, 4 decimals. 0 when nothing was sampled. */
  nullFraction: number;
  /** Distinct non-null values in the sample. */
  distinctCount: number;
  /** distinctCount / non-null sampled values, 0..1, 4 decimals. */
  distinctRatio: number;
  numeric?: { min: number; max: number; mean: number; quantiles: number[] /* 11: p0, p10 … p100 */; integer: boolean; scale: number /* max decimals seen, ≤ 10 */ };
  temporal?: { min: string; max: string /* ISO, UTC */; quantiles: string[] /* 11 */; granularity: 'date' | 'second' | 'fraction' };
  boolean?: { trueFraction: number };
  /** Text length (characters) of non-null values; text, formatted, identifier text and categorical columns. */
  length?: { min: number; max: number; mean: number; quantiles: number[] /* 11 */ };
  /** Categorical columns only: values seen ≥ 3 times, at most 20, most frequent first (ties by value). */
  topValues?: { value: string; fraction: number }[];
  /** Categorical only: the share of non-null values not in topValues. */
  otherFraction?: number;
  /** Character-class shapes (no data characters), at most 5, most frequent first. */
  patterns?: { shape: string; fraction: number }[];
  formatRule?: FormatRule;
  /** Why the column is generated as it is, when that is not obvious (e.g. "Type not synthesized: generated as NULL"). */
  note?: string;
}

export interface SampledTable {
  /** Entity key as stored in the dataset (`catalog.schema.table`; PostgreSQL `database.schema.table`). */
  key: string;
  /** PostgreSQL schema; Databricks `catalog.schema` (as the profilers flatten). */
  namespace: string;
  name: string;
  /** reltuples (PostgreSQL) or Delta row count (Databricks); null when unknown. */
  rowCountEstimate: number | null;
  sampledRows: number;
  method: SampleMethod;
  durationMs: number;
  /** Set when sampling failed; columns then come from the catalog only. Connector text, never row data. */
  error?: string;
  primaryKey: string[];          // [] when none declared
  uniqueKeys: string[][];
  columns: SampledColumn[];      // catalog order
}

export interface SampledRelationship {
  fromTable: string; fromColumns: string[];  // table = SampledTable.key
  toTable: string;   toColumns: string[];
  origin: 'declared' | 'inferred';
}

export interface SampledProfile {
  profileId: string;            // uuid; key in the in-memory cache
  version: 1;
  datasetName: string;
  datasourceId: string;
  datasourceName: string;
  dialect: SyntheticDialect;
  generatedAt: string;          // ISO
  expiresAt: string;            // ISO, generatedAt + 60 min
  sampleSize: number;           // rows requested per table (≤ 1000)
  tables: SampledTable[];       // in the order requested
  relationships: SampledRelationship[];  // both ends among `tables`
}

export interface ScriptRequest {
  profileId: string;
  /** Per table key; tables left out use defaultRowCount. */
  rowCounts?: Record<string, number>;
  defaultRowCount?: number;     // default 100
  seed?: number;                // default 1
  targetSchema?: string;        // default "synthetic"
  includeConstraints?: boolean; // default true
}

/** What the script header and the agent tool report. */
export interface ScriptSummary {
  fileName: string;
  dialect: SyntheticDialect;
  seed: number;
  targetSchema: string;
  bytes: number;
  tables: { key: string; targetName: string; rows: number; clampedFrom?: number }[];
  droppedRelationships: SampledRelationship[];   // parent outside the profile
  notSynthesized: { table: string; column: string; reason: string }[];
  sha256: string;               // of the script bytes
}

/** Request body of POST /synthetic-data/profiles (api.md 111). */
export interface ProfileRequest {
  datasetName: string;
  tables?: string[];
  sampleSize?: number;
}

// Limits, mirroring backend synthetic-data/limits.ts.
export const SAMPLE_SIZE_MAX = 1000;
/** Chat (agent) limit: 20. */
export const PROFILE_TABLES_MAX = 50;
export const ROWS_PER_TABLE_DEFAULT = 100;
/** Chat (agent) limit: 1000. */
export const ROWS_PER_TABLE_MAX = 10000;
export const SCRIPT_ROWS_MAX = 200000;
export const DEFAULT_SEED = 1;
export const DEFAULT_TARGET_SCHEMA = 'synthetic';
/** Databricks also accepts `catalog.schema`, where both parts match. */
export const TARGET_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
