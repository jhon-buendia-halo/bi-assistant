/**
 * Clara's dashboard (plan bi-dashboard 2.1): the draft she submits with
 * `submit_dashboard`, the checks that tie every field of it to a column of
 * her data query, and the pure code that turns the draft and the query's
 * rows into the blueprint the fixed dashboard runtime draws
 * (./dashboard-blueprint.schemas.ts, unchanged). Zod and plain code only,
 * no framework import.
 */
import { z } from 'zod';
import {
  BLUEPRINT_AGGREGATIONS,
  BLUEPRINT_COLUMN_TYPES,
  BLUEPRINT_FILTER_KINDS,
  BLUEPRINT_FORMATS,
  BLUEPRINT_WIDGET_KINDS,
  blueprintThemeSchema,
  type dashboardBlueprintSchema,
} from './dashboard-blueprint.schemas';

/** Clara's registry key (agents.md 1.2). */
export { BI_ANALYST_AGENT_KEY } from '../agent-constants';
/** Her tool that hands the dashboard and its data query to the host. */
export const SUBMIT_DASHBOARD_TOOL = 'submit_dashboard';
/** Avery's tool that calls Clara. */
export const BUILD_DASHBOARD_TOOL = 'build_dashboard';
/** The most rows a dashboard's data query keeps. */
export const DASHBOARD_ROWS_CAP = 5_000;
/** The most characters of `JSON.stringify(rows)` a dashboard keeps. */
export const DASHBOARD_DATA_CHAR_CAP = 2_000_000;
/** The most build_dashboard calls in one run. */
export const BUILD_DASHBOARD_MAX_CALLS = 2;

/** The most options a filter offers, and values a column lists. */
const FILTER_OPTIONS_CAP = 50;
const COLUMN_VALUES_CAP = 200;

const DRAFT_FILTER_KINDS = BLUEPRINT_FILTER_KINDS.filter(
  (kind): kind is Exclude<typeof kind, 'other'> => kind !== 'other',
) as [
  Exclude<(typeof BLUEPRINT_FILTER_KINDS)[number], 'other'>,
  ...Exclude<(typeof BLUEPRINT_FILTER_KINDS)[number], 'other'>[],
];
const DRAFT_WIDGET_KINDS = BLUEPRINT_WIDGET_KINDS.filter(
  (kind): kind is Exclude<typeof kind, 'other'> => kind !== 'other',
) as [
  Exclude<(typeof BLUEPRINT_WIDGET_KINDS)[number], 'other'>,
  ...Exclude<(typeof BLUEPRINT_WIDGET_KINDS)[number], 'other'>[],
];

/** One control that narrows the widgets it filters. */
const draftFilterSchema = z.object({
  id: z.string().describe('A short kebab-case id, unique among filters.'),
  label: z.string().describe('The label the dashboard shows.'),
  kind: z
    .enum(DRAFT_FILTER_KINDS)
    .describe('The control. A search box narrows every widget.'),
  column: z
    .string()
    .describe(
      'The column of the data query it filters; any for a search box. Its options are the values in the rows.',
    ),
});

/** One figure of a widget: a column of the rows folded by an aggregation. */
const draftMeasureSchema = z.object({
  label: z.string().describe('The name the dashboard gives the figure.'),
  column: z
    .string()
    .describe(
      'The column of the data query it folds: a number column for sum, avg, min and max; empty for a count of rows.',
    ),
  aggregation: z.enum(BLUEPRINT_AGGREGATIONS).describe('How rows fold.'),
  format: z.enum(BLUEPRINT_FORMATS).describe('How the value is written.'),
  unit: z.string().describe('A unit or currency symbol; empty for none.'),
});

/** One widget, computed in the page from the rows its filters leave. */
const draftWidgetSchema = z.object({
  id: z.string().describe('A short kebab-case id, unique among widgets.'),
  title: z.string().describe('The title the dashboard shows.'),
  kind: z.enum(DRAFT_WIDGET_KINDS).describe('What the widget draws.'),
  span: z
    .number()
    .describe('Its width in a 12-column grid, 2 to 12; widgets wrap in order.'),
  measures: z
    .array(draftMeasureSchema)
    .describe('The figures it shows; one for a KPI, a pie or a donut.'),
  dimension: z
    .string()
    .describe(
      'The column of the data query it breaks the measures down by; empty for none.',
    ),
  description: z
    .string()
    .describe('What it shows: measure, breakdown, units and time grain.'),
  filteredBy: z
    .array(z.string())
    .describe('The ids of the filters that change it.'),
});

/** One column of the data query, as the widgets read it. */
const draftColumnSchema = z.object({
  name: z
    .string()
    .describe('The column name, exactly as the query aliases it.'),
  type: z.enum(BLUEPRINT_COLUMN_TYPES).describe('The column type.'),
  description: z.string().describe('What it holds.'),
});

