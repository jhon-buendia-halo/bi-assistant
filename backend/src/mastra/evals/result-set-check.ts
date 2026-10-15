// Result-set comparison scoring for eval cases that carry `expectedSql`.
//
// Deliberately isolated from `assistant.agent.ts`/`@mastra/core/agent`: this
// module is imported by `assistant.evals.ts` (which does pull those in), but
// nothing here does, so a spec file can exercise this logic directly without
// the ESM-only transitive deps that break under CommonJS Jest (same reason
// `agent-constants.ts` and `context-blocks.ts` stay dependency-free). The one
// type it borrows from `assistant.evals.ts` (`ScoredCheckResult`) is imported
// with `import type`, which TypeScript erases entirely, so it adds no runtime
// edge back to that heavier module.
import { compareResults } from '../../modules/sessions/result-compare';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot } from '../tool-services';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { ScoredCheckResult } from './assistant.evals';
import { catalogOfEntities, referenceInCatalog } from './databricks-catalog';

export interface ResultSetCheckOptions {
  /** For questions about distinct facts, repeated identical facts are harmless. */
  distinctRows?: boolean;
}

type Row = Record<string, unknown>;

/** A candidate must contain every reference value, never just a subset. */
function containsReferenceRow(expected: Row, actual: Row): boolean {
  return (
    Object.keys(actual).length >= Object.keys(expected).length &&
    compareResults([expected], [actual], { widthTolerant: true }).match
  );
}

function compareEvidence(
  expected: Row[],
  actual: Row[],
  options: ResultSetCheckOptions,
): { match: boolean; reason: string } {
  if (options.distinctRows && expected.length && actual.length) {
    // Set equality at the reference's grain. Extra columns are context, but
    // every returned row must still describe one of the expected facts.
    const match =
      expected.every((row) =>
        actual.some((candidate) => containsReferenceRow(row, candidate)),
      ) &&
      actual.every((row) =>
        expected.some((reference) => containsReferenceRow(reference, row)),
      );
    return { match, reason: match ? '' : 'the distinct facts differ' };
  }
  if (
    expected.length &&
    actual.some(
      (row) => Object.keys(row).length < Object.keys(expected[0]).length,
    )
  ) {
    return {
      match: false,
      reason: 'the result omits required reference values',
    };
  }
  return compareResults(expected, actual, { widthTolerant: true });
}

/** Scorer id for the result-set check, shown in the report's checks table. */
export const RESULT_SET_CHECK_ID = 'result-set-match';

/**
 * Connectors clamp `runReadOnlySql` at 500 rows — comparing more than that is
 * moot.
 */
export const RESULT_SET_ROW_LIMIT = 500;

/** Runs one statement under a row limit; the caller picks the path. */
export type ReferenceSqlExecutor = (
  sql: string,
  limit: number,
) => Promise<{ rows: Row[]; truncated?: boolean }>;

/**
 * Run a case's reference query and return its rows. A reference that fills
 * the row limit is refused: its result may be clipped, so a comparison against
 * it could not tell a complete answer from a partial one.
 *
 * Shared by the result-set check (which runs it through the same
 * `DatasetToolServices` bridge `run_readonly_sql` uses) and by
 * `npm run eval:validate` (which runs it on the connector directly, so no
 * model can repair a broken reference).
 */
export async function runReferenceSql(
  sql: string,
  execute: ReferenceSqlExecutor,
): Promise<Row[]> {
  const result = await execute(sql, RESULT_SET_ROW_LIMIT);
  if (result.truncated || result.rows.length >= RESULT_SET_ROW_LIMIT) {
    throw new Error(
      'reference result is truncated; completeness cannot be verified',
    );
  }
  return result.rows;
}

/**
 * The last `run_readonly_sql` call that did not error. This may be a coverage
 * lookup or supporting detail rather than the answer. Read from the live
 * `turnRecords` an eval run captures via `onStepFinish`.
 */
