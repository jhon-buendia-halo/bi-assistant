// The SQL reliability loop of a turn (agents.md 5.2–5.4): execution-guided
// repair and the Verified badge.
import { BadRequestException, type Logger } from '@nestjs/common';
import type { MastraService } from '../../../mastra/mastra.service';
import type {
  DatasetSnapshot,
  SqlCallOptions,
  SqlRunResult,
} from '../../../mastra/tool-services';
import { sqlFixOutputSchema } from '../../../mastra/agents/sql-fixer.agent';
import type { DatasourcesService } from '../../datasources/datasources.service';
import type { VerifiedQueriesService } from '../../verified-queries/verified-queries.service';
import { logSql } from './log-text';
import type { SessionDoc, ToolDataRecord } from '../entities/session.entity';
import { sqlDialectOf } from './sql-dialect';
import { lastSuccessfulSql } from './turn-records';
import { SessionDatasets, turnProviderOptions } from './session-datasets';

/** Repair attempts allowed per failed statement (3 executions at most). */
const SQL_REPAIR_ATTEMPTS = 2;
const SQL_REPAIRED_NOTE =
  'original query failed and was auto-corrected — cite the corrected SQL';
const EMPTY_ROWS_NOTE =
  'query returned 0 rows — verify filters/values before concluding';
const limitReachedNote = (limit: number) =>
  `row limit ${limit} reached — results may be incomplete; aggregate or narrow the query for exact totals`;
/** Character budget for the schema block handed to the fixer. */
const FIXER_SCHEMA_CHARS = 4_000;

/** What the SQL checks run on: the session service's own dependencies. */
export interface SqlChecksDeps {
  mastra: MastraService;
  datasourcesService: DatasourcesService;
  verifiedQueries: VerifiedQueriesService;
  datasets: SessionDatasets;
  /** The session service's logger, so log lines keep their context. */
  logger: Logger;
}

export class SqlChecks {
  constructor(private readonly deps: SqlChecksDeps) {}

  /**
   * `DatasourcesService.runReadOnlySql` with the turn's stop signal when
   * there is one (datasources R38): an abort cancels the statement at the
   * source and rejects with the signal's reason. `options.maxRows` lifts
   * the connectors' 500-row clamp (a dashboard's data query, 5,000).
   */
  private runReadOnly(
    datasourceId: string,
    sql: string,
    limit: number,
    options?: SqlCallOptions,
  ) {
    const { datasourcesService } = this.deps;
    const maxRows = options?.maxRows;
    if (options?.signal) {
      return datasourcesService.runReadOnlySql(
        datasourceId,
        sql,
        limit,
        maxRows,
        { signal: options.signal },
      );
    }
    return maxRows === undefined
      ? datasourcesService.runReadOnlySql(datasourceId, sql, limit)
      : datasourcesService.runReadOnlySql(datasourceId, sql, limit, maxRows);
  }

  // ----------------------------------------------------- SQL self-correction

