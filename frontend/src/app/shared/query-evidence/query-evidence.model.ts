import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * The query inspector's facts about one data-gathering tool call of an answer
 * (roadmap 1.25, docs/plans/m1-25-query-inspector.md section 2.1). The copy of
 * `backend/src/modules/sessions/query-evidence/query-evidence.types.ts`.
 */

/** How much of the data a query's result stands for. */
export type QueryCoverage = 'whole-table' | 'top-n' | 'sample' | 'partial';

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
  countSql?: string;
  /** start = the table's size, show = rows produced; others only once verified. */
  rows?: number;
}

export interface QueryExplanation {
  /** Start first, show last. */
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
  /** Index into the message's `data`; also the `:index` of the endpoints. */
  index: number;
  /** Absent on a failed record. */
  coverage?: QueryCoverage;
  /** The statement's own top-level LIMIT / FETCH FIRST n. */
  outerLimit?: number;
  datasourceId?: string;
  datasourceKind?: string;
  totalRows?: number;
  rowLimit?: number;
  tables?: QueryTableSize[];
  explanation?: QueryExplanation;
}

/** What a re-run returned. It is shown, never stored. */
export interface QueryRerunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalRows?: number;
  coverage: QueryCoverage;
  ranAt: string;
}

// Paging, filtering and sorting a stored query's full result (roadmap 1.27,
// ADR-0049). A copy of the wire types of the backend's
// `datasources/connectors/paged-sql.types.ts`: change both together.

export const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'starts_with',
  'is_null',
  'not_null',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** The inspector's label of each operator (plan 1.27, 0.5). */
export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  between: 'between',
  in: 'is one of',
  not_in: 'is not one of',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  is_null: 'is empty',
  not_null: 'is not empty',
};

export type FilterValue = string | number | boolean;

export interface FilterSpec {
  column: string;
  op: FilterOp;
  value?: FilterValue;
  valueTo?: FilterValue;
  values?: FilterValue[];
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface PageRequest {
  page?: number;
  pageSize?: number;
  filters?: FilterSpec[];
  sort?: SortSpec[];
}

export type ColumnKind = 'number' | 'text' | 'boolean' | 'date' | 'unknown';

export interface ResultView {
  filters: FilterSpec[];
  sort: SortSpec[];
  page: number;
  pageSize: number;
  matchedRows?: number;
  capped?: boolean;
}

/** One page of a stored query's result. It is shown, never stored. */
export interface PageResult {
  columns: string[];
  columnKinds: Record<string, ColumnKind>;
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  pageCount: number;
  matchedRows: number;
  capped: boolean;
  view: ResultView;
  ranAt: string;
}

export interface FilterInterpretation {
  request: PageRequest;
  understood: string;
  rejected?: string[];
}

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_MAX_ROWS = 50_000;

/**
 * What the inspector needs from its host. The Run panel provides the adapter
 * over a stored run; a session chat can provide its own later. Each call that
 * changes the stored answer makes the host show the updated answer.
 */
export interface QueryEvidenceApi {
  /** Builds the evidence of an answer stored before the feature and sizes its tables. */
  prepare(): Observable<void>;
  /** Explains one query step by step (cached with the answer). */
  explain(index: number): Observable<void>;
  /** Counts the rows after each step, on demand. */
  countStages(index: number): Observable<void>;
  rerun(index: number): Observable<QueryRerunResult>;
  downloadCsv(index: number): Observable<Blob>;
  /** One page of the query's full result, filtered and sorted; stores nothing. */
  page(index: number, request: PageRequest): Observable<PageResult>;
}

export const QUERY_EVIDENCE_API = new InjectionToken<QueryEvidenceApi>(
  'QUERY_EVIDENCE_API',
);
