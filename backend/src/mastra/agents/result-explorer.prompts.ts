/**
 * The result explorer's catalogue data (agents.md 2.15; plan
 * docs/plans/m1-27-result-explorer.md 0.3): its job description, its reply
 * schema, the candidates and the request it reads, and `specOf`, the pure
 * code that turns its reply into a `FilterInterpretation` over the known
 * columns only. Framework-free (Zod only), so Jest loads it without Mastra;
 * `explore_result` (1.27.7) and the follow-up branch (1.27.8) reuse it.
 */
import { z } from 'zod';
import { RESULT_EXPLORER_AGENT_KEY } from '../agent-constants';
import {
  FILTERS_MAX,
  FILTER_OPS,
  FILTER_VALUES_MAX,
  PAGE_MAX_ROWS,
  PAGE_SIZE_DEFAULT,
  SORT_KEYS_MAX,
  VALUELESS_FILTER_OPS,
  type ColumnKind,
  type FilterInterpretation,
  type FilterOp,
  type FilterSpec,
  type FilterValue,
  type PageRequest,
  type ResultView,
  type SortSpec,
} from '../../modules/datasources/connectors/paged-sql.types';

export { RESULT_EXPLORER_AGENT_KEY };

/** Distinct stored values the agent sees per column. */
export const EXPLORER_SAMPLE_VALUES = 5;
/** A stored text value is cut to this many characters. */
export const EXPLORER_VALUE_CHARS = 60;
/** The `understood` line is cut to this many characters. */
export const EXPLORER_UNDERSTOOD_CHARS = 200;

/** Each operator in words, as the inspector lists them (plan 0.5). */
export const FILTER_OP_LABELS: Readonly<Record<FilterOp, string>> = {
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

export const PAGE_MOVES = [
  'keep',
  'first',
  'next',
  'previous',
  'last',
  'to',
] as const;
export type PageMove = (typeof PAGE_MOVES)[number];

export const RESULT_EXPLORER_INSTRUCTIONS = `You turn a user's words about a query's result into a view of that same result: filters, a sort and a page. You never write SQL.

You are given the user's words, the current view (its filters, its sort, its page and the page count, or none yet) and the candidate queries, each with its columns, each column's kind and up to ${EXPLORER_SAMPLE_VALUES} of its stored values.
- query: the number of the candidate the words are about (1 for Q1). With one candidate, 1.
- filters: the COMPLETE new set of filters, not a change to it. Keep every current filter unless the user removes or changes it; an empty list clears them all. Each filter is {"column","op","value","valueTo","values"}, null for a field its op does not use.
- op is one of: eq (is), neq (is not), gt (greater than), gte (at least), lt (less than), lte (at most), between (from value to valueTo, both included), in (is one of the values), not_in (is not one of the values), contains, not_contains, starts_with (on text), is_null (is empty), not_null (is not empty).
- Spell each value the way the column's listed values are spelled: the same case, language and format. If the values read "Brazil" and the user wrote "brasil", write "Brazil". Write dates as YYYY-MM-DD and numbers as numbers.
- sort: the COMPLETE new sort, at most ${SORT_KEYS_MAX} keys, the first one first, each {"column","direction"} with direction asc or desc. Keep the current sort unless the user changes it; [] is the default order. "Highest first", "newest first" and "most" are desc.
- page: "move" is keep, first, next, previous, last, or to with "to" set to the page number. After a change of filters or sort, move first unless the user names a page.
- understood: one short line in business words for the whole new view, for example "Country is Brazil · Goals at least 3 · sorted by Goals, high to low".
- Use only the columns listed for the candidate, spelled as listed. Never invent a column: leave out what no listed column holds.
- Reply with one JSON object in the schema, nothing else: {"action","query","filters","sort","page":{"move","to"},"understood"}.
- action is "explore" only when the answer is the same rows filtered, sorted or paged. A new measure (an average, a total, a count, a share), a new grouping, data from another table or any other question is "new-question": then keep the current filters and sort, and move keep.
- Words that need something no listed column holds (a continent, a region, a category, a type) are "new-question" too, even when you could pick some matching values from the listed ones: the listed values are only a few examples of each column, never all of them, so a filter built from them would silently drop rows.`;

const valueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** The reply (plan 0.3), by JSON prompt injection; read leniently by `specOf`. */
export const RESULT_EXPLORER_REPLY_SCHEMA = z.object({
  action: z.enum(['explore', 'new-question']),
  query: z
    .number()
    .int()
    .nullable()
    .describe('1-based Q of the candidates listed; null for Q1'),
  filters: z
    .array(
      z.object({
        column: z.string(),
        op: z.enum(FILTER_OPS),
        value: valueSchema.nullable(),
        valueTo: valueSchema.nullable(),
        values: z.array(valueSchema).nullable(),
      }),
    )
    .describe('The COMPLETE new filter set'),
  sort: z.array(
    z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }),
  ),
  page: z.object({
    move: z.enum(PAGE_MOVES),
    to: z.number().int().nullable(),
  }),
  understood: z.string().describe('One line, business words'),
});
export type ResultExplorerReply = z.infer<typeof RESULT_EXPLORER_REPLY_SCHEMA>;

