import type {
  FilterSpec,
  FilterValue,
  SortSpec,
} from '../../modules/datasources/connectors/paged-sql.types';
import type { EvalCustomCheck } from './assistant.evals';

/**
 * Code checks of the `result-explorer` set (agents.md 8.1, 2.15): what is
 * deterministic about Nathan's reading of a request. The scored answer is
 * what `specOf` made of his reply, as JSON text (`ExplorerAnswer`: the
 * action, the 0-based candidate, the complete filters and sort, the absolute
 * page, `understood` and `rejected`), so each check reads the view the app
 * would show, not the model's raw words. Pure code, no framework import.
 */

/** The scored answer: the spec as the target writes it. */
export interface ExplorerAnswer {
  action?: unknown;
  /** 0-based index into the case's candidates. */
  query?: unknown;
  filters?: unknown;
  sort?: unknown;
  /** The absolute page. */
  page?: unknown;
  understood?: unknown;
  rejected?: unknown;
}

/** The answer as text, from the spec (what the target scores). */
export function explorerAnswerText(spec: {
  action: string;
  query: number;
  interpretation: {
    request: { page?: number; filters?: unknown[]; sort?: unknown[] };
    understood: string;
    rejected?: string[];
  };
}): string {
  const { request, understood, rejected } = spec.interpretation;
  const answer: ExplorerAnswer = {
    action: spec.action,
    query: spec.query,
    page: request.page ?? 1,
    filters: request.filters ?? [],
    sort: request.sort ?? [],
    understood,
    ...(rejected?.length ? { rejected } : {}),
  };
  return JSON.stringify(answer);
}

function answerIn(answer: string): ExplorerAnswer | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'The answer is not a JSON view';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'The answer is not a JSON object';
  }
  return parsed;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a === b;
}

function sameValues(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const left = a.map((v) => String(v).trim().toLowerCase()).sort();
  const right = b.map((v) => String(v).trim().toLowerCase()).sort();
  return left.every((v, i) => v === right[i]);
}

/** Column, op and values equal; text without case, numbers as numbers. */
export function sameFilter(a: FilterSpec, b: FilterSpec): boolean {
  if (a.column !== b.column || a.op !== b.op) return false;
  if (a.op === 'in' || a.op === 'not_in') return sameValues(a.values, b.values);
  return sameValue(a.value, b.value) && sameValue(a.valueTo, b.valueTo);
}

/** Two filter lists hold the same filters, in any order. */
export function sameFilterSet(a: FilterSpec[], b: FilterSpec[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a];
  for (const wanted of b) {
    const at = left.findIndex((f) => sameFilter(f, wanted));
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return true;
}

function said(filter: FilterSpec): string {
  const values = filter.values
    ? `[${filter.values.join(', ')}]`
    : [filter.value, filter.valueTo]
        .filter((v: FilterValue | undefined) => v !== undefined)
        .join(' to ');
  return `${filter.column} ${filter.op} ${values}`.trim();
}

function listOf(filters: FilterSpec[]): string {
  return filters.length ? filters.map(said).join('; ') : 'none';
}

function sortText(sort: SortSpec[]): string {
  return sort.length
    ? sort.map((s) => `${s.column} ${s.direction}`).join(', ')
    : 'default';
}

/** The reply was a usable view: an action, filters and sort lists, a page. */
export function replyIsAView(): EvalCustomCheck {
  return {
    id: 'reply-is-a-view',
    description:
      'The answer is a view: an action, the filters and sort lists and a page',
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      if (view.action !== 'explore' && view.action !== 'new-question') {
        return 'The answer has no action (explore or new-question)';
      }
      if (!Array.isArray(view.filters) || !Array.isArray(view.sort)) {
        return 'The answer has no filters or sort list';
      }
      return typeof view.page === 'number' ? undefined : 'No page';
    },
  };
}

/** The action is the expected one (a new question is not a filter). */
export function actionIs(action: 'explore' | 'new-question'): EvalCustomCheck {
  return {
    id: 'action',
    description:
      action === 'explore'
        ? 'The words are read as a view of the same rows (explore)'
        : 'The words are refused as a new question (new-question)',
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      return view.action === action
        ? undefined
        : `Expected action ${action}, got ${String(view.action)}`;
    },
  };
}

/** The candidate (0-based) the words were read against. */
export function queryIs(index: number): EvalCustomCheck {
  return {
    id: 'query',
    description: `The words are read against candidate Q${index + 1}`,
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      return view.query === index
        ? undefined
        : `Expected Q${index + 1}, got Q${typeof view.query === 'number' ? view.query + 1 : String(view.query)}`;
    },
  };
}

/**
 * The complete filter set is one of the acceptable sets (column, op and
 * value equal, text without case, in any order): there can be more than one
 * right way to say a range or "over 3".
 */
export function filtersAre(acceptable: FilterSpec[][]): EvalCustomCheck {
  return {
    id: 'filters',
    description: `The complete filter set is ${acceptable.map(listOf).join(' | ')}`,
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      if (!Array.isArray(view.filters)) return 'The answer has no filters list';
      const got = view.filters as FilterSpec[];
      return acceptable.some((set) => sameFilterSet(got, set))
        ? undefined
        : `Expected filters ${acceptable.map(listOf).join(' | ')}; got ${listOf(got)}`;
    },
  };
}

/** The complete sort, key by key, in order. */
export function sortIs(expected: SortSpec[]): EvalCustomCheck {
  return {
    id: 'sort',
    description: `The sort is ${sortText(expected)}`,
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      if (!Array.isArray(view.sort)) return 'The answer has no sort list';
      const got = view.sort as SortSpec[];
      const same =
        got.length === expected.length &&
        expected.every(
          (s, i) =>
            got[i].column === s.column && got[i].direction === s.direction,
        );
      return same
        ? undefined
        : `Expected sort ${sortText(expected)}; got ${sortText(got)}`;
    },
  };
}

/** The absolute page the move resolved to. */
export function pageIs(page: number): EvalCustomCheck {
  return {
    id: 'page',
    description: `The view lands on page ${page}`,
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      return view.page === page
        ? undefined
        : `Expected page ${page}; got ${String(view.page)}`;
    },
  };
}

/**
 * What no listed column holds is not filtered on: the words are a new
 * question, or the filter was dropped as one on a column the result does not
 * have (`rejected` lists it) and no filter was made up in its place.
 */
export function refusesWhatNoColumnHolds(): EvalCustomCheck {
  return {
    id: 'refuses-what-no-column-holds',
    description:
      'Words about a column the result does not have are a new question, or the part is left out and listed as rejected',
    run: ({ answer }) => {
      const view = answerIn(answer);
      if (typeof view === 'string') return view;
      if (view.action === 'new-question') return undefined;
      const rejected = Array.isArray(view.rejected) ? view.rejected : [];
      return rejected.length
        ? undefined
        : 'The words were read as a view, but nothing was refused: a filter was made up or the request was ignored';
    },
  };
}
