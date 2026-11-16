import { BadRequestException } from '@nestjs/common';
import {
  FILTERS_MAX,
  FILTER_OPS,
  FILTER_VALUES_MAX,
  PAGE_MAX_ROWS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SORT_KEYS_MAX,
  VALUELESS_FILTER_OPS,
  type ColumnKind,
  type FilterOp,
  type FilterSpec,
  type FilterValue,
  type PageRequest,
  type PageResult,
  type PagedRows,
  type PagedStatement,
  type ResultView,
  type SortSpec,
} from '../../datasources/connectors/paged-sql.types';

/**
 * The page engine (roadmap 1.27.2, api.md 152, 154): a `PageRequest` checked
 * against one stored query and turned into the connector's `PagedStatement`,
 * and the connector's rows into a `PageResult`. Pure: no query, no store.
 * Every refusal is a 400, raised before any query runs.
 */

/** What a page is read from: one stored query, as recorded. */
export interface PageSource {
  /** The stored SQL (for a repaired query, the corrected one). */
  sql: string;
  /** The stored result's columns; the stored rows' keys when absent. */
  columns?: string[];
  /** The stored rows, read only to infer each column's kind. */
  rows?: Record<string, unknown>[];
  /**
   * Each column's kind, already read from the stored rows (an explorable
   * query keeps them instead of its rows); wins over what `rows` give.
   */
  kinds?: Record<string, ColumnKind>;
}

/** A checked request: the connector's statement and the view it reads. */
export interface PreparedPage {
  statement: PagedStatement;
  view: ResultView;
}

const LIMIT_TEXT = PAGE_MAX_ROWS.toLocaleString('en-US');
/** Text-matching operators read their value as text, whatever the column. */
const TEXT_MATCH_OPS: readonly FilterOp[] = [
  'contains',
  'not_contains',
  'starts_with',
];
const LIST_OPS: readonly FilterOp[] = ['in', 'not_in'];
/** A number as a string: no leading zero, so a code such as "02134" stays text. */
const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** An ISO date, with an optional time and zone. */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

function bad(message: string): never {
  throw new BadRequestException(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilterValue(value: unknown): value is FilterValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** One stored value's kind; null for a null. */
function kindOfValue(value: unknown): ColumnKind | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'bigint') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    const text = value.trim();
    if (NUMERIC.test(text)) return 'number';
    if (ISO_DATE.test(text) && !Number.isNaN(Date.parse(text))) return 'date';
    return 'text';
  }
  return 'unknown';
}

/**
 * Each column's kind, read from the stored rows: one kind when every
 * non-null value has it; a mix of plain values is text; an object, or no
 * value at all, is unknown.
 */
export function columnKindsOf(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, ColumnKind> {
  const kinds: Record<string, ColumnKind> = {};
  for (const column of columns) {
    const seen = new Set<ColumnKind>();
    for (const row of rows) {
      const kind = kindOfValue(row[column]);
      if (kind) seen.add(kind);
    }
    kinds[column] =
      seen.size === 0 || seen.has('unknown')
        ? 'unknown'
        : seen.size === 1
          ? Array.from(seen)[0]
          : 'text';
  }
  return kinds;
}

/**
 * The body of 152 and 154 read as a `PageRequest`: its shape only (an
 * object, lists where lists go, known operators and directions). The limits
 * and the columns are checked by `preparePage`, against the stored query.
 */
export function parsePageRequest(body: unknown): PageRequest {
  if (body === undefined || body === null) return {};
  if (!isRecord(body)) bad('The body must be a JSON object');
  const request: PageRequest = {};
  if (body.page !== undefined) request.page = body.page as number;
  if (body.pageSize !== undefined) request.pageSize = body.pageSize as number;
  if (body.filters !== undefined) {
    if (!Array.isArray(body.filters)) bad('filters must be a list');
    request.filters = body.filters.map(parseFilter);
  }
  if (body.sort !== undefined) {
    if (!Array.isArray(body.sort)) bad('sort must be a list');
    request.sort = body.sort.map(parseSort);
  }
  return request;
}

/** The longest text 153 and 155 read. */
export const INTERPRET_TEXT_MAX = 500;

/** The body of 153 and 155: the user's words and the view they see now. */
export interface InterpretFilterRequest {
  text: string;
  /** Null when the user sees the answer's stored rows. */
  view: ResultView | null;
}

/**
 * The body of 153 and 155 read: `text` the user's words (not blank, at
 * most 500 characters), `view` the current view, its filters and sort
 * read as 152 reads them.
 */
export function parseInterpretRequest(body: unknown): InterpretFilterRequest {
  if (!isRecord(body)) bad('The body must be a JSON object');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) bad('Write what to filter, sort or page');
  if (text.length > INTERPRET_TEXT_MAX) {
    bad(`The text is longer than ${INTERPRET_TEXT_MAX} characters`);
  }
  if (body.view === undefined || body.view === null)
    return { text, view: null };
  if (!isRecord(body.view)) bad('view must be a JSON object');
  const raw = body.view;
  const read = parsePageRequest({ filters: raw.filters, sort: raw.sort });
  const page =
    Number.isSafeInteger(raw.page) && (raw.page as number) >= 1
      ? (raw.page as number)
      : 1;
  const pageSize =
    Number.isInteger(raw.pageSize) &&
    (raw.pageSize as number) >= 1 &&
    (raw.pageSize as number) <= PAGE_SIZE_MAX
      ? (raw.pageSize as number)
      : PAGE_SIZE_DEFAULT;
  const view: ResultView = {
    filters: read.filters ?? [],
    sort: read.sort ?? [],
    page,
    pageSize,
  };
  if (typeof raw.matchedRows === 'number' && raw.matchedRows >= 0) {
    view.matchedRows = Math.floor(raw.matchedRows);
  }
  if (typeof raw.capped === 'boolean') view.capped = raw.capped;
  return { text, view };
}