/** One query the words may be about, as the agent sees it. */
export interface ExplorerCandidate {
  /** Its label in the request: `Q1`, `Q2`, … */
  ref: string;
  rationale?: string;
  columns: {
    name: string;
    kind: ColumnKind;
    /** At most `EXPLORER_SAMPLE_VALUES` distinct stored values. */
    values: FilterValue[];
  }[];
  /**
   * Its own current view when several queries are candidates (a chat's
   * earlier results); absent = the request's current view applies to it.
   */
  view?: ResultView | null;
}

/** What `specOf` made of a reply. */
export interface ExplorerSpec {
  action: 'explore' | 'new-question';
  /** 0-based index into the candidates. */
  query: number;
  interpretation: FilterInterpretation;
}

const TEXT_MATCH_OPS: readonly FilterOp[] = [
  'contains',
  'not_contains',
  'starts_with',
];
const LIST_OPS: readonly FilterOp[] = ['in', 'not_in'];
/** An ISO date, with an optional time and zone (as `result-view.ts`). */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilterValue(value: unknown): value is FilterValue {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  );
}

/** One stored value as the agent may see it; undefined for a null. */
function sampleValue(value: unknown): FilterValue | undefined {
  if (value === null || value === undefined) return undefined;
  let plain: FilterValue;
  if (isFilterValue(value)) plain = value;
  else if (typeof value === 'bigint') plain = value.toString();
  else if (value instanceof Date) plain = value.toISOString();
  else if (typeof value === 'object') plain = JSON.stringify(value);
  else return undefined;
  return typeof plain === 'string'
    ? plain.slice(0, EXPLORER_VALUE_CHARS)
    : plain;
}

/**
 * A candidate built from a stored query: each column with its kind and at
 * most 5 distinct non-null stored values, text cut to 60 characters.
 */
