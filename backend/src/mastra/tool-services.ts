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
  datasourceKind?: 'databricks' | 'postgres';
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
