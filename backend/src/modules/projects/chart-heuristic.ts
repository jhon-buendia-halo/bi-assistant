import type { ToolDataRecord } from './entities/project.entity';

/**
 * Deterministic chart-form heuristic.
 *
 * The designer model is good at writing SVG and bad at choosing a form, so the
 * form is decided here from the shape of the rows and handed to it as advice.
 * Pure and dependency-free: same rows in, same recommendation out.
 */

export type ColumnRole = 'temporal' | 'numeric' | 'categorical';

export interface ColumnProfile {
  name: string;
  role: ColumnRole;
  /** Distinct non-null values within the sampled rows. */
  distinct: number;
}

export interface ChartRecommendation {
  /** Human sentence describing the data shape (roles, cardinalities, rows). */
  shape: string;
  /** The recommended visual form, phrased as guidance for the designer. */
  recommendation: string;
}

/** Advice to answer with a composed layout instead of a single chart. */
export interface CompositionRecommendation {
  /** Extra paragraph for `<recommended-form>` describing the composed layout. */
  guidance: string;
  /** Numeric columns the KPI tiles should headline (may be empty). */
  measures: string[];
}

/** The `<recommended-form>` block plus whether it asks for a composed answer. */
export interface RecommendedForm {
  /** The prompt block, ready to be dropped into the designer prompt. */
  block: string;
  /** True when the block asks for KPI tiles + main chart + detail table. */
  composed: boolean;
}

/** One column eligible for the dashboard filter bar and its allowed values. */
export interface DashboardFilter {
  column: string;
  values: string[];
}

/** Same row cap `visualizationData` applies before the designer sees the rows. */
const SAMPLE_ROWS_CAP = 100;
/** Above this many categories a ranked bar chart needs a top-N + "Other" cut. */
const MANY_CATEGORIES = 8;
/** A single result set needs at least this many measures to carry KPI tiles. */
const COMPOSED_MIN_MEASURES = 1;
/** …and at least this many rows, so the main chart still has something to say. */
const COMPOSED_MIN_ROWS = 4;

/**
 * Column-name tokens that mark a temporal column even when the values are bare
 * numbers (`month` = 1..12, `year` = 2019..2024). Token-based rather than
 * substring so `yearly_revenue` and `birthday` stay non-temporal.
 */
const TEMPORAL_TOKENS = new Set([
  'date',
  'dates',
  'datetime',
  'datetimes',
  'timestamp',
  'timestamps',
  'ts',
  'dt',
  'time',
  'times',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'quarter',
  'quarters',
  'year',
  'years',
  'yr',
  'period',
  'periods',
  'yearmonth',
  'yyyymm',
]);

/** `2024`, `2024-03`, `2024-03-01`, `2024-03-01T10:00:00Z`, `2024/03/01`. */
const ISO_LIKE =
  /^\d{4}[-/](0?[1-9]|1[0-2])([-/](0?[1-9]|[12]\d|3[01]))?([T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** Plain or thousands-separated numbers, including scientific notation. */
const NUMERIC_TEXT =
  /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][-+]?\d+)?$|^[-+]?\.\d+$/;

function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'bigint') return true;
  return typeof value === 'string' && NUMERIC_TEXT.test(value.trim());
}

function isTemporalValue(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && ISO_LIKE.test(value.trim());
}

function classify(name: string, values: unknown[]): ColumnRole {
  if (values.every(isTemporalValue)) return 'temporal';
  if (nameTokens(name).some((token) => TEMPORAL_TOKENS.has(token))) {
    return 'temporal';
  }
  if (values.every(isNumericValue)) return 'numeric';
  return 'categorical';
}

/** Profile every column that has at least one non-null value in the sample. */
export function profileColumns(
  columns: string[],
  rows: Record<string, unknown>[],
): ColumnProfile[] {
  return columns
    .map((name) => {
      const values = rows.map((row) => row[name]).filter((v) => !isBlank(v));
      if (!values.length) return undefined;
      const distinct = new Set(
        values.map((v) =>
          v instanceof Date ? v.toISOString() : String(v).trim(),
        ),
      ).size;
      return { name, role: classify(name, values), distinct };
    })
    .filter((profile): profile is ColumnProfile => profile !== undefined);
}

/** A record shape rich enough to derive dashboard filters from: the trimmed,
 * runtime-injected chart records (same shape as `ChartDataRecord`), not the
 * full `ToolDataRecord`. */
export interface FilterableRecord {
  columns?: string[];
  rows: Record<string, unknown>[];
}

/** A column needs at least this many, and no more than this many, distinct
 * values within one tile's sampled rows to be worth filtering on. */
