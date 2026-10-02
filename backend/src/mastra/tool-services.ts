import type { DatasourceKind } from '../modules/datasources/entities/datasource.entity';
// `session-model.ts`/`logical-query.ts` are pure, DI-free DSL types (same
// philosophy as this file) — importing them here is not a feature-module
// coupling the way importing a NestJS service/entity would be.
import type { SessionModel } from '../modules/data-models/session-model';
import type { LogicalQuery } from '../modules/data-models/query/logical-query';

// DI bridge for Mastra tools, same pattern as model-resolver: tools are
// constructed at module load with no Nest DI, so SessionsService installs the
// real implementations at boot.

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
  };
}

export interface DatasetSnapshot {
  name: string;
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
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
}

/** A `query_entities` run: the executed SQL's result, plus what the compiler
 * resolved it against — provenance the turn record and a visual's data
 * provenance both need (ADR-0007). */
export interface LogicalQueryRunResult extends SqlRunResult {
  /** Logical entity names the compiled query touched (root + joins). */
  entities: string[];
  /** The compiled SQL actually executed — same field a visual/provenance
   * block already expects from a SQL-running tool. Present here (the
   * `DatasetToolServices` return value) for the turn record/visual
   * provenance to use — `mastra/tools/model.tools.ts`'s `queryEntitiesTool`
   * strips it (and `correctedSql`) before handing the result back to the
   * model (ADR-0007 §4: no physical SQL text re-enters the model's own
   * context/memory). */
  sql: string;
}

/**
 * `queryEntitiesTool`'s full result (sql/correctedSql included), keyed by
 * the model-visible (sql-stripped) object the tool actually returns —
 * recovered by `toolDataRecord` (`modules/sessions/turn-data.ts`) from the
 * SAME in-process result a moment later, for the turn record/visual
 * provenance `sql` is still needed for. Lives in this DI-free, Mastra/Nest
 * -agnostic file (not in either call site) specifically so neither
 * `model.tools.ts` (pulls in `@mastra/core/tools`, unsafe to import from a
 * Jest-tested NestJS file — see `sessions.service.spec.ts`'s mocking
 * comments) nor `turn-data.ts` has to import the other. */
export const queryEntitiesProvenance = new WeakMap<
  object,
  LogicalQueryRunResult
>();

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
   * the datasets whose schema the fixer may draw on.
   */
  runReadOnlySql(
    datasourceId: string,
    sql: string,
    limit: number,
    datasets: string[],
  ): Promise<SqlRunResult>;
  /**
   * The composed `SessionModel` (ADR-0007) for this session's datasets —
   * what `model.tools.ts`'s `list_entities`/`describe_entity`/`sample_records`
   * read from and what `query_entities` compiles against.
   */
  getSessionModel(datasetNames: string[]): Promise<SessionModel>;
  /**
   * Compiles `query` for the right dialect from the entity it touches and
   * runs it through the same execution-guided repair path as raw SQL
   * (`runReadOnlySql`'s implementation) — a runtime error on the *compiled*
   * SQL is still a job for `sql-fixer`, compile/semantic errors never reach
   * this far (`query_entities` catches `LogicalQueryError` first).
   */
  runLogicalQuery(
    sessionModel: SessionModel,
    query: LogicalQuery,
  ): Promise<LogicalQueryRunResult>;
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
