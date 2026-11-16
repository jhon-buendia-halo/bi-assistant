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
}

export const QUERY_EVIDENCE_API = new InjectionToken<QueryEvidenceApi>(
  'QUERY_EVIDENCE_API',
);
