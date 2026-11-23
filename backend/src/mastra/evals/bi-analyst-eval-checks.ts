import {
  DASHBOARD_ROWS_CAP,
  dashboardBindingErrors,
  type DashboardDraft,
} from '../workflows/bi-dashboard.schemas';
import type { EvalCustomCheck } from './assistant.evals';
import type { EvalRunDetails } from './eval-details';

/**
 * Custom checks of the `bi-analyst` set (agents.md 8.1, 2.22): what Clara's
 * accepted submission must hold. Framework-free: the target
 * (`bi-analyst-eval-target.ts`) records the run as a `BiAnalystRun` on the
 * run details (`output`), and the checks read only that.
 */

/** The submission the host accepted: Clara's draft, query and its result. */
export interface AcceptedDashboard {
  draft: DashboardDraft;
  sql: string;
  rowCount: number;
  /** The columns the query returned. */
  columns: string[];
}

/** What one run of Clara did: every refusal, and the accepted submission. */
export interface BiAnalystRun {
  /** How many times she called submit_dashboard. */
  submissions: number;
  /** The reasons the host refused a submission, in order. */
  refusals: string[];
  accepted?: AcceptedDashboard;
}

/** The host's answer to one submission (what the eval runtime returns). */
export type SubmissionVerdict =
  | { accepted: true; rowCount: number; columns: string[] }
  | { accepted: false; error: string };

/**
 * The host's check of one submission, as the app does it (agents.md 3.17):
 * more than `DASHBOARD_ROWS_CAP` rows are refused, and so is any field that
 * is not bound to a column of the query.
 */
export function judgeSubmission(
  draft: DashboardDraft,
  result: { columns: string[]; rows: unknown[] },
): SubmissionVerdict {
  if (result.rows.length > DASHBOARD_ROWS_CAP) {
    return {
      accepted: false,
      error: `The query returns more than ${DASHBOARD_ROWS_CAP} rows: aggregate it to the grain the widgets need.`,
    };
  }
  const errors = dashboardBindingErrors(draft, result.columns);
  if (errors.length) return { accepted: false, error: errors.join(' ') };
  return {
    accepted: true,
    rowCount: result.rows.length,
    columns: result.columns,
  };
}

/** The run a target recorded on the details, or an empty one. */
export function biRunOf(details: EvalRunDetails | undefined): BiAnalystRun {
  const output = details?.output as Partial<BiAnalystRun> | undefined;
  return {
    submissions: output?.submissions ?? 0,
    refusals: output?.refusals ?? [],
    accepted: output?.accepted,
  };
}

function acceptedOf(
  details: EvalRunDetails | undefined,
): AcceptedDashboard | string {
  const run = biRunOf(details);
  if (run.accepted) return run.accepted;
  return run.submissions
    ? `submit_dashboard was never accepted; last refusal: ${run.refusals.at(-1) ?? 'none'}`
    : 'submit_dashboard was never called';
}

/** A custom check over the accepted submission. */
function acceptedCheck(
  id: string,
  description: string,
  verdict: (accepted: AcceptedDashboard) => string | undefined,
): EvalCustomCheck {
  return {
    id,
    description,
    run: ({ details }) => {
      const accepted = acceptedOf(details);
      return typeof accepted === 'string' ? accepted : verdict(accepted);
    },
  };
}

/** Clara submitted, and the host accepted. */
export function submitAccepted(): EvalCustomCheck {
  return acceptedCheck(
    'submit-accepted',
    'submit_dashboard was accepted by the host',
    () => undefined,
  );
}

/** Every filter, dimension and measure is bound to a column of the result. */
export function noBindingErrors(): EvalCustomCheck {
  return acceptedCheck(
    'no-binding-errors',
    'the accepted draft has no binding errors against the query columns',
    ({ draft, columns }) => {
      const errors = dashboardBindingErrors(draft, columns);
      return errors.length ? errors.join(' ') : undefined;
    },
  );
}

/** The query returned at least `min` rows (and no more than the cap). */
export function rowsAtLeast(min: number): EvalCustomCheck {
  return acceptedCheck(
    'enough-rows',
    `the data query returned at least ${min} rows`,
    ({ rowCount }) =>
      rowCount >= min && rowCount <= DASHBOARD_ROWS_CAP
        ? undefined
        : `the query returned ${rowCount} rows, expected ${min} to ${DASHBOARD_ROWS_CAP}`,
  );
}

/** A widget sums a column whose name matches `column`. */
export function sumsColumn(column: RegExp): EvalCustomCheck {
  return acceptedCheck(
    'sums-column',
    `a widget measure sums a column matching ${column}`,
    ({ draft }) =>
      draft.widgets.some((widget) =>
        widget.measures.some(
          (measure) =>
            measure.aggregation === 'sum' && column.test(measure.column),
        ),
      )
        ? undefined
        : `no widget measure sums a column matching ${column}`,
  );
}

/** A filter or a widget dimension reads a column whose name matches. */
export function slicesBy(column: RegExp): EvalCustomCheck {
  return acceptedCheck(
    'slices-by',
    `a filter or a dimension reads a column matching ${column}`,
    ({ draft }) =>
      draft.filters.some((filter) => column.test(filter.column)) ||
      draft.widgets.some((widget) => column.test(widget.dimension))
        ? undefined
        : `no filter or dimension reads a column matching ${column}`,
  );
}

/** The dashboard holds a `select` filter on a column matching `column`. */
export function hasSelectFilterOn(column: RegExp): EvalCustomCheck {
  return acceptedCheck(
    'select-filter-added',
    `a select filter reads a column matching ${column}`,
    ({ draft, columns }) =>
      draft.filters.some(
        (filter) =>
          filter.kind === 'select' &&
          column.test(filter.column) &&
          columns.includes(filter.column),
      )
        ? undefined
        : `no select filter on a returned column matching ${column}`,
  );
}

/** Every widget id of the earlier dashboard is still there. */
export function keepsWidgetIds(ids: readonly string[]): EvalCustomCheck {
  return acceptedCheck(
    'keeps-widget-ids',
    `the widgets ${ids.join(', ')} are kept`,
    ({ draft }) => {
      const have = new Set(draft.widgets.map((widget) => widget.id));
      const lost = ids.filter((id) => !have.has(id));
      return lost.length ? `widgets dropped: ${lost.join(', ')}` : undefined;
    },
  );
}
