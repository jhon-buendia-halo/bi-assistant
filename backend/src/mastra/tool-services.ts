import type { DatasourceKind } from '../modules/datasources/entities/datasource.entity';

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

/** Where the RFP tools send their requests (agents.md 3.10). */
export interface RestTarget {
  /** The REST datasource's base URL. */
  baseUrl: string;
  /** Headers built as the REST connector builds them (the key in `X-API-Key`). */
  headers: Record<string, string>;
}

/** What `export_rfp_package` returns (agents.md 3.10; data-model 3.4.1). */
export interface RfpPackageResult {
  rfpId: string;
  title: string;
  files: { name: string; bytes: number }[];
  exportedAt: string;
  /** Set by `export_rfp_draft`: the package is marked DRAFT. */
  draft?: true;
}

/**
 * The input of `show_in_panel` (agents.md 3.11): a flat object, validated per
 * kind by the bridge.
 */
export interface PanelToolInput {
  kind: 'file' | 'document' | 'table' | 'visual';
  title?: string;
  path?: string;
  markdown?: string;
  record?: number;
  visualId?: string;
}

/** What `show_in_panel` tells the model: the item is stored, not echoed. */
export interface PanelToolResult {
  shown: true;
  id: string;
  kind: PanelToolInput['kind'];
  title: string;
  /** `file` only. */
  bytes?: number;
  /** `table` only. */
  rowCount?: number;
}

/** The input of `update_workflow` (agents.md 3.11): flat, validated by the bridge. */
export interface WorkflowToolInput {
  steps?: string;
  current?: number;
  done?: string;
  skipped?: string;
  waiting?: boolean;
  note?: string;
  todo?: string;
}

/** What `update_workflow` tells the model. */
export interface WorkflowToolResult {
  updated: true;
  steps: number;
  current: number;
  done: number[];
  skipped: number[];
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
  /**
   * Show something in the session's right panel: validate it, store it as a
   * panel item and return the summary. Throws the error message the model
   * should see. `turnRecords` are the current turn's captured query results
   * (the only source of `table` items).
   */
  showPanelItem(
    sessionId: string,
    input: PanelToolInput,
    turnRecords?: DatasetToolTurnRecord[],
  ): Promise<PanelToolResult>;
  /**
   * Create or update the session's workflow status bar. Throws the error
   * message the model should see.
   */
  updateWorkflow(
    sessionId: string,
    input: WorkflowToolInput,
  ): Promise<WorkflowToolResult>;
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
   * The base URL and headers of a REST datasource, secrets resolved on the
   * server: the target of the RFP tools (agents.md 3.10).
   */
  restTarget(datasourceId: string): Promise<RestTarget>;
  /**
   * Download the RFP package (`GET /v1/rfps/{id}/package.zip`) from the
   * datasource's API and unzip it into the session workspace `rfp/<rfpId>/`,
   * overwriting an earlier export. With `draft`, `?draft=true` into
   * `rfp/<rfpId>/draft/` instead (never touching the final package).
   */
  exportRfpPackage(
    sessionId: string,
    datasourceId: string,
    rfpId: string,
    options?: { draft?: boolean },
  ): Promise<RfpPackageResult>;
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
