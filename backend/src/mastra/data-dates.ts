/**
 * The dates a dataset's data covers (agents.md 5.11: the catalog block and
 * Validate): each date column's range, captured when the dataset is saved,
 * and whether a dataset's data ends well before today, so a measure that
 * depends on "now" (tenure, age, time since) is taken from the data's own
 * date. A census exported on 2024-01-01 and analysed in 2026 must not say
 * that nobody was hired in the last three years. No framework import.
 */

/** A table whose data ends more than this many days before today is a snapshot. */
export const SNAPSHOT_AFTER_DAYS = 90;

/** At most this many date columns of one table get a range at save time. */
export const DATE_RANGE_COLUMNS_MAX = 12;

/** A column's range, as `YYYY-MM-DD`. */
export interface DateRange {
  min: string;
  max: string;
}

/** Whether a column type, as the datasource names it, holds dates. */
export function isDateType(type: string | undefined): boolean {
  return /\b(date|datetime|timestamp|timestamptz|timestamp_ntz|timestamp_ltz)\b/i.test(
    type ?? '',
  );
}

/** A date value from a driver as `YYYY-MM-DD`, or null when it is none. */
export function isoDay(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match ? match[1] : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch milliseconds (DuckDB and some drivers return these).
    return new Date(value).toISOString().slice(0, 10);
  }
  return null;
}

/** Whole days from `day` (`YYYY-MM-DD`) to `now`. */
function daysBefore(day: string, now: Date): number {
  const then = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(then)
    ? 0
    : Math.floor((now.getTime() - then) / 86_400_000);
}

/** Whether data ending on `day` ends well before today (a snapshot). */
export function isSnapshot(
  day: string | null | undefined,
  now = new Date(),
): boolean {
  return !!day && daysBefore(day, now) > SNAPSHOT_AFTER_DAYS;
}

/** A table as the data dates read it. */
export interface DatedTable {
  key: string;
  columns: readonly { name: string; range?: DateRange }[];
}

/** Where a dataset's data ends: its latest date, and the column that holds it. */
export interface DataEnd {
  date: string;
  table: string;
  column: string;
}

/**
 * Where a dataset's data ends: the latest date of any of its tables' date
 * columns. A dataset is one extract, so its own latest date is when its
 * data stops, and a table of older dates in it (a product's launch date, a
 * legacy table) is not singled out. Null when no column has a range.
 */
export function dataEnd(tables: readonly DatedTable[]): DataEnd | null {
  let end: DataEnd | null = null;
  for (const table of tables) {
    for (const column of table.columns) {
      const max = column.range?.max;
      if (max && (!end || max > end.date)) {
        end = { date: max, table: table.key, column: column.name };
      }
    }
  }
  return end;
}

/**
 * Whether a question asks for a figure that depends on the current date or
 * on recency (tenure, age, time since, the latest or last period, "now"):
 * the cue for telling Plan and Analyse where the data ends (*Data dates*,
 * agents.md 5.11). Any other question's request is as before.
 */
export function asksTimeRelative(question: string): boolean {
  return /\b(tenure|seniority|age|ages|aged|older|younger|old|years? of service|since|ago|how long|recent(ly)?|latest|last|current(ly)?|now|today|this (week|month|quarter|year)|antig[uü]edad|edad|desde|hace|reciente|[uú]ltim[oa]s?|actual(mente)?|hoy)\b/i.test(
    question,
  );
}

/** SQL that reads the current date or time, in any of the dialects the app speaks. */
const NOW_IN_SQL =
  /\b(current_date|current_timestamp|now\s*\(|today\s*\(|getdate\s*\(|sysdate|localtimestamp|curdate\s*\()/i;

/** Whether a statement measures against the current date. */
export function readsNow(sql: string): boolean {
  return NOW_IN_SQL.test(sql);
}

/** Whether the user's words ask about today, so measuring to today is wanted. */
export function asksAboutToday(question: string): boolean {
  return /\b(today|right now|as of now|current date|this (week|month|year)|hoy|actual(?:mente)?)\b/i.test(
    question,
  );
}

/** The table named in a statement: its key, or its last two or one parts. */
export function sqlReadsTable(sql: string, key: string): boolean {
  const parts = key.split('.');
  const table = parts.at(-1) ?? key;
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w])["\`]?${escaped}["\`]?($|[^\\w])`, 'i').test(
    sql,
  );
}
