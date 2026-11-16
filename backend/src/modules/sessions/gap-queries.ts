/**
 * Consumption Gap Analysis's read-only queries (agents.md 5.20, ADR-0051):
 * the lineage checks of Infer lineage and the probes of Probe evidence, run
 * one after another and each handed to the turn as a `run_readonly_sql`
 * source with its query facts, as Rows behind findings does
 * (./finding-sources.ts). A query that fails is a result with its error,
 * never a failed run.
 */
import type { SqlRunResult } from '../../mastra/tool-services';
import type {
  GapQuery,
  GapQueryResult,
} from '../../mastra/workflows/consumption-gap-analysis.steps';
import type { QueryFacts } from './query-evidence/query-evidence.types';
import { STORED_ROWS_CAP } from './turn-data';

/**
 * Run the queries in order at the stored-row cap, hand each result (or its
 * error) to `record` with the facts the inspector reads, and return the
 * results by id. Stops before the next query once `signal` is aborted; a
 * query cut short by the stop is neither recorded nor returned.
 */
export async function runGapQueries(input: {
  queries: readonly GapQuery[];
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
}): Promise<{ results: GapQueryResult[]; stopped: boolean }> {
  const results: GapQueryResult[] = [];
  for (const query of input.queries) {
    if (input.signal.aborted) break;
    const args = { sql: query.sql, rationale: query.rationale };
    const facts: QueryFacts = {
      datasourceId: query.datasourceId,
      rowLimit: STORED_ROWS_CAP,
    };
    let result: unknown;
    try {
      const { totalRows, ...rest } = await input.run(
        query.datasourceId,
        query.sql,
        STORED_ROWS_CAP,
      );
      if (typeof totalRows === 'number') facts.totalRows = totalRows;
      result = rest;
      results.push({
        id: query.id,
        columns: rest.columns,
        rows: rest.rows,
        error: null,
      });
    } catch (error) {
      if (input.signal.aborted) break;
      const message = error instanceof Error ? error.message : String(error);
      result = { error: message };
      results.push({ id: query.id, columns: [], rows: [], error: message });
    }
    input.record(args, result, facts);
  }
  return { results, stopped: input.signal.aborted };
}