function parseFilter(raw: unknown): FilterSpec {
  if (!isRecord(raw) || typeof raw.column !== 'string' || !raw.column) {
    bad('Each filter names a column');
  }
  const column = raw.column;
  const op = raw.op;
  if (
    typeof op !== 'string' ||
    !(FILTER_OPS as readonly string[]).includes(op)
  ) {
    bad(`Filter on ${column}: unknown operator "${String(op)}"`);
  }
  if (raw.values !== undefined && raw.values !== null) {
    if (!Array.isArray(raw.values)) {
      bad(`Filter on ${column}: values must be a list`);
    }
  }
  return {
    column,
    op: op as FilterOp,
    ...(raw.value !== undefined ? { value: raw.value as FilterValue } : {}),
    ...(raw.valueTo !== undefined
      ? { valueTo: raw.valueTo as FilterValue }
      : {}),
    ...(Array.isArray(raw.values)
      ? { values: raw.values as FilterValue[] }
      : {}),
  };
}

function parseSort(raw: unknown): SortSpec {
  if (!isRecord(raw) || typeof raw.column !== 'string' || !raw.column) {
    bad('Each sort key names a column');
  }
  if (raw.direction !== 'asc' && raw.direction !== 'desc') {
    bad(`Sort on ${raw.column}: the direction is asc or desc`);
  }
  return { column: raw.column, direction: raw.direction };
}

/** One filter value made the column's kind, else a 400 naming it. */
function coerce(
  column: string,
  op: FilterOp,
  kind: ColumnKind,
  value: FilterValue,
): FilterValue {
  if (TEXT_MATCH_OPS.includes(op)) return String(value);
  const shown = JSON.stringify(String(value));
  switch (kind) {
    case 'number': {
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value.trim())
            : NaN;
      if (!Number.isFinite(n))
        bad(`Filter on ${column}: ${shown} is not a number`);
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const text = String(value).trim().toLowerCase();
      if (text === 'true' || text === '1') return true;
      if (text === 'false' || text === '0') return false;
      return bad(`Filter on ${column}: ${shown} is not true or false`);
    }
    case 'date': {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(text))) {
        bad(`Filter on ${column}: ${shown} is not a date`);
      }
      return text;
    }
    case 'text':
      return String(value);
    default:
      return value;
  }
}

/** The ops for which an empty string is a value of its own (not NULL). */
const EMPTY_TEXT_OPS: readonly FilterOp[] = ['eq', 'neq', 'in', 'not_in'];

/**
 * A filter's value is there: a plain value; an empty string only where it
 * means a value of its own, the empty text of a text column (`gift_message
 * is ""` differs from `is empty`, NULL).
 */
function present(
  value: unknown,
  op: FilterOp,
  kind: ColumnKind,
): value is FilterValue {
  if (!isFilterValue(value)) return false;
  if (value !== '') return true;
  return (kind === 'text' || kind === 'unknown') && EMPTY_TEXT_OPS.includes(op);
}

