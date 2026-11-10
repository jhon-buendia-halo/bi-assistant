import type { SpanEventRow } from './repositories/span-events.repository';

/** One span folded from its event rows (`start`..., then `end`). */
export interface CollapsedSpan {
  spanId: string;
  parentSpanId: string | null;
  spanType: string;
  name: string | null;
  entityId: string | null;
  /** Set when the rows were read with it (session and trace queries). */
  entityName: string | null;
  traceId: string | null;
  /** `threadId`, else `metadata.threadId`, from any of the span's rows. */
  threadId: string | null;
  requestContext: Record<string, unknown>;
  startedAt: Date;
  /** Null while the span has no end row. */
  endedAt: Date | null;
  attributes: Record<string, unknown>;
  input: unknown;
  output: unknown;
  error: unknown;
}

/** A JSON column's value: DuckDB hands JSON back as text. */
export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Folds the event rows into spans: the end row wins, else the latest start
 * row (rows come in cursor order); a span starts at its earliest row.
 */
export function collapseSpans(
  rows: SpanEventRow[],
): Map<string, CollapsedSpan> {
  const latest = new Map<string, SpanEventRow>();
  const firstAt = new Map<string, Date>();
  const threadOf = new Map<string, string>();
  for (const row of rows) {
    const at = toDate(row.timestamp);
    const known = firstAt.get(row.spanId);
    if (at && (!known || at < known)) firstAt.set(row.spanId, at);
    if (row.threadId) threadOf.set(row.spanId, row.threadId);
    const current = latest.get(row.spanId);
    if (current?.eventType === 'end' && row.eventType !== 'end') continue;
    latest.set(row.spanId, row);
  }
  const spans = new Map<string, CollapsedSpan>();
  for (const [spanId, row] of latest) {
    const ended = row.eventType === 'end';
    spans.set(spanId, {
      spanId,
      parentSpanId: row.parentSpanId ?? null,
      spanType: row.spanType,
      name: row.name ?? null,
      entityId: row.entityId ?? null,
      entityName: row.entityName ?? null,
      traceId: row.traceId ?? null,
      threadId: threadOf.get(spanId) ?? null,
      requestContext: asRecord(parseJson(row.requestContext)),
      startedAt: firstAt.get(spanId) ?? new Date(0),
      endedAt: ended ? (toDate(row.endedAt) ?? toDate(row.timestamp)) : null,
      attributes: asRecord(parseJson(row.attributes)),
      input: parseJson(row.input),
      output: parseJson(row.output),
      error: parseJson(row.error),
    });
  }
  return spans;
}

/** The tool name of a `tool_call` span ("tool: 'run_readonly_sql'"). */
export function toolName(span: CollapsedSpan): string {
  const match = /^tool: '(.+)'$/.exec(span.name ?? '');
  return match?.[1] ?? span.entityId ?? span.name ?? 'tool';
}

/** A span failed: an error on it, or a tool's `success: false`. */
export function spanFailed(span: CollapsedSpan): boolean {
  return errorMessage(span.error) !== null || span.attributes.success === false;
}

/** No end row yet = running; else failed or succeeded. */
export function spanStatus(
  span: CollapsedSpan,
): 'succeeded' | 'failed' | 'running' {
  if (span.endedAt === null) return 'running';
  return spanFailed(span) ? 'failed' : 'succeeded';
}

/** The message of a span's error JSON, or null when it did not fail. */
export function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === 'string') return error;
  const e = asRecord(error);
  for (const key of ['message', 'error']) {
    if (typeof e[key] === 'string') return e[key];
  }
  const details = asRecord(e.details);
  if (typeof details.message === 'string') return details.message;
  return JSON.stringify(error);
}