/** Clara's dashboard: what it shows, bound to the columns of her data query. */
export const dashboardDraftSchema = z.object({
  title: z.string().describe("The dashboard's title."),
  summary: z.string().describe('What the dashboard is for, in a sentence.'),
  theme: blueprintThemeSchema.describe('Its look.'),
  layout: z
    .string()
    .describe('The grid in words: rows, and which widget sits where.'),
  filters: z.array(draftFilterSchema).describe('Its controls.'),
  widgets: z
    .array(draftWidgetSchema)
    .min(1)
    .max(12)
    .describe('Its widgets, in reading order: 1 to 12.'),
  columns: z
    .array(draftColumnSchema)
    .describe(
      'The columns of the data query that the widgets and filters read.',
    ),
});

/** What Clara submits: the dashboard and the one query that feeds it. */
export const submitDashboardInputSchema = z.object({
  dashboard: dashboardDraftSchema.describe('The dashboard.'),
  sql: z
    .string()
    .describe(
      'One read-only SELECT or WITH statement at the grain the widgets need, returning at most 5000 rows, with a snake_case alias for every column.',
    ),
  datasourceId: z
    .string()
    .optional()
    .describe('The datasource to run it on; optional with one datasource.'),
  rationale: z
    .string()
    .describe('Why this query, in one sentence the user reads.'),
});

export type DashboardDraft = z.output<typeof dashboardDraftSchema>;
export type DashboardBlueprint = z.output<typeof dashboardBlueprintSchema>;
/** One row of a dashboard's data, as the page reads it. */
export type DashboardRow = Record<string, string | number | boolean | null>;

type ColumnType = (typeof BLUEPRINT_COLUMN_TYPES)[number];

/**
 * What is wrong with the draft against the columns its query returns, one
 * sentence each, for Clara to fix; empty when every field is bound.
 */
export function dashboardBindingErrors(
  d: DashboardDraft,
  queryColumns: string[],
): string[] {
  const errors: string[] = [];
  const returned = new Set(queryColumns);
  const declared = new Map<string, ColumnType>(
    d.columns.map((column) => [column.name, column.type]),
  );
  // Why a column cannot be read, or undefined when it can.
  const unbound = (column: string): string | undefined => {
    if (!returned.has(column)) return 'which the query does not return';
    if (!declared.has(column)) {
      return 'which dashboard.columns does not describe: add it there';
    }
    return undefined;
  };

  for (const column of d.columns) {
    if (!returned.has(column.name)) {
      errors.push(`Column "${column.name}" is not returned by the query.`);
    }
  }
  for (const id of repeated(d.filters.map((filter) => filter.id))) {
    errors.push(`Filter id "${id}" is used more than once.`);
  }
  for (const id of repeated(d.widgets.map((widget) => widget.id))) {
    errors.push(`Widget id "${id}" is used more than once.`);
  }
  const filterIds = new Set(d.filters.map((filter) => filter.id));
  const seenFilters = new Set<string>();
  for (const filter of d.filters) {
    if (filter.kind === 'search' || seenFilters.has(filter.id)) continue;
    seenFilters.add(filter.id);
    const why = unbound(filter.column);
    if (why) {
      errors.push(
        `Filter "${filter.id}" reads column "${filter.column}", ${why}.`,
      );
    }
  }
  for (const widget of d.widgets) {
    if (widget.dimension) {
      const why = unbound(widget.dimension);
      if (why) {
        errors.push(
          `Widget "${widget.id}" breaks down by "${widget.dimension}", ${why}.`,
        );
      }
    }
    for (const measure of widget.measures) {
      const name = `Widget "${widget.id}" measure "${measure.label}"`;
      if (!measure.column) {
        if (measure.aggregation !== 'count') {
          errors.push(
            `${name} reads no column: name a number column, or use count.`,
          );
        }
        continue;
      }
      const why = unbound(measure.column);
      if (why) {
        errors.push(`${name} reads "${measure.column}", ${why}.`);
        continue;
      }
      const type = declared.get(measure.column);
      if (measure.aggregation !== 'count' && type !== 'number') {
        errors.push(
          `${name} takes the ${measure.aggregation} of "${measure.column}", a ${type} column: use a number column, or count.`,
        );
      }
    }
    for (const id of widget.filteredBy) {
      if (!filterIds.has(id)) {
        errors.push(
          `Widget "${widget.id}" is filtered by "${id}", which is no filter id.`,
        );
      }
    }
  }
  return errors;
}

/** The values that appear more than once, once each. */
function repeated(values: string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) twice.add(value);
    seen.add(value);
  }
  return [...twice];
}