function checkFilter(
  filter: FilterSpec,
  kinds: Record<string, ColumnKind>,
): FilterSpec {
  const { column, op } = filter;
  const kind = kinds[column] ?? 'unknown';
  const needsValue = (): never =>
    bad(`Filter on ${column}: ${op} needs a value`);
  if (VALUELESS_FILTER_OPS.includes(op)) return { column, op };
  if (LIST_OPS.includes(op)) {
    const values = filter.values ?? [];
    if (!values.length || !values.every((v) => present(v, op, kind)))
      needsValue();
    if (values.length > FILTER_VALUES_MAX) {
      bad(
        `Filter on ${column}: ${op} takes at most ${FILTER_VALUES_MAX} values`,
      );
    }
    return {
      column,
      op,
      values: values.map((v) => coerce(column, op, kind, v)),
    };
  }
  if (!present(filter.value, op, kind)) needsValue();
  const value = coerce(column, op, kind, filter.value as FilterValue);
  if (op !== 'between') return { column, op, value };
  if (!present(filter.valueTo, op, kind)) needsValue();
  return {
    column,
    op,
    value,
    valueTo: coerce(column, op, kind, filter.valueTo as FilterValue),
  };
}

/**
 * Check a request against the stored query and build the connector's
 * statement: page 1 of 50 by default, page sizes 1 to 100, at most 10
 * filters, 50 values per list and 3 sort keys; a column the result does not
 * have, or has twice, is refused, as is a page past the 50,000-row limit.
 * An empty sort is the default order, resolved by the connector.
 */
export function preparePage(
  source: PageSource,
  request: PageRequest,
): PreparedPage {
  const rows = source.rows ?? [];
  const columns = source.columns?.length
    ? source.columns
    : Object.keys(rows[0] ?? {});
  const page = request.page ?? 1;
  const pageSize = request.pageSize ?? PAGE_SIZE_DEFAULT;
  if (!Number.isSafeInteger(page) || page < 1) {
    bad('Page must be a whole number of at least 1');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
    bad(`Page size must be a whole number from 1 to ${PAGE_SIZE_MAX}`);
  }
  const offset = (page - 1) * pageSize;
  if (offset >= PAGE_MAX_ROWS) {
    bad(`Page ${page} is past the ${LIMIT_TEXT}-row limit`);
  }
  const filters = request.filters ?? [];
  const sort = request.sort ?? [];
  if (filters.length > FILTERS_MAX) {
    bad(`A view takes at most ${FILTERS_MAX} filters`);
  }
  if (sort.length > SORT_KEYS_MAX) {
    bad(`A view sorts by at most ${SORT_KEYS_MAX} columns`);
  }
  const usable = (column: string): void => {
    const count = columns.filter((c) => c === column).length;
    if (count === 0) bad(`Unknown column "${column}"`);
    if (count > 1) {
      bad(
        `Column "${column}" appears more than once in the result; it cannot be filtered or sorted`,
      );
    }
  };
  const kinds = { ...columnKindsOf(columns, rows), ...source.kinds };
  const checkedFilters = filters.map((filter) => {
    usable(filter.column);
    return checkFilter(filter, kinds);
  });
  const checkedSort = sort.map(({ column, direction }) => {
    usable(column);
    return { column, direction };
  });
  return {
    statement: {
      sql: source.sql,
      columns,
      filters: checkedFilters,
      sort: checkedSort,
      limit: Math.min(pageSize, PAGE_MAX_ROWS - offset),
      offset,
      kinds,
    },
    view: { filters: checkedFilters, sort: checkedSort, page, pageSize },
  };
}

/**
 * The connector's rows as the page answered (api.md 152): the matched rows
 * capped at 50,000 (`capped` when more matched), at least one page.
 */
export function pageResultOf(
  prepared: PreparedPage,
  paged: PagedRows,
  ranAt: string = new Date().toISOString(),
): PageResult {
  const { statement, view } = prepared;
  const columns = paged.columns.length ? paged.columns : statement.columns;
  const matchedRows = Math.min(paged.matchedRows, PAGE_MAX_ROWS);
  const capped = paged.matchedRows > PAGE_MAX_ROWS;
  return {
    columns,
    columnKinds: Object.fromEntries(
      columns.map((c) => [c, statement.kinds[c] ?? 'unknown']),
    ),
    rows: paged.rows,
    page: view.page,
    pageSize: view.pageSize,
    pageCount: Math.max(1, Math.ceil(matchedRows / view.pageSize)),
    matchedRows,
    capped,
    view: { ...view, matchedRows, capped },
    ranAt,
  };
}
