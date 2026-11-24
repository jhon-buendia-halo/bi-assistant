/**
 * The query inspector's facts about one data-gathering tool call of an answer
 * (roadmap 1.25, docs/plans/m1-25-query-inspector.md section 2.1).
 *
 * They live beside `ChatMessage.data`, never on `ToolDataRecord`: whole
 * records are fed to models (tool-only synthesis, the visual designer, the
 * eval harness), so a new field there would change those agents' input.
 * No framework imports: Jest and the pure modules share this file.
 */
import type { ResultView } from '../../datasources/connectors/paged-sql.types';

/** How much of the data a query's result stands for. */
export type QueryCoverage = 'whole-table' | 'top-n' | 'sample' | 'partial';

/**
 * What the tool knew when it ran. Passed beside the tool result through the
 * request context; it never reaches the model.
 */
export interface QueryFacts {
  datasourceId?: string;
  /** Rows the statement produced before the tool's row cap. */
  totalRows?: number;
  /** The tool's cap for this call: `run_readonly_sql` limit ?? 100, `sample_rows` limit ?? 10. */
  rowLimit?: number;
  /** `explore_result` only: the view its page was read with (roadmap 1.28.7). */
  view?: ResultView;
}

export interface QueryTableSize {
  /** Fully-qualified `catalog.schema.table`. */
  entity: string;
  /** Null when the table could not be counted. */
  rows: number | null;
  error?: string;
}

export type QueryStepVerb =
  | 'start'
  | 'keep'
  | 'add'
  | 'combine'
  | 'group'
  | 'count'
  | 'compute'
  | 'sort'
  | 'show';

export interface QueryStep {
  verb: QueryStepVerb;
  /** Business words after the verb label. */
  text: string;
  /** Entity shown in monospace (start, add, combine). */
  table?: string;
  /** Plural noun for the rows after this step ("products"); "rows" when absent. */
  unit?: string;
  /** Show step only: the LIMIT or row cap in plain words. */
  note?: string;
  /** From the explainer: a statement counting the rows after this step. Never on show. */
  countSql?: string;
  /** start = the table's size, show = rows produced (both from code); others only once verified. */
  rows?: number;
  /**
   * From the explainer: a statement returning the rows after this step (the
   * intermediate result), run on demand for its preview. Never on show:
   * the show step's rows are the query's own.
   */
  previewSql?: string;
  /** The first rows after this step, once asked for (api.md 161, 162). */
  preview?: StepPreview;
}

/** The rows a step leaves, as its preview shows them (ui.md 4.4b). */
export interface StepPreview {
  columns: string[];
  /** At most `STEP_PREVIEW_ROWS`. */
  rows: Record<string, unknown>[];
  /** More rows than these came back. */
  more: boolean;
  /** The rows the statement produced before the cap, when the datasource says. */
  total?: number;
  at: string;
  /**
   * Against the step's counted rows, when they are known: `differs` means
   * the statement may not be the step's. Absent when nothing could be checked.
   */
  check?: 'matches' | 'differs';
}

export interface QueryExplanation {
  /** Start first, show last (show is always added by code). */
  steps: QueryStep[];
  /** The model's reply was not usable: the steps were built by code only. */
  fallback?: true;
  at: string;
  stageCounts?: {
    status: 'verified' | 'unverified';
    at: string;
    reason?: string;
  };
}

export interface QueryEvidence {
  /** Index into `ChatMessage.data`; also the `:index` of the endpoints. */
  index: number;
  /** Absent on a failed record. */
  coverage?: QueryCoverage;
  /** The statement's own top-level LIMIT / FETCH FIRST n. */
  outerLimit?: number;
  datasourceId?: string;
  /** Filled later, from the run's datasets. */
  datasourceKind?: string;
  totalRows?: number;
  rowLimit?: number;
  /** Filled later: the size of each table the query reads. */
  tables?: QueryTableSize[];
  /** Filled later, when the inspector first opens the query. */
  explanation?: QueryExplanation;
  /**
   * Set on an `explore_result` record only: the view (filters, sort, page)
   * its rows were read with; the inspector opens the query on it (roadmap
   * 1.28.7, agent-answers R83, R84). Never on the record, which models read.
   */
  view?: ResultView;
}