/**
 * The query's rows as the page reads them: only the draft's columns, a
 * number column's values as numbers (null when not a number), a date
 * column's as ISO text (the day alone at midnight UTC), a boolean's as
 * true or false, and everything else as text.
 */
export function prepareDashboardRows(
  rows: Record<string, unknown>[],
  d: DashboardDraft,
): DashboardRow[] {
  return rows.map((row) => {
    const out: DashboardRow = {};
    for (const column of d.columns) {
      out[column.name] = cellOf(row[column.name], column.type);
    }
    return out;
  });
}

function cellOf(
  value: unknown,
  type: ColumnType,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number': {
      if (typeof value === 'string' && !value.trim()) return null;
      const n = Number(value);
      return typeof value === 'boolean' || !Number.isFinite(n) ? null : n;
    }
    case 'date': {
      if (value instanceof Date) return isoOf(value);
      if (typeof value === 'number') return isoOf(new Date(value));
      return textOf(value);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      const text = textOf(value).trim().toLowerCase();
      if (['t', 'true', 'yes', 'y', '1'].includes(text)) return true;
      if (['f', 'false', 'no', 'n', '0'].includes(text)) return false;
      return null;
    }
    default:
      return textOf(value);
  }
}

function isoOf(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) return isoOf(value) ?? '';
  return JSON.stringify(value);
}

/**
 * The blueprint the runtime draws from the draft and its rows: each
 * filter's options are the distinct values of its column (sorted, at most
 * 50), each string, date or boolean column lists its distinct values in the
 * rows' order (at most 200) and each number column its range; nothing is
 * read from an image (`observed` empty, every `total` null).
 */
export function blueprintFromDraft(
  d: DashboardDraft,
  rows: DashboardRow[],
): DashboardBlueprint {
  return {
    title: d.title,
    summary: d.summary,
    theme: { ...d.theme, palette: [...d.theme.palette] },
    layout: d.layout,
    filters: d.filters.map((filter) => ({
      id: filter.id,
      label: filter.label,
      kind: filter.kind,
      column: filter.column,
      options:
        filter.kind === 'search'
          ? []
          : distinct(rows, filter.column, Infinity)
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
              .slice(0, FILTER_OPTIONS_CAP),
    })),
    widgets: d.widgets.map((widget) => ({
      id: widget.id,
      title: widget.title,
      kind: widget.kind,
      span: widget.span,
      measures: widget.measures.map((measure) => ({
        label: measure.label,
        column: measure.column,
        aggregation: measure.aggregation,
        format: measure.format,
        unit: measure.unit,
        total: null,
      })),
      dimension: widget.dimension,
      description: widget.description,
      observed: '',
      filteredBy: [...widget.filteredBy],
    })),
    columns: d.columns.map((column) => {
      const numbers =
        column.type === 'number'
          ? rows
              .map((row) => row[column.name])
              .filter((v): v is number => typeof v === 'number')
          : [];
      return {
        name: column.name,
        type: column.type,
        description: column.description,
        values:
          column.type === 'number'
            ? []
            : distinct(rows, column.name, COLUMN_VALUES_CAP),
        min: numbers.length ? Math.min(...numbers) : null,
        max: numbers.length ? Math.max(...numbers) : null,
      };
    }),
  };
}

/** A column's distinct non-null values as text, in the rows' order. */
function distinct(rows: DashboardRow[], column: string, cap: number) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    seen.add(String(value));
    if (seen.size >= cap) break;
  }
  return [...seen];
}

/**
 * The draft behind a blueprint: what Clara is given to change a dashboard.
 * The parts read from the rows are dropped; a blueprint's `other` kinds
 * (in a dashboard saved before versions) read as a select and a table.
 */
export function draftOf(b: DashboardBlueprint): DashboardDraft {
  return {
    title: b.title,
    summary: b.summary,
    theme: { ...b.theme, palette: [...b.theme.palette] },
    layout: b.layout,
    filters: b.filters.map((filter) => ({
      id: filter.id,
      label: filter.label,
      kind: filter.kind === 'other' ? 'select' : filter.kind,
      column: filter.column,
    })),
    widgets: b.widgets.map((widget) => ({
      id: widget.id,
      title: widget.title,
      kind: widget.kind === 'other' ? 'table' : widget.kind,
      span: widget.span,
      measures: widget.measures.map((measure) => ({
        label: measure.label,
        column: measure.column,
        aggregation: measure.aggregation,
        format: measure.format,
        unit: measure.unit,
      })),
      dimension: widget.dimension,
      description: widget.description,
      filteredBy: [...widget.filteredBy],
    })),
    columns: b.columns.map((column) => ({
      name: column.name,
      type: column.type,
      description: column.description,
    })),
  };
}
