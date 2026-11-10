import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  SpanEventRow,
  SpanEventsDb,
} from '../repositories/span-events.repository';

/**
 * A trimmed copy of a real `span_events` export (2026-11-10, two assistant
 * turns of one session plus a third call still running): only the
 * model_generation, model_step and tool_call rows, long texts cut, null
 * columns left out, JSON columns stored as objects (DuckDB stores them as
 * JSON text). The second generation's first start row lost its input to keep
 * the file small; its end row carries it.
 */
export interface SpanEventsFixture {
  columns: { column_name: string; data_type: string }[];
  rows: Record<string, unknown>[];
}

export const FIXTURE: SpanEventsFixture = JSON.parse(
  readFileSync(join(__dirname, 'span-events.export.json'), 'utf8'),
) as SpanEventsFixture;

/** The session (thread) of the two finished turns. */
export const THREAD_ID = '89804ef6-7892-4951-8699-c743e36e3a40';
/** Turn 1: four steps, three tool calls, finished. */
export const GEN_1 = '5acadb4a328663d5';
/** Turn 2 ("And the second?"): one step, chat history, finished. */
export const GEN_2 = '895fb808a05b6914';
/** A call with no end row (still running), no thread. */
export const GEN_3 = '2bc8c7926dee7f23';

const JSON_COLUMNS = new Set(
  FIXTURE.columns
    .filter((c) => c.data_type === 'JSON')
    .map((c) => c.column_name),
);

/** Deep copies of the fixture rows. */
export function fixtureRows(): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(FIXTURE.rows)) as Record<string, unknown>[];
}

function toDate(value: unknown): Date | null {
  return typeof value === 'string'
    ? new Date(`${value.replace(' ', 'T')}Z`)
    : null;
}

/** The rows as the repository returns them (dates, JSON as text). */
export function toSpanEventRows(
  rows: Record<string, unknown>[] = fixtureRows(),
): SpanEventRow[] {
  return rows.map((r) => ({
    eventType: r.eventType as string,
    timestamp: toDate(r.timestamp)!,
    cursorId: r.cursorId === undefined ? null : Number(r.cursorId),
    spanId: r.spanId as string,
    parentSpanId: (r.parentSpanId as string | undefined) ?? null,
    spanType: r.spanType as string,
    name: (r.name as string | undefined) ?? null,
    entityId: (r.entityId as string | undefined) ?? null,
    endedAt: toDate(r.endedAt),
    attributes:
      r.attributes === undefined ? null : JSON.stringify(r.attributes),
    input: r.input === undefined ? null : JSON.stringify(r.input),
    output: r.output === undefined ? null : JSON.stringify(r.output),
    error: r.error === undefined ? null : JSON.stringify(r.error),
  }));
}

/** A DuckDB connection with `execute` (the test writes rows through it). */
export interface WritableDb extends SpanEventsDb {
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Creates `span_events` with the export's exact column list. */
export async function createSpanEventsTable(db: WritableDb): Promise<void> {
  const columns = FIXTURE.columns
    .map((c) => `"${c.column_name}" ${c.data_type}`)
    .join(', ');
  await db.execute(`CREATE TABLE span_events (${columns})`);
}

/** Inserts rows; JSON columns are written as JSON text. */
export async function insertSpanEvents(
  db: WritableDb,
  rows: Record<string, unknown>[],
): Promise<void> {
  const names = FIXTURE.columns.map((c) => c.column_name);
  const casts = FIXTURE.columns.map((c) => `CAST(? AS ${c.data_type})`);
  const sql = `INSERT INTO span_events (${names
    .map((n) => `"${n}"`)
    .join(', ')}) VALUES (${casts.join(', ')})`;
  for (const row of rows) {
    const params = names.map((name) => {
      const value = row[name];
      if (value === undefined || value === null) return null;
      if (JSON_COLUMNS.has(name)) return JSON.stringify(value);
      if (typeof value === 'boolean') return value;
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
    await db.execute(sql, params);
  }
}
