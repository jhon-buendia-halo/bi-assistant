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
  /** A date column's first and last date, captured at save time (`YYYY-MM-DD`). */
  range?: { min: string; max: string };
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
  /**
   * The clamp on the call's row limit, when it is not the connectors'
   * default 500: the host's run of a dashboard's data query passes 5,000
   * (plan bi-dashboard 2.2).
   */
  maxRows?: number;
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
   * `options.signal`, the tool call's abort signal, ends the call at once.
   */
  pageQuery?(
    source: ExploredQuerySource,
    datasets: string[],
    request: PageRequest,
    options?: SqlCallOptions,
  ): Promise<PageResult & { datasourceId: string }>;
  /**
   * `result-explorer`'s reading of the user's words as a view of one of the
   * candidates (api.md 153, 155 use the same call). `options.abortSignal`,
   * the tool call's abort signal, cancels the model call.
   */
  interpretResult?(
    input: {
      text: string;
      candidates: ExplorerCandidate[];
      view: ResultView | null;
      pageCount: number | null;
    },
    options?: { abortSignal?: AbortSignal },
  ): Promise<ExplorerSpec>;
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
