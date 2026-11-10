import { Inject, Injectable } from '@nestjs/common';
import type { LlmCallStatus } from '../entities/llm-call.entity';

/**
 * The query surface of the trace store's DuckDB connection
 * (`DuckDBConnection.query` of `@mastra/duckdb`, `?` parameters).
 */
export interface SpanEventsDb {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/** Injection token of the trace store's connection. */
export const SPAN_EVENTS_DB = 'SPAN_EVENTS_DB';

/** Filters of the LLM calls list; every value is bound as a parameter. */
export interface LlmCallFilter {
  id?: string;
  agent?: string;
  model?: string;
  provider?: string;
  status?: LlmCallStatus;
  session?: string;
  from?: Date;
  to?: Date;
}

/** One LLM call as the calls query returns it (one `model_generation`). */
export interface LlmCallRecord {
  id: string;
  traceId: string;
  startedAt: Date;
  endedAt: Date | null;
  agentId: string | null;
  agentName: string | null;
  sessionId: string | null;
  model: string;
  provider: string;
  status: LlmCallStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

/** One raw `span_events` row of a trace, JSON columns as stored. */
export interface SpanEventRow {
  eventType: string;
  timestamp: Date;
  cursorId: number | null;
  spanId: string;
  parentSpanId: string | null;
  spanType: string;
  name: string | null;
  entityId: string | null;
  endedAt: Date | null;
  attributes: unknown;
  input: unknown;
  output: unknown;
  error: unknown;
}

/**
 * `span_events` is event-sourced: a span has one or more `start` rows (the
 * later ones carry fuller attributes) and, once finished, one `end` row. A
 * call is the span's latest row, preferring the end row; it started at the
 * span's earliest timestamp.
 */
const CALLS_CTE = `
WITH generation_rows AS (
  SELECT *,
    MIN("timestamp") OVER (PARTITION BY spanId) AS firstAt,
    ROW_NUMBER() OVER (
      PARTITION BY spanId
      ORDER BY CASE WHEN eventType = 'end' THEN 1 ELSE 0 END DESC,
               cursorId DESC NULLS LAST,
               "timestamp" DESC
    ) AS rowRank
  FROM span_events
  WHERE spanType = 'model_generation'
),
calls AS (
  SELECT
    spanId AS id,
    traceId,
    firstAt AS startedAt,
    CASE WHEN eventType = 'end' THEN COALESCE(endedAt, "timestamp") END AS endedAt,
    entityId AS agentId,
    entityName AS agentName,
    COALESCE(threadId, json_extract_string(metadata, '$.threadId')) AS sessionId,
    COALESCE(
      json_extract_string(attributes, '$.model'),
      json_extract_string(attributes, '$.responseModel'),
      ''
    ) AS model,
    COALESCE(json_extract_string(attributes, '$.provider'), '') AS provider,
    CASE
      WHEN eventType <> 'end' THEN 'running'
      WHEN error IS NOT NULL AND json_type(error) <> 'NULL' THEN 'failed'
      ELSE 'succeeded'
    END AS status,
    TRY_CAST(json_extract_string(attributes, '$.usage.inputTokens') AS BIGINT) AS inputTokens,
    TRY_CAST(json_extract_string(attributes, '$.usage.outputTokens') AS BIGINT) AS outputTokens,
    TRY_CAST(json_extract_string(attributes, '$.usage.inputDetails.cacheRead') AS BIGINT) AS cacheReadTokens,
    TRY_CAST(json_extract_string(attributes, '$.usage.inputDetails.cacheWrite') AS BIGINT) AS cacheWriteTokens,
    TRY_CAST(json_extract_string(attributes, '$.usage.outputDetails.reasoning') AS BIGINT) AS reasoningTokens
  FROM generation_rows
  WHERE rowRank = 1
)`;

function whereClause(filter: LlmCallFilter): {
  sql: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const equals: [keyof LlmCallFilter, string][] = [
    ['id', 'id'],
    ['agent', 'agentId'],
    ['model', 'model'],
    ['provider', 'provider'],
    ['status', 'status'],
    ['session', 'sessionId'],
  ];
  for (const [key, column] of equals) {
    const value = filter[key];
    if (value === undefined) continue;
    conditions.push(`${column} = ?`);
    params.push(value);
  }
  if (filter.from) {
    conditions.push('startedAt >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push('startedAt <= ?');
    params.push(filter.to);
  }
  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/** Read-only access to Mastra's trace store (`span_events`) for Monitoring. */
@Injectable()
export class SpanEventsRepository {
  constructor(@Inject(SPAN_EVENTS_DB) private readonly db: SpanEventsDb) {}

  /** False on a fresh data dir, before Mastra created its tables. */
  async hasSpanEvents(): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'span_events'`,
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /** One page of calls, newest first (spanId breaks ties). */
  findCalls(
    filter: LlmCallFilter,
    limit: number,
    offset: number,
  ): Promise<LlmCallRecord[]> {
    const where = whereClause(filter);
    return this.db.query<LlmCallRecord>(
      `${CALLS_CTE}
SELECT * FROM calls ${where.sql}
ORDER BY startedAt DESC, id DESC
LIMIT ? OFFSET ?`,
      [...where.params, limit, offset],
    );
  }

  async countCalls(filter: LlmCallFilter): Promise<number> {
    const where = whereClause(filter);
    const rows = await this.db.query<{ n: number }>(
      `${CALLS_CTE}
SELECT COUNT(*) AS n FROM calls ${where.sql}`,
      where.params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** The distinct agents, models, providers and sessions of all calls. */
  async facetValues(): Promise<{
    agents: { id: string; name: string | null }[];
    models: string[];
    providers: string[];
    sessionIds: string[];
  }> {
    const [agents, models, providers, sessions] = await Promise.all([
      this.db.query<{ id: string; name: string | null }>(
        `${CALLS_CTE}
SELECT agentId AS id, MAX(agentName) AS name FROM calls
WHERE agentId IS NOT NULL GROUP BY agentId`,
      ),
      this.db.query<{ value: string }>(
        `${CALLS_CTE}
SELECT DISTINCT model AS value FROM calls WHERE model <> ''`,
      ),
      this.db.query<{ value: string }>(
        `${CALLS_CTE}
SELECT DISTINCT provider AS value FROM calls WHERE provider <> ''`,
      ),
      this.db.query<{ value: string }>(
        `${CALLS_CTE}
SELECT DISTINCT sessionId AS value FROM calls WHERE sessionId IS NOT NULL`,
      ),
    ]);
    return {
      agents,
      models: models.map((r) => r.value),
      providers: providers.map((r) => r.value),
      sessionIds: sessions.map((r) => r.value),
    };
  }

  /** The generation, model-step and tool-call rows of one trace. */
  traceSpanRows(traceId: string): Promise<SpanEventRow[]> {
    return this.db.query<SpanEventRow>(
      `SELECT eventType, "timestamp", cursorId, spanId, parentSpanId, spanType,
              name, entityId, endedAt, attributes, input, output, error
         FROM span_events
        WHERE traceId = ?
          AND spanType IN ('model_generation', 'model_step', 'tool_call')
        ORDER BY cursorId NULLS LAST, "timestamp"`,
      [traceId],
    );
  }
}