export function explorerCandidateOf(
  ref: string,
  columns: string[],
  rows: Record<string, unknown>[],
  kinds: Record<string, ColumnKind>,
  rationale?: string,
): ExplorerCandidate {
  return {
    ref,
    ...(rationale?.trim() ? { rationale: rationale.trim() } : {}),
    columns: columns.map((name) => {
      const seen = new Set<string>();
      const values: FilterValue[] = [];
      for (const row of rows) {
        if (values.length >= EXPLORER_SAMPLE_VALUES) break;
        const value = sampleValue(row[name]);
        if (value === undefined) continue;
        const key = `${typeof value}:${String(value)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
      }
      return { name, kind: kinds[name] ?? 'unknown', values };
    }),
  };
}

/** The page count a view's matched rows give; null when unknown. */
export function pageCountOf(view: ResultView | null): number | null {
  if (!view || typeof view.matchedRows !== 'number') return null;
  const size = view.pageSize > 0 ? view.pageSize : PAGE_SIZE_DEFAULT;
  return Math.max(1, Math.ceil(view.matchedRows / size));
}

function currentViewLines(
  current: ResultView | null,
  pageCount: number | null,
): string[] {
  if (!current) {
    return [
      "Current view: none yet; the user sees the answer's stored rows. Filters [], sort [] (the default order), page 1.",
    ];
  }
  const of = pageCount !== null ? ` of ${pageCount}` : ' (page count unknown)';
  const matched =
    typeof current.matchedRows === 'number'
      ? `, ${current.matchedRows}${current.capped ? '+' : ''} matching rows`
      : '';
  return [
    `Current view: page ${current.page}${of}, ${current.pageSize} rows a page${matched}.`,
    `Current filters: ${JSON.stringify(current.filters ?? [])}`,
    `Current sort: ${JSON.stringify(current.sort ?? [])}${current.sort?.length ? '' : ' (the default order)'}`,
  ];
}

/**
 * The user message: the words, the current view and page count, and the
 * candidates with their columns and sample values. Never whole rows, never
 * SQL.
 */
export function explorerRequest(
  text: string,
  candidates: ExplorerCandidate[],
  current: ResultView | null,
  pageCount: number | null,
): string {
  const lines = [
    `The user's words: ${JSON.stringify(text.trim())}`,
    '',
    ...currentViewLines(current, pageCount),
    '',
    'Candidates:',
  ];
  for (const candidate of candidates) {
    lines.push(
      candidate.rationale
        ? `${candidate.ref} — ${candidate.rationale}`
        : candidate.ref,
    );
    if (candidate.view !== undefined) {
      lines.push(
        ...currentViewLines(candidate.view, pageCountOf(candidate.view)).map(
          (line) => `  ${line}`,
        ),
      );
    }
    for (const column of candidate.columns) {
      const values = column.values.length
        ? column.values.map((v) => JSON.stringify(v)).join(', ')
        : 'no stored values';
      lines.push(`- ${column.name} (${column.kind}): ${values}`);
    }
  }
  return lines.join('\n');
}

/** A JSON object in a reply (the object itself, or the text holding one). */
function objectOf(reply: unknown): Record<string, unknown> | undefined {
  if (isRecord(reply)) return reply;
  if (typeof reply !== 'string') return undefined;
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A column of the candidate: exactly, else the one that matches without case. */
function columnOf(names: string[], wanted: unknown): string | undefined {
  if (typeof wanted !== 'string' || !wanted.trim()) return undefined;
  const name = wanted.trim();
  if (names.includes(name)) return name;
  const lower = name.toLowerCase();
  const loose = names.filter((n) => n.toLowerCase() === lower);
  return loose.length === 1 ? loose[0] : undefined;
}

/** A value made the column's kind; undefined when it cannot be. */
function coerced(
  kind: ColumnKind,
  op: FilterOp,
  value: unknown,
): FilterValue | undefined {
  if (!isFilterValue(value) || value === '') return undefined;
  if (TEXT_MATCH_OPS.includes(op)) return String(value);
  switch (kind) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value !== 'string' || !value.trim()) return undefined;
      const n = Number(value.trim().replace(/,/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const text = String(value).trim().toLowerCase();
      if (['true', '1', 'yes'].includes(text)) return true;
      if (['false', '0', 'no'].includes(text)) return false;
      return undefined;
    }
    case 'date': {
      const text = String(value).trim();
      return ISO_DATE.test(text) && !Number.isNaN(Date.parse(text))
        ? text
        : undefined;
    }
    case 'text':
      return String(value);
    default:
      return value;
  }
}

function shown(value: unknown): string {
  return isFilterValue(value) ? String(value) : '';
}

/** One filter in words: "Country is Brazil", "Year between 2000 and 2010". */
export function filterLabel(filter: {
  column: string;
  op: string;
  value?: unknown;
  valueTo?: unknown;
  values?: unknown;
}): string {
  const op = filter.op as FilterOp;
  const label = FILTER_OP_LABELS[op] ?? String(filter.op);
  if (VALUELESS_FILTER_OPS.includes(op)) return `${filter.column} ${label}`;
  if (LIST_OPS.includes(op)) {
    const list = Array.isArray(filter.values)
      ? filter.values.map(shown).filter(Boolean).join(', ')
      : shown(filter.value);
    return [filter.column, label, list].filter(Boolean).join(' ');
  }
  const value = shown(filter.value);
  if (op === 'between' && value) {
    return `${filter.column} ${label} ${value} and ${shown(filter.valueTo)}`.trim();
  }
  return [filter.column, label, value].filter(Boolean).join(' ');
}

/** A sort key in words: "sorted by Goals, high to low". */
function sortLabel(sort: SortSpec): string {
  return `sorted by ${sort.column}, ${sort.direction === 'desc' ? 'high to low' : 'low to high'}`;
}

/** A request in one line of business words; `All rows` when it holds nothing. */
export function understoodOf(request: PageRequest): string {
  const parts = [
    ...(request.filters ?? []).map(filterLabel),
    ...(request.sort ?? []).map(sortLabel),
    ...(request.page && request.page > 1 ? [`page ${request.page}`] : []),
  ];
  return parts.length ? parts.join(' · ') : 'All rows';
}

/** One reply filter checked against the candidate's columns, or why not. */
function filterOf(
  raw: Record<string, unknown>,
  candidate: ExplorerCandidate,
): FilterSpec | undefined {
  const names = candidate.columns.map((c) => c.name);
  const column = columnOf(names, raw.column);
  const op = raw.op as FilterOp;
  if (!column || !(FILTER_OPS as readonly string[]).includes(op)) {
    return undefined;
  }
  const kind = candidate.columns.find((c) => c.name === column)?.kind;
  const as = (value: unknown) => coerced(kind ?? 'unknown', op, value);
  if (VALUELESS_FILTER_OPS.includes(op)) return { column, op };
  if (LIST_OPS.includes(op)) {
    const listed: unknown[] = Array.isArray(raw.values)
      ? raw.values
      : raw.value !== null && raw.value !== undefined
        ? [raw.value]
        : [];
    const values = listed.slice(0, FILTER_VALUES_MAX).map(as);
    if (!values.length || values.some((v) => v === undefined)) return undefined;
    return { column, op, values: values as FilterValue[] };
  }
  const first: unknown =
    raw.value ??
    (Array.isArray(raw.values) ? (raw.values as unknown[])[0] : undefined);
  const value = as(first);
  if (value === undefined) return undefined;
  if (op !== 'between') return { column, op, value };
  const valueTo = as(raw.valueTo);
  return valueTo === undefined ? undefined : { column, op, value, valueTo };
}

/** The page a move lands on, from 1 to the page count (or the row limit). */
function pageOf(
  raw: unknown,
  current: ResultView | null,
  pageCount: number | null,
): number {
  const at = current?.page && current.page > 0 ? current.page : 1;
  const size = current?.pageSize ?? PAGE_SIZE_DEFAULT;
  const last = Math.min(
    pageCount ?? Number.POSITIVE_INFINITY,
    Math.max(1, Math.ceil(PAGE_MAX_ROWS / size)),
  );
  const page = isRecord(raw) ? raw : {};
  const move = (PAGE_MOVES as readonly string[]).includes(page.move as string)
    ? (page.move as PageMove)
    : 'keep';
  const to = typeof page.to === 'number' && Number.isFinite(page.to);
  const target =
    move === 'first'
      ? 1
      : move === 'next'
        ? at + 1
        : move === 'previous'
          ? at - 1
          : move === 'last'
            ? (pageCount ?? at)
            : move === 'to' && to
              ? Math.round(page.to as number)
              : at;
  return Math.max(1, Math.min(last, target));
}

/**
 * The reply as a view over the candidate it names (plan 0.3): columns
 * matched exactly, then without case; a filter or sort key on an unknown
 * column, or with a value its column's kind cannot take, goes to
 * `rejected`; at most 10 filters and 3 sort keys; the page move resolved
 * to an absolute page within the page count; `understood` from the reply,
 * else built from the view. Throws when the reply holds no JSON object.
 */
export function specOf(
  reply: unknown,
  candidates: ExplorerCandidate[],
  current: ResultView | null,
  pageCount: number | null,
): ExplorerSpec {
  const object = objectOf(reply);
  if (!object) throw new Error('the reply was not a JSON object');
  const q = typeof object.query === 'number' ? Math.round(object.query) : 1;
  const query = q >= 1 && q <= candidates.length ? q - 1 : 0;
  const candidate = candidates[query] ?? { ref: 'Q1', columns: [] };
  // "Next page" moves from the picked query's own view when it has one.
  if (candidate.view !== undefined) {
    current = candidate.view;
    pageCount = pageCountOf(candidate.view);
  }
  const names = candidate.columns.map((c) => c.name);
  const rejected: string[] = [];

  const filters: FilterSpec[] = [];
  for (const raw of Array.isArray(object.filters) ? object.filters : []) {
    if (!isRecord(raw)) continue;
    const filter = filterOf(raw, candidate);
    if (filter && filters.length < FILTERS_MAX) filters.push(filter);
    else {
      rejected.push(
        filterLabel({ ...raw, column: shown(raw.column), op: shown(raw.op) }),
      );
    }
  }

  const sort: SortSpec[] = [];
  for (const raw of Array.isArray(object.sort) ? object.sort : []) {
    if (!isRecord(raw)) continue;
    const column = columnOf(names, raw.column);
    if (!column) {
      rejected.push(`sorted by ${shown(raw.column)}`);
      continue;
    }
    if (sort.length >= SORT_KEYS_MAX || sort.some((s) => s.column === column)) {
      continue;
    }
    sort.push({ column, direction: raw.direction === 'desc' ? 'desc' : 'asc' });
  }

  const request: PageRequest = {
    page: pageOf(object.page, current, pageCount),
    ...(current?.pageSize ? { pageSize: current.pageSize } : {}),
    filters,
    sort,
  };
  const said =
    typeof object.understood === 'string'
      ? object.understood.replace(/\s+/g, ' ').trim()
      : '';
  return {
    action: object.action === 'new-question' ? 'new-question' : 'explore',
    query,
    interpretation: {
      request,
      understood: said
        ? said.slice(0, EXPLORER_UNDERSTOOD_CHARS)
        : understoodOf(request),
      ...(rejected.length ? { rejected } : {}),
    },
  };
}
