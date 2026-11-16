/**
 * Assess Data Readiness's Rows behind findings step (roadmap 1.28.11;
 * agents.md 5.13; data-readiness R34): the rows behind each of a report's
 * top findings, one guarded read-only query each, handed to the turn as a
 * `run_readonly_sql` source with its query facts. A query that fails is a
 * failed source, never a failed run.
 */
import type { SqlRunResult } from '../../mastra/tool-services';
import {
  findingRowsQuery,
  type FindingRowsQuery,
} from '../data-readiness/finding-rows-sql';
import type { ReadinessReport } from '../data-readiness/engine/types';
import type { QueryFacts } from './query-evidence/query-evidence.types';
import { topFindings } from './readiness-bridge';
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
 * Run the statements one after another on the report's datasource, at the
 * stored-row cap, and hand each result (or its error) to `record` with the
 * facts the inspector reads. Stops before the next query once `signal` is
 * aborted.
 */
export async function recordFindingSources(input: {
  report: Pick<ReadinessReport, 'findings' | 'datasourceKind' | 'datasourceId'>;
  run: (
    datasourceId: string,
    sql: string,
    limit: number,
  ) => Promise<SqlRunResult>;
  signal: AbortSignal;
  record: (
    args: { sql: string; rationale: string },
    result: unknown,
    facts: QueryFacts,
  ) => void;
}): Promise<FindingSourcesOutcome> {
  const { datasourceId } = input.report;
  const queries = findingRowsQueries(input.report);
  let sourceCount = 0;
  let failedSourceCount = 0;
  for (const query of queries) {
    if (input.signal.aborted) break;
    const args = { sql: query.sql, rationale: query.rationale };
    const facts: QueryFacts = { datasourceId, rowLimit: STORED_ROWS_CAP };
    let result: unknown;
    try {
      const { totalRows, ...rest } = await input.run(
        datasourceId,
        query.sql,
        STORED_ROWS_CAP,
      );
      if (typeof totalRows === 'number') facts.totalRows = totalRows;
      result = rest;
    } catch (error) {
      if (input.signal.aborted) break;
      failedSourceCount += 1;
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    sourceCount += 1;
    input.record(args, result, facts);
  }
  return {
    sourceCount,
    failedSourceCount,
    stopped: input.signal.aborted,
  };
}
