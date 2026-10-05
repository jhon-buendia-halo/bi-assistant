import type { DatasourceKind } from '../modules/datasources/entities/datasource.entity';

// DI bridge for Mastra tools, same pattern as model-resolver: tools are
// constructed at module load with no Nest DI, so SessionsService installs the
// real implementations at boot.

import type { EngineOptions } from '../modules/engine/engine-options';
import type { TokenUsage } from '../modules/agents/eval-telemetry';

/** Mirrors `ColumnProfile` in the datasets repository — see there. */
export interface ColumnProfile {
  sampledRows: number;
  nullRate: number;
  distinctCount: number;
  constant: boolean;
  min?: string;
  max?: string;
  topValues?: { value: string; count: number }[];
  magnitude?: 'cents-like' | 'fraction' | 'count' | 'large-integer';
  profiledAt: string;
}

/** Column snapshot as stored on a dataset (mirrors `DatasetEntitySnapshot`). */
export interface DatasetColumnSnapshot {
  name: string;
  type: string;
  nullable: boolean;
  /** Real values observed at save time — schema linking / value matching. */
  sampleValues?: string[];
  description?: string;
  /** Join target for a key column — see DatasetColumnSnapshot in the repository. */
  references?: {
    entity: string;
    column: string;
    source: 'declared' | 'inferred';
    cardinality?: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'unknown';
  };
  profile?: ColumnProfile;
}

export interface DatasetSnapshot {
  name: string;
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
  /** Mirrors `DatasetDoc.description`. */
  description?: string;
  tables: string[];
  entities?: {
    key: string;
    columns: DatasetColumnSnapshot[];
  }[];
}

/** A SQL run, plus what the repair loop had to do to make it succeed. */
export interface SqlRunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Present when the original statement failed and was auto-corrected. */
  correctedSql?: string;
  /** The run filled its row limit — the result set is probably incomplete. */
  truncated?: boolean;
  /**
   * Guidance for the agent (repair happened, zero rows came back, or the row
   * limit was reached).
   */
  note?: string;
  /** Every auto-repair made on the way to this result (mirrors `SqlRepairRecord`). */
  repairs?: SqlRunRepair[];
  /** Static precheck findings on the statement (lever `sqlPrecheck`; never blocks). */
  precheck?: string[];
  /**
   * Descriptive-error hints (lever `descriptiveErrors`) — closest names,
   * types, known values. On a failed statement they are part of the thrown
   * message instead; here they annotate a result that came back empty.
   */
  hints?: string[];
}

/**
 * Mirrors `SqlRepairRecord` (modules/sessions/turn-result.ts) without
 * importing it, like the other mirrors in this file.
 */
export interface SqlRunRepair {
  original: string;
  repaired: string;
  error: string;
  kind: 'identifier' | 'syntax' | 'semantic' | 'unknown';
  warning?: string;
  /**
   * What the `sql-fixer` call behind this repair cost, when the provider
   * reported it. Travels with the record so the turn can bill it as its
   * `fixer` side pass — the bridge itself never sees which turn called it.
   */
  usage?: TokenUsage;
}

/** What `knowledgeFor` returns: the curated semantics that match a lookup. */
export interface KnowledgeLookupResult {
  snippets: {
    kind: string;
    title: string;
    body: string;
    entities?: string[];
    column?: string;
  }[];
  metrics: {
    name: string;
    label?: string;
    entity: string;
    expression: string;
    description?: string;
  }[];
}

export interface VisualToolResult {
  visualId: string;
  version: number;
  title: string;
  description: string;
}

/**
 * Mirrors `ToolDataRecord` (backend/src/modules/sessions/entities) without
 * importing it — same pattern as `DatasetSnapshot`/`SqlRunResult`: this file
 * has no Nest DI and must stay decoupled from feature-module types.
 */
export interface DatasetToolTurnRecord {
  tool: string;
  input?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  rationale?: string;
}

export interface DatasetToolServices {
  /**
   * Create a visual for an answer in the session (latest answer if omitted).
   * `turnRecords`, when present, are the SQL/rows the current chat turn has
   * captured so far — appended to the visual's data alongside the source
   * answer's own records.
   */
  createVisual(
    sessionId: string,
    sourceMessageAt: string | undefined,
    instruction: string | undefined,
    turnRecords?: DatasetToolTurnRecord[],
  ): Promise<VisualToolResult>;
  /**
   * Produce a new version of an existing visual from a tailoring request.
   * `turnRecords` are merged onto the visual's stored data the same way as
   * `createVisual`.
   */
  updateVisual(
    sessionId: string,
    visualId: string,
    instruction: string,
    turnRecords?: DatasetToolTurnRecord[],
  ): Promise<VisualToolResult>;
  getDatasets(names: string[]): Promise<DatasetSnapshot[]>;
  sampleRows(
    datasourceId: string,
    entity: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  /**
   * Runs the statement and repairs it on execution errors — `datasets` names
   * the datasets whose schema the fixer may draw on. `options.engine` is the
   * turn's resolved levers (fixer on/off, intent guard, precheck, errors).
   */
  runReadOnlySql(
    datasourceId: string,
    sql: string,
    limit: number,
    datasets: string[],
    options?: { engine?: EngineOptions },
  ): Promise<SqlRunResult>;
  /**
   * `lookup_values`: stored values of `entity.column` resembling `phrase`,
   * most frequent first. Optional until SessionsService installs it; the tool
   * falls back to the column profile's top values.
   */
  lookupValues?(
    datasourceId: string,
    entity: string,
    column: string,
    phrase: string,
    limit: number,
  ): Promise<{ value: string; count?: number }[]>;
  /** `lookup_knowledge` and inline knowledge: curated snippets and metrics matching the query. */
  knowledgeFor?(
    datasets: string[],
    query: { entity?: string; column?: string; phrase?: string },
  ): Promise<KnowledgeLookupResult>;
  /** Knowledge `default_filter` predicates in scope, for the precheck and guards. */
  defaultFilters?(
    datasets: string[],
  ): Promise<{ entity: string; predicate: string; title: string }[]>;
}

let services: DatasetToolServices | null = null;

export function setDatasetToolServices(impl: DatasetToolServices): void {
  services = impl;
}

export function getDatasetToolServices(): DatasetToolServices {
  if (!services) {
    throw new Error('Dataset tool services not installed yet');
  }
  return services;
}
