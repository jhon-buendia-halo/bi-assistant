import type { DatasourceKind } from '../modules/datasources/entities/datasource.entity';
import type {
  ColumnKind,
  PageRequest,
  PageResult,
  ResultView,
} from '../modules/datasources/connectors/paged-sql.types';
import type {
  ExplorerCandidate,
  ExplorerSpec,
} from './agents/result-explorer.prompts';

// The query facts' side channel (plan m1-25 1.25.1): the data tools write
// `QueryFacts` beside their result under this requestContext key.
export {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  type QueryFactsMap,
} from '../modules/sessions/query-evidence/query-facts';

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
  /** Mirrors `DatasetSchemaNote` (datasets.repository.ts), BA-318. */
  schemas?: {
    key: string;
    layer?: 'landing' | 'normalized' | 'consumption';
    description?: string;
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
   * Rows the statement produced before the row limit. The tool takes it off
   * the result before the model sees it (passed as `QueryFacts` instead).
   */
  totalRows?: number;
  /**
   * Guidance for the agent (repair happened, zero rows came back, or the row
   * limit was reached).
   */
  note?: string;
}

/**
 * How a data tool stops its statement (agents.md 3.3, 3.4): the turn's stop,
 * as the tool call's `abortSignal`. Mirrors `RunSqlOptions` (datasources R38).
 */
export interface SqlCallOptions {
  signal?: AbortSignal;
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

/** The query `explore_result` pages (agents.md 3.15): its SQL, columns and kinds. */
export interface ExploredQuerySource {
  sql: string;
  /** The datasource it ran on, when known; else the session's only one. */
  datasourceId?: string;
  columns: string[];
  kinds: Record<string, ColumnKind>;
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
  /** `options.signal` is the tool call's abort signal (the turn's stop). */
  sampleRows(
    datasourceId: string,
    entity: string,
    limit: number,
    options?: SqlCallOptions,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  /**
   * Runs the statement and repairs it on execution errors — `datasets` names
   * the datasets whose schema the fixer may draw on. `options.signal`, the
   * tool call's abort signal, cancels the statement and the repair.
   */
  runReadOnlySql(
    datasourceId: string,
    sql: string,
    limit: number,
    datasets: string[],
    options?: SqlCallOptions,
  ): Promise<SqlRunResult>;
  /**
   * One page of an earlier query's full result (`explore_result`, agents.md
   * 3.15) through the query inspector's own page path (api.md 152, 154):
   * the same checks and caps. Throws the message the model should see.
   */
  pageQuery?(
    source: ExploredQuerySource,
    datasets: string[],
    request: PageRequest,
  ): Promise<PageResult & { datasourceId: string }>;
  /**
   * `result-explorer`'s reading of the user's words as a view of one of the
   * candidates (api.md 153, 155 use the same call).
   */
  interpretResult?(input: {
    text: string;
    candidates: ExplorerCandidate[];
    view: ResultView | null;
    pageCount: number | null;
  }): Promise<ExplorerSpec>;
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