const FILTER_MIN_DISTINCT = 2;
const FILTER_MAX_DISTINCT_PER_TILE = 20;
/** Merged (union, across every tile) values per column; over this the column
 * carries too many options to be a useful filter, so it is dropped. */
const FILTER_MAX_UNION_VALUES = 24;

/**
 * Dashboard filter bar columns, derived from the same bounded chart records
 * injected into each tile's `qti-data` (reuses `profileColumns`, the same
 * heuristic behind chart-form selection). A column becomes a filter when it
 * profiles as categorical or temporal with a modest cardinality (2-20 distinct
 * values) in at least one tile's own sampled rows. Its values are the union
 * across every tile that carries it — capped at 24, or dropped if the union
 * exceeds that. Columns are sorted alphabetically; each column's values are
 * sorted naturally.
 */
export function deriveDashboardFilters(
  tileRecords: FilterableRecord[][],
): DashboardFilter[] {
  const valuesByColumn = new Map<string, Set<string>>();
  for (const records of tileRecords) {
    for (const record of records) {
      const rows = record.rows ?? [];
      if (!rows.length) continue;
      const columns = record.columns?.length
        ? record.columns
        : Object.keys(rows[0] ?? {});
      for (const profile of profileColumns(columns, rows)) {
        if (profile.role !== 'categorical' && profile.role !== 'temporal') {
          continue;
        }
        if (
          profile.distinct < FILTER_MIN_DISTINCT ||
          profile.distinct > FILTER_MAX_DISTINCT_PER_TILE
        ) {
          continue;
        }
        const values = valuesByColumn.get(profile.name) ?? new Set<string>();
        for (const row of rows) {
          const raw = row[profile.name];
          if (raw === null || raw === undefined) continue;
          values.add(String(raw));
        }
        valuesByColumn.set(profile.name, values);
      }
    }
  }
  const filters: DashboardFilter[] = [];
  for (const [column, values] of valuesByColumn) {
    if (values.size > FILTER_MAX_UNION_VALUES) continue;
    filters.push({
      column,
      values: Array.from(values).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    });
  }
  return filters.sort((a, b) => a.column.localeCompare(b.column));
}

interface UsableRecord {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
}

/** Successful result sets that carry rows and columns, in their original order. */
function usableRecords(records: ToolDataRecord[]): UsableRecord[] {
  return records
    .filter((record) => !record.error && (record.rows?.length ?? 0) > 0)
    .map((record) => {
      const rows = (record.rows ?? []).slice(0, SAMPLE_ROWS_CAP);
      const columns = record.columns?.length
        ? record.columns
        : Object.keys(rows[0] ?? {});
      return {
        rows,
        columns,
        rowCount: record.rowCount ?? record.rows?.length ?? rows.length,
      };
    })
    .filter((record) => record.columns.length > 0);
}

/** The record the visual is most likely built from: the widest result set. */
function primaryRecord(records: ToolDataRecord[]): UsableRecord | undefined {
  const usable = usableRecords(records);
  if (!usable.length) return undefined;
  return usable.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
}