export function lastSuccessfulSqlRecord(
  records: ToolDataRecord[],
): ToolDataRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.tool === 'run_readonly_sql' && !record.error && record.input) {
      return record;
    }
  }
  return undefined;
}

/**
 * Score one eval case's result set against its `expectedSql`, when it has
 * one. Runs `expectedSql` through the same `DatasetToolServices` bridge
 * `run_readonly_sql` itself uses, then compares against the agent's own
 * captured rows from every successful, complete SQL call. Supporting queries
 * can follow the answer query; their position must not erase valid evidence.
 * One complete result must match all reference facts (extra columns are fine).
 * Rows from different queries are never combined, nor are extra rows ignored.
 *
 * On a Databricks datasource the reference is a Databricks set's (the
 * preflight binds a Databricks set to a Databricks datasource and no other,
 * R184), so it runs in the catalog of the selected datasets' entities
 * rather than the canonical `evals` (R191); other references run as written.
 *
 * Returns `undefined` when the case has no `expectedSql` — callers should
 * skip adding a check in that case rather than reporting a vacuous pass.
 */
export async function runResultSetCheck(
  expectedSql: string | undefined,
  datasets: string[],
  datasetSnapshots: DatasetSnapshot[],
  turnRecords: ToolDataRecord[],
  options: ResultSetCheckOptions = {},
): Promise<ScoredCheckResult | undefined> {
  if (!expectedSql) return undefined;
  const description =
    'Result set matches expectedSql (primary correctness signal)';

  const record = lastSuccessfulSqlRecord(turnRecords);
  if (!record) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: 'the agent ran no successful run_readonly_sql to compare',
    };
  }

  const datasourceId = datasetSnapshots.find(
    (s) => s.datasourceId,
  )?.datasourceId;
  if (!datasourceId) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: 'could not resolve a datasource for the expectedSql comparison',
    };
  }

  try {
    const selected = datasetSnapshots.filter((snapshot) =>
      datasets.includes(snapshot.name),
    );
    const onDatabricks =
      selected.length > 0 &&
      selected.every((snapshot) => snapshot.datasourceKind === 'databricks');
    const reference = onDatabricks
      ? referenceInCatalog(
          expectedSql,
          catalogOfEntities(selected.flatMap((snapshot) => snapshot.tables)),
        )
      : expectedSql;
    const expectedRows = await runReferenceSql(reference, (sql, limit) =>
      getDatasetToolServices().runReadOnlySql(
        datasourceId,
        sql,
        limit,
        datasets,
      ),
    );
    const candidates = turnRecords.filter(
      (candidate) =>
        candidate.tool === 'run_readonly_sql' &&
        !candidate.error &&
        candidate.input,
    );
    let reason = '';
    for (const candidate of candidates) {
      // Rows clipped in storage (`rowCount` > rows kept) are not the rows
      // the assistant saw, so they cannot be compared. A result `truncated`
      // only because it reached the query's own row limit holds every row
      // the assistant saw: it is compared like any other, so it matches only
      // when it carries every reference fact and no other row (R31; the
      // baseline's `limit: 1` champion answer was a false negative).
      if (
        !Array.isArray(candidate.rows) ||
        (candidate.rowCount !== undefined &&
          candidate.rowCount !== candidate.rows.length)
      ) {
        reason = 'captured rows are missing or truncated';
        continue;
      }
      const comparison = compareEvidence(expectedRows, candidate.rows, options);
      if (comparison.match) {
        return {
          id: RESULT_SET_CHECK_ID,
          description,
          score: 1,
          passed: true,
        };
      }
      reason = candidate.truncated
        ? `the result reached its row limit (${candidate.rows.length} rows) and ${comparison.reason}`
        : comparison.reason;
    }
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `expectedSql returned ${expectedRows.length} row(s); none of ${candidates.length} successful SQL result(s) matched. The last SQL ("${record.input}") did not match — ${reason}`,
    };
  } catch (err) {
    return {
      id: RESULT_SET_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `expectedSql failed to run — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
