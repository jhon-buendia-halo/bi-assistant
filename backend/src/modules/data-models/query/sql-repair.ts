/**
 * Small, DI-free pieces of the execution-guided SQL repair loop (ADR-0007
 * §6), shared by `SessionsService` (`query_entities`/chat) and
 * `DataModelsController` (`POST /datasets/:name/model/query`, the API/CLI
 * path) so both run a failed statement past `sql-fixer` the same way rather
 * than one of them skipping repair entirely. Lives under `data-models/`
 * (not `sessions/`) because `SessionsModule` imports `DataModelsModule` —
 * never the other way around (see `data-models.module.ts`) — so anything
 * both call sites need has to sit on the `data-models` side of that edge.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DatasourceKind } from '../../datasources/entities/datasource.entity';
import type { SqlDialect } from './compile-sql';

/** `sql` bindings compile for the datasource's actual kind; `rest` always
 * compiles as sqlite, matching the materialise-to-SQLite path (ADR-0007 §4).
 * Was duplicated almost verbatim between `SessionsService.dialectForEntity`
 * and `DataModelsController.dialectFor` — both now call this for the
 * kind->dialect mapping and keep only their own async lookup/fallback. */
export function dialectForDatasourceKind(kind: DatasourceKind): SqlDialect {
  return kind === 'rest' ? 'sqlite' : kind;
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

/** A missing datasource — `DatasourcesService.get` throwing
 * `NotFoundException`, or the same wording surfacing as a plain message
 * after crossing an async boundary that lost the exception type. No SQL
 * rewrite makes a datasource exist, so this is never worth a fixer round
 * trip (unlike a genuine column/syntax mistake in the statement itself). */
const DATASOURCE_NOT_FOUND = /\bdatasource .*not found\b/i;

/**
 * Whether a failed statement is worth another `sql-fixer` round trip.
 * Repairable = the engine parsed and rejected the statement, so a rewrite
 * can plausibly fix it. Not repairable: `assertReadOnlySql`'s
 * `BadRequestException` (the statement never reached the engine — a rewrite
 * doesn't change whether it's forbidden/malformed), an unresolvable
 * datasource (`NotFoundException`/"Datasource … not found" — a rewrite
 * cannot conjure a datasource into existing), or a transport/auth failure
 * (HTTP status, connection, timeout). Anything unrecognised defaults to
 * repairable: that matches today's behaviour (every error goes to the
 * fixer), so an under-matched transport message costs one attempt at worst,
 * while an over-matched one would silently skip a genuinely fixable error.
 */
export function isRepairableSqlError(error: unknown): boolean {
  if (error instanceof BadRequestException) return false;
  if (error instanceof NotFoundException) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (DATASOURCE_NOT_FOUND.test(message)) return false;
  return !TRANSPORT_OR_AUTH_ERROR.test(message);
}

/**
 * Strip fences/semicolons off a model-authored statement and keep it only if
 * it is a read-only query. Shared by the fixer and the verifier.
 */
export function readOnlyStatement(sql: string): string | undefined {
  const cleaned = sql
    .trim()
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/;+\s*$/, '')
    .trim();
  return /^(select|with)\b/i.test(cleaned) ? cleaned : undefined;
}

/**
 * A `sql-fixer` pass, as a runtime bridge rather than a NestJS dependency:
 * `DataModelsController` (`POST /model/query`) needs one, but getting a real
 * agent only ever goes through `MastraService`, and `MastraModule` eagerly
 * loads `mastra/index.ts` — the full real agent registry, each a `new
 * Agent(...)` pulling in `@mastra/core/agent`'s ESM-only transitive deps
 * (`@sindresorhus/slugify`). `DataModelsModule` importing `MastraModule`
 * broke `data-models.e2e-spec.ts`'s focused (Mastra-free) module set the
 * same way; this bridge — installed by `SessionsService.onModuleInit`, the
 * only place with a real `MastraService` — keeps `DataModelsModule` free of
 * that import, same spirit as `tool-services.ts`'s `setDatasetToolServices`.
 */
export interface SqlFixerBridge {
  repair(
    sql: string,
    errorMessage: string,
    dialect: string,
    schema: string,
  ): Promise<string | undefined>;
}

let sqlFixerBridge: SqlFixerBridge | null = null;

export function setSqlFixerBridge(bridge: SqlFixerBridge): void {
  sqlFixerBridge = bridge;
}

/** Undefined when no bridge is installed (a process that never boots
 * `SessionsModule`, or hasn't finished `onModuleInit` yet) — callers degrade
 * to "no repair available" rather than throwing; repair is an enhancement
 * on top of a correct failure report, not a correctness requirement. */
export function getSqlFixerBridge(): SqlFixerBridge | undefined {
  return sqlFixerBridge ?? undefined;
}

export interface SqlRepairResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Present when the original statement failed and was auto-corrected. */
  correctedSql?: string;
}

/**
 * Runs `sql`, and on a repairable execution error hands it plus the engine
 * message to `deps.repair` for a rewrite, retrying up to `deps.attempts`
 * times (default 2). The last error propagates when repair is exhausted,
 * declined (not repairable), or produces nothing usable — callers report it
 * same as an unrepaired failure.
 */
export async function runSqlWithRepair(
  sql: string,
  deps: {
    runSql: (
      statement: string,
    ) => Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
    repair: (
      statement: string,
      errorMessage: string,
    ) => Promise<string | undefined>;
    isRepairable?: (error: unknown) => boolean;
    logWarn?: (message: string) => void;
    attempts?: number;
  },
): Promise<SqlRepairResult> {
  const attempts = deps.attempts ?? 2;
  const isRepairable = deps.isRepairable ?? isRepairableSqlError;
  let statement = sql;
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await deps.runSql(statement);
      const repaired = statement !== sql;
      return { ...result, ...(repaired ? { correctedSql: statement } : {}) };
    } catch (error) {
      if (attempt >= attempts || !isRepairable(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const corrected = await deps.repair(statement, message);
      if (!corrected || corrected === statement) throw error;
      deps.logWarn?.(
        `Repairing failed SQL (attempt ${attempt + 1}): ${message}`,
      );
      statement = corrected;
    }
  }
}
