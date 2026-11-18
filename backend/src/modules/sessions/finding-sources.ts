/**
 * Assess Data Readiness's Rows behind findings step (roadmap 1.28.11;
 * agents.md 5.13; data-readiness R34): the rows behind each of a report's
 * top findings, one guarded read-only query each, run four at a time and
 * handed to the turn, in finding order, as a `run_readonly_sql` source with
 * its query facts. A query that fails is a failed source, never a failed run.
 */
import type { SqlRunResult } from '../../mastra/tool-services';
import {
  findingRowsQuery,
  type FindingRowsQuery,
} from '../data-readiness/finding-rows-sql';
import type { ReadinessReport } from '../data-readiness/engine/types';
import type { QueryFacts } from './query-evidence/query-evidence.types';
import { topFindings } from './readiness-bridge';
import { runOrderedBatch } from './sql-batch';
import { STORED_ROWS_CAP } from './turn-data';

/** What the step reports: its sources, the failed ones, and a stop. */
export interface FindingSourcesOutcome {
  sourceCount: number;
  failedSourceCount: number;
  stopped: boolean;
}

/** The statements of a report's top findings (at most 20, most severe first). */
export function findingRowsQueries(
  report: Pick<ReadinessReport, 'findings' | 'datasourceKind'>,
): FindingRowsQuery[] {
  return topFindings(report.findings)
    .map((finding) => findingRowsQuery(finding, report.datasourceKind))
    .filter((query): query is FindingRowsQuery => query !== undefined);
}

/**
 * Run the statements on the report's datasource at the stored-row cap,
 * `SQL_BATCH_CONCURRENCY` at a time, each with the run's `signal`, and hand
 * each result (or its error) to `record` with the facts the inspector reads,
 * in finding order. Once `signal` aborts no query starts and the ones
 * running are cancelled; a query cut short by the stop is not recorded.
 */
export async function recordFindingSources(input: {
  report: Pick<ReadinessReport, 'findings' | 'datasourceKind' | 'datasourceId'>;
  run: (
    datasourceId: string,
    sql: string,
    limit: number,
    options: { signal: AbortSignal },
  ) => Promise<SqlRunResult>;
  signal: AbortSignal;
  record: (
    args: { sql: string; rationale: string },
    result: unknown,
    facts: QueryFacts,
  ) => void;
}): Promise<FindingSourcesOutcome> {
  const { datasourceId } = input.report;
  let sourceCount = 0;
  let failedSourceCount = 0;
  const { stopped } = await runOrderedBatch({
    items: findingRowsQueries(input.report),
    signal: input.signal,
    start: (query, signal) =>
      input.run(datasourceId, query.sql, STORED_ROWS_CAP, { signal }),
    commit: (query, outcome) => {
      const args = { sql: query.sql, rationale: query.rationale };
      const facts: QueryFacts = { datasourceId, rowLimit: STORED_ROWS_CAP };
      let result: unknown;
      if (outcome.ok) {
        const { totalRows, ...rest } = outcome.value;
        if (typeof totalRows === 'number') facts.totalRows = totalRows;
        result = rest;
      } else {
        const { error } = outcome;
        failedSourceCount += 1;
        result = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      sourceCount += 1;
      input.record(args, result, facts);
    },
  });
  return { sourceCount, failedSourceCount, stopped };
}