function describeShape(profiles: ColumnProfile[], rowCount: number): string {
  const columns = profiles
    .map((profile) =>
      profile.role === 'categorical'
        ? `${profile.name} (categorical, ${profile.distinct} distinct)`
        : `${profile.name} (${profile.role})`,
    )
    .join(', ');
  return `${rowCount} row${rowCount === 1 ? '' : 's'}; ${columns}`;
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Recommend one chart form from the rows behind an answer. Returns `undefined`
 * when there is nothing chartable (no successful record with rows/columns).
 */
export function recommendChartForm(
  records: ToolDataRecord[] | undefined,
): ChartRecommendation | undefined {
  const record = primaryRecord(records ?? []);
  if (!record) return undefined;

  const profiles = profileColumns(record.columns, record.rows);
  if (!profiles.length) return undefined;

  const temporal = profiles.filter((p) => p.role === 'temporal');
  const numeric = profiles.filter((p) => p.role === 'numeric');
  const categorical = profiles.filter((p) => p.role === 'categorical');
  const shape = describeShape(profiles, record.rowCount);
  const form = (recommendation: string) => ({ shape, recommendation });

  // 1 — a single row of measures reads as headline numbers, never as a chart.
  if (record.rowCount === 1 && numeric.length >= 1) {
    return form(
      `metric cards — one card per measure (${list(
        numeric.map((p) => p.name),
      )}), each showing the value large with its label beneath.`,
    );
  }

  // 2 — anything over time is a line; 2-3 measures become one line each.
  if (temporal.length >= 1 && numeric.length >= 1) {
    const axis = temporal[0].name;
    if (numeric.length >= 2 && numeric.length <= 3) {
      return form(
        `a multi-series line chart over ${axis}, one line per measure (${list(
          numeric.map((p) => p.name),
        )}), with a legend and hover or focus readout of the values.`,
      );
    }
    if (numeric.length === 1) {
      return form(
        `a line chart over ${axis} with ${numeric[0].name} on the value axis, ` +
          `points labelled or inspectable on hover and focus.`,
      );
    }
    return form(
      `a line chart over ${axis} plotting the most important measure, with a ` +
        `control to switch between the other measures (${list(
          numeric.map((p) => p.name),
        )}).`,
    );
  }

  // 3 — one label, one measure: ranked horizontal bars beat a pie every time.
  if (categorical.length === 1 && numeric.length === 1) {
    const category = categorical[0];
    const measure = numeric[0].name;
    const topN =
      category.distinct > MANY_CATEGORIES
        ? ` There are ${category.distinct} categories: show the top ${MANY_CATEGORIES} by ${measure} and group the remainder into a single "Other" bar.`
        : '';
    return form(
      `sorted horizontal bars — one bar per ${category.name}, ranked by ` +
        `${measure} descending, values labelled at the end of each bar.${topN}`,
    );
  }

  // 4 — two measures are a relationship, optionally split by one label.
  if (numeric.length === 2 && categorical.length <= 1) {
    const colour = categorical.length
      ? `, coloured by ${categorical[0].name} with a legend`
      : '';
    return form(
      `a scatter plot of ${numeric[0].name} (x axis) against ` +
        `${numeric[1].name} (y axis)${colour}, points inspectable on hover and focus.`,
    );
  }

  // 5 — two labels crossed by one measure is a matrix, not a bar chart.
  if (categorical.length === 2 && numeric.length === 1) {
    return form(
      `a heatmap with ${categorical[0].name} on one axis and ` +
        `${categorical[1].name} on the other, cells shaded by ${numeric[0].name} ` +
        `with a colour legend and the value readable per cell.`,
    );
  }

  // 6 — nothing matched: show the rows honestly instead of forcing a chart.
  return form(
    `a compact sortable table of the rows, with the numeric columns aligned ` +
      `right and column sorting available from the header.`,
  );
}

/**
 * Recommend a composed answer — KPI tiles, the main chart, and a detail table —
 * when the rows behind the answer carry enough substance for it. Two or more
 * successful queries mean the answer already has several angles; one wide,
 * reasonably long result set has headline figures worth pulling out above the
 * chart. Thin single-record data keeps the single-form recommendation.
 */
export function recommendComposition(
  records: ToolDataRecord[] | undefined,
): CompositionRecommendation | undefined {
  const usable = usableRecords(records ?? []);
  if (!usable.length) return undefined;

  const primary = usable.reduce((a, b) =>
    b.rows.length > a.rows.length ? b : a,
  );
  const measures = profileColumns(primary.columns, primary.rows)
    .filter((profile) => profile.role === 'numeric')
    .map((profile) => profile.name);

  const multipleResultSets = usable.length >= 2;
  const richSingleResultSet =
    measures.length >= COMPOSED_MIN_MEASURES &&
    primary.rowCount >= COMPOSED_MIN_ROWS;
  if (!multipleResultSets && !richSingleResultSet) return undefined;

  const because = multipleResultSets
    ? `The answer rests on ${usable.length} query results`
    : `The main result set has ${measures.length} measures over ${primary.rowCount} rows`;
  const tiles = measures.length
    ? `headline figures derived from the data (${list(measures)}) — value large, label beneath, and a delta only when the data itself supports one`
    : 'headline figures derived from the data — value large, label beneath, and a delta only when the data itself supports one';
  return {
    guidance:
      `${because}, so compose the answer instead of showing a single chart: ` +
      `a row of KPI tiles at the top with ${tiles}; below it the main chart ` +
      `described above; below that a collapsible detail table of the ` +
      `underlying rows. Keep it one fragment, and keep the KPI tiles as ` +
      `clickable as the chart marks (\`data-qti-value\` on both).`,
    measures,
  };
}

/** The `<recommended-form>` prompt block, or `undefined` when nothing applies. */
export function recommendedFormBlock(
  records: ToolDataRecord[] | undefined,
): RecommendedForm | undefined {
  const recommendation = recommendChartForm(records);
  if (!recommendation) return undefined;
  const composition = recommendComposition(records);
  return {
    composed: composition !== undefined,
    block: [
      '<recommended-form>',
      `Data shape: ${recommendation.shape}.`,
      `Recommended form: ${recommendation.recommendation}. Use this form unless the instruction or the`,
      'data itself argues for another; if you deviate, say why in the description.',
      ...(composition ? ['', `Composed answer: ${composition.guidance}`] : []),
      '</recommended-form>',
    ].join('\n'),
  };
}