  /**
   * Execution-guided repair: when a statement fails to execute, hand it plus
   * the engine error and the schema in scope to the `sql-fixer` agent and
   * re-run, up to `SQL_REPAIR_ATTEMPTS` times. Empty result sets are not
   * errors — they get a note, never an LLM call. The last error propagates so
   * the tool reports it to the agent as before. `options.signal` (the turn's
   * stop) reaches every run and the fixer call; a statement it cut short is
   * not repaired, the stop's reason propagates.
   */
  async runSqlWithRepair(
    datasourceId: string,
    sql: string,
    limit: number,
    datasetNames: string[],
    options?: SqlCallOptions,
  ): Promise<SqlRunResult> {
    const signal = options?.signal;
    let statement = sql;
    let fixerContext: { dialect: string; schema: string } | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.runReadOnly(
          datasourceId,
          statement,
          limit,
          options,
        );
        const repaired = statement !== sql;
        // The connector says how many rows the statement produced before
        // its cap: the result is cut only when some were dropped, and the
        // model must then aggregate or caveat rather than treat it as total.
        // A result that lands exactly on the limit is whole (a `LIMIT 100`
        // under a limit of 100). Without that count, a full page still
        // reads as cut.
        const truncated =
          typeof result.totalRows === 'number'
            ? result.totalRows > result.rows.length
            : result.rows.length >= limit;
        const notes = [
          ...(repaired ? [SQL_REPAIRED_NOTE] : []),
          ...(result.rows.length ? [] : [EMPTY_ROWS_NOTE]),
          ...(truncated ? [limitReachedNote(limit)] : []),
        ];
        return {
          ...result,
          ...(repaired ? { correctedSql: statement } : {}),
          ...(truncated ? { truncated: true } : {}),
          ...(notes.length ? { note: notes.join('; ') } : {}),
        };
      } catch (error) {
        // Stopped: no repair, the stop's reason ends the call.
        signal?.throwIfAborted();
        if (attempt >= SQL_REPAIR_ATTEMPTS) throw error;
        // Guard rejections (statement never reached the engine) and
        // transport/auth failures aren't a formatting problem a rewrite can
        // fix — skip the fixer round trip and let the real error surface.
        if (!isRepairableSqlError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        fixerContext ??= await this.sqlFixerContext(datasetNames, datasourceId);
        const corrected = await this.repairSql(
          statement,
          message,
          fixerContext,
          signal,
        );
        signal?.throwIfAborted();
        if (!corrected || corrected === statement) throw error;
        // `statement`, not `sql`: attempt 2 is repairing the fixer's own
        // rewrite from attempt 1. Message and SQL both flattened/capped — this ships in
        // diagnostics reports and must stay one line per failure.
        this.deps.logger.warn(
          `Repairing failed SQL (attempt ${attempt + 1}): ${logSql(message)} — SQL: ${logSql(statement)}`,
        );
        statement = corrected;
      }
    }
  }

  /** Dialect + a capped `entity(column type, …)` block for the fixer prompt. */
  private async sqlFixerContext(
    datasetNames: string[],
    datasourceId: string,
  ): Promise<{ dialect: string; schema: string }> {
    const datasets = await this.deps.datasets.bound(datasetNames);
    const onDatasource = datasets.filter(
      (s) => s.datasourceId === datasourceId,
    );
    const inScope: DatasetSnapshot[] = onDatasource.length
      ? onDatasource
      : datasets;
    const dialect = sqlDialectOf(inScope);
    const lines: string[] = [];
    let budget = FIXER_SCHEMA_CHARS;
    for (const dataset of inScope) {
      for (const key of dataset.tables) {
        const columns =
          dataset.entities?.find((e) => e.key === key)?.columns ?? [];
        const line = `${key}(${columns.map((c) => `${c.name} ${c.type}`).join(', ')})`;
        if (line.length > budget) return { dialect, schema: lines.join('\n') };
        budget -= line.length;
        lines.push(line);
      }
    }
    return { dialect, schema: lines.join('\n') };
  }

  /**
   * One fixer pass; returns undefined when it produced nothing usable. The
   * turn's stop aborts the model call.
   */
  private async repairSql(
    sql: string,
    error: string,
    context: { dialect: string; schema: string },
    abortSignal?: AbortSignal,
  ): Promise<string | undefined> {
    try {
      const result = await this.deps.mastra
        .getAgent('sql-fixer')
        .generate(
          [
            `Dialect: ${context.dialect}`,
            '',
            '<available-entities>',
            context.schema || '(no schema snapshot stored for this session)',
            '</available-entities>',
            '',
            '<failed-sql>',
            sql,
            '</failed-sql>',
            '',
            '<error>',
            error,
            '</error>',
          ].join('\n'),
          {
            maxSteps: 1,
            toolChoice: 'none',
            // A syntax/column fix does not benefit from hidden reasoning tokens.
            providerOptions: await turnProviderOptions({
              reasoningEffort: 'low',
            }),
            structuredOutput: {
              schema: sqlFixOutputSchema,
              jsonPromptInjection: 'inline',
            },
            ...(abortSignal ? { abortSignal } : {}),
          },
        );
      const parsed = sqlFixOutputSchema.safeParse(
        result.object ?? parseJsonObject(result.text),
      );
      // The connector rejects anything but a read-only statement anyway — keep
      // the original error instead of burning another round-trip on it.
      return parsed.success ? readOnlyStatement(parsed.data.sql) : undefined;
    } catch (err) {
      this.deps.logger.warn(
        `SQL repair attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Does this turn's final statement reproduce a query the user already
   * approved? Drives the "Verified" badge — a library miss is not an error,
   * so a failing lookup just leaves the answer unbadged.
   */
  async matchesVerifiedQuery(
    session: SessionDoc,
    data: ToolDataRecord[],
  ): Promise<boolean> {
    const sql = lastSuccessfulSql(data);
    if (!sql) return false;
    try {
      return await this.deps.verifiedQueries.isVerifiedSql(
        sql,
        await this.deps.datasets.soleDatasourceId(session),
      );
    } catch (error) {
      this.deps.logger.warn(
        `Verified query lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

/**
 * Narrow, deliberately conservative match for transport/auth failures — the
 * statement never reached the engine at all, so no rewrite touches these.
 * Kept to specific markers (HTTP status wording, known Node connection error
 * codes, timeouts) rather than bare numbers, so it doesn't accidentally
 * swallow a genuine engine error that happens to mention a number.
 */
const TRANSPORT_OR_AUTH_ERROR =
  /\bstatus code\b|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|\bsocket hang up\b|\btimed? ?out\b|\bconnection (?:refused|reset|closed)\b/i;

/**
 * Whether a failed statement is worth another `sql-fixer` round trip.
 * Repairable = the engine parsed and rejected the statement, so a rewrite
 * can plausibly fix it. Not repairable: `assertReadOnlySql`'s
 * `BadRequestException` (the statement never reached the engine — a rewrite
 * doesn't change whether it's forbidden/malformed) or a transport/auth
 * failure (HTTP status, connection, timeout). Anything unrecognised defaults
 * to repairable: that matches today's behaviour (every error goes to the
 * fixer), so an under-matched transport message costs one attempt at worst,
 * while an over-matched one would silently skip a genuinely fixable error.
 */
function isRepairableSqlError(error: unknown): boolean {
  if (error instanceof BadRequestException) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !TRANSPORT_OR_AUTH_ERROR.test(message);
}

/**
 * Strip fences/semicolons off a model-authored statement and keep it only if
 * it is a read-only query.
 */
function readOnlyStatement(sql: string): string | undefined {
  const cleaned = sql
    .trim()
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/;+\s*$/, '')
    .trim();
  return /^(select|with)\b/i.test(cleaned) ? cleaned : undefined;
}

/** Parse a model's JSON reply, tolerating a markdown fence around it. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}
