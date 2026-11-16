/**
 * The contract of a paged, filtered and sorted read of a stored query's
 * result (roadmap 1.27, ADR-0049, datasources R52). No framework import: the
 * connectors, the query-evidence layer, the `explore_result` tool and the
 * `result-explorer` agent all read it, and the frontend keeps a copy of the
 * wire types in `shared/query-evidence/query-evidence.model.ts`.
 */

/** The filter operators, in the order the inspector lists them. */
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

/** The operators that take no value. */
export const VALUELESS_FILTER_OPS: readonly FilterOp[] = [
  'is_null',
  'not_null',
];

export type FilterValue = string | number | boolean;

/** One condition on one result column; the conditions of a view are AND-ed. */
export interface FilterSpec {
  column: string;
  op: FilterOp;
  /** Every op but `in`, `not_in`, `is_null` and `not_null`. */
  value?: FilterValue;
  /** The upper bound of `between`. */
  valueTo?: FilterValue;
  /** `in` and `not_in`; at most `FILTER_VALUES_MAX`. */
  values?: FilterValue[];
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

/** What a client asks for. Every field is optional. */
export interface PageRequest {
  /** 1-based; default 1. */
  page?: number;
  /** Default `PAGE_SIZE_DEFAULT`, 1 to `PAGE_SIZE_MAX`. */
  pageSize?: number;
  /** At most `FILTERS_MAX`, AND-ed. */
  filters?: FilterSpec[];
  /** At most `SORT_KEYS_MAX`; none = the default order (plan 1.27.1). */
  sort?: SortSpec[];
}

export type ColumnKind = 'number' | 'text' | 'boolean' | 'date' | 'unknown';

/** The view a page was read with, as stored on an `explore_result` record. */
export interface ResultView {
  filters: FilterSpec[];
  sort: SortSpec[];
  page: number;
  pageSize: number;
  matchedRows?: number;
  capped?: boolean;
}

/** One page of a stored query's result. */
export interface PageResult {
  columns: string[];
  columnKinds: Record<string, ColumnKind>;
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  pageCount: number;
  /** Rows matching the filters, at most `PAGE_MAX_ROWS`. */
  matchedRows: number;
  /** More than `PAGE_MAX_ROWS` rows matched. */
  capped: boolean;
  view: ResultView;
  ranAt: string;
}

/** What `result-explorer` made of the user's words. */
export interface FilterInterpretation {
  request: PageRequest;
  /** One line, business words: "Country is Brazil · Goals at least 3". */
  understood: string;
  /** Parts that named no known column. */
  rejected?: string[];
}

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;
/** The rows a page can reach; equal to the CSV's `EXPORT_ROWS`. */
export const PAGE_MAX_ROWS = 50_000;
export const FILTERS_MAX = 10;
export const FILTER_VALUES_MAX = 50;
export const SORT_KEYS_MAX = 3;

/** The connector's input: built by query-evidence, run by the connector. */
export interface PagedStatement {
  /** The stored SQL, as recorded; the connector cleans it and raises its LIMIT. */
  sql: string;
  /** The result's columns, in order: the only names a filter or sort may use. */
  columns: string[];
  filters: FilterSpec[];
  /**
   * The requested keys; empty = the default order, resolved by the
   * connector (plan 1.27.1, 7: the stored outer ORDER BY when expressible,
   * else the first column), always followed by every column as tie-breaker.
   */
  sort: SortSpec[];
  limit: number;
  offset: number;
  kinds: Record<string, ColumnKind>;
}

/** The connector's output. */
export interface PagedRows {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Rows matching the filters, uncapped (the caller caps it). */
  matchedRows: number;
}
