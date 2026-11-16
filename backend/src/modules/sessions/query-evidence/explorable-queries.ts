/**
 * The queries a chat turn may explore with `explore_result` (roadmap 1.27.7,
 * agents.md 3.15, plan docs/plans/m1-27-result-explorer.md 0.4 and 2): the
 * run's or session's earlier queries, then the turn's own. Each one keeps
 * its SQL, its columns with their kinds and a few stored values, never whole
 * rows. Pure (no Mastra import, no query, no store): the turn engine, the
 * workflow runs and the tool share it, and 1.27.8's follow-up branch reuses
 * it.
 */
import {
  explorerCandidateOf,
  type ExplorerCandidate,
} from '../../../mastra/agents/result-explorer.prompts';
import type {
  ColumnKind,
  FilterValue,
  ResultView,
} from '../../datasources/connectors/paged-sql.types';
import type { ChatMessage, ToolDataRecord } from '../entities/session.entity';
import type { QueryEvidence } from './query-evidence.types';
import { columnKindsOf } from './result-view';

/**
 * requestContext key of the turn's explorable queries (agents.md 4.2): an
 * `ExplorableQuery[]` the turn engine creates per turn, its context queries
 * first, and appends each successful `run_readonly_sql` or `explore_result`
 * call to as it is captured.
 */
export const EXPLORABLE_QUERIES_CONTEXT_KEY = 'explorable-queries';

/** The tools whose successful records can be explored. */
export const EXPLORABLE_TOOLS: ReadonlySet<string> = new Set([
  'run_readonly_sql',
  'explore_result',
]);

/** The most earlier queries a turn is handed: the latest ones. */
export const CONTEXT_QUERIES_MAX = 10;

/** One earlier query, as `explore_result` and `result-explorer` read it. */
export interface ExplorableQuery {
  /** `Q1`, `Q2`, … in the order the queries ran. */
  ref: string;
  /** The statement as it ran (the corrected one, for a repaired query). */
  sql: string;
  /** The datasource it ran on, when known. */
  datasourceId?: string;
  /** Its result's columns; empty when only the SQL is known. */
  columns: string[];
  /** Each column's kind, read from every stored row. */
  kinds: Record<string, ColumnKind>;
  /** At most 5 distinct stored values per column (`result-explorer`'s sample). */
  sampleValues: Record<string, FilterValue[]>;
  rationale?: string;
  /** An `explore_result` record's view, so "next page" moves from it. */
  view?: ResultView;
}

/** A statement compared as text: whitespace collapsed, no trailing `;`. */
export function sqlKey(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:\s*;)+$/, '')
    .trim();
}

/**
 * One explorable query from a stored record, or null when the record is not
 * a successful `run_readonly_sql` or `explore_result` call with SQL.
 */
export function explorableQueryOf(
  record: ToolDataRecord,
  ref: string,
  known: { datasourceId?: string; view?: ResultView } = {},
): ExplorableQuery | null {
  if (!EXPLORABLE_TOOLS.has(record.tool) || record.error) return null;
  const sql = record.input?.trim();
  if (!sql) return null;
  const rows = record.rows ?? [];
  const columns = record.columns?.length
    ? record.columns
    : Object.keys(rows[0] ?? {});
  const kinds = columnKindsOf(columns, rows);
  const candidate = explorerCandidateOf(ref, columns, rows, kinds);
  const rationale = record.rationale?.trim();
  return {
    ref,
    sql: record.input as string,
    ...(known.datasourceId ? { datasourceId: known.datasourceId } : {}),
    columns,
    kinds,
    sampleValues: Object.fromEntries(
      candidate.columns.map((column) => [column.name, column.values]),
    ),
    ...(rationale ? { rationale } : {}),
    ...(record.tool === 'explore_result' && known.view
      ? { view: known.view }
      : {}),
  };
}

/** The queries numbered again, `Q1` first. */
export function withRefs(
  queries: readonly ExplorableQuery[],
): ExplorableQuery[] {
  return queries.map((query, i) => ({ ...query, ref: `Q${i + 1}` }));
}

/**
 * An answer's explorable queries, in `data` order, numbered from `Q1`: its
 * successful SQL and explore records, with the datasource and view of
 * their evidence.
 */
export function explorableQueriesOf(
  data: readonly ToolDataRecord[],
  evidence: readonly QueryEvidence[] = [],
): ExplorableQuery[] {
  const queries: ExplorableQuery[] = [];
  data.forEach((record, index) => {
    const entry = evidence.find((e) => e.index === index);
    const query = explorableQueryOf(record, `Q${queries.length + 1}`, {
      datasourceId: entry?.datasourceId,
      view: entry?.view,
    });
    if (query) queries.push(query);
  });
  return queries;
}

/**
 * What a turn starts from: the host's context queries (an earlier run's
 * answer, a node chat's run), then the session's earlier answers' queries;
 * the latest `CONTEXT_QUERIES_MAX`, numbered from `Q1`.
 */
export function sessionExplorableQueries(
  contextQueries: readonly ExplorableQuery[] | undefined,
  messages: readonly ChatMessage[],
): ExplorableQuery[] {
  const all = [...(contextQueries ?? [])];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.data?.length) continue;
    all.push(...explorableQueriesOf(message.data, message.evidence));
  }
  return withRefs(all.slice(-CONTEXT_QUERIES_MAX));
}

/**
 * The query a call names: by its ref (`Q2`) or by its SQL compared with
 * `sqlKey`; the latest of identical statements. Undefined when none.
 */
export function findExplorableQuery(
  queries: readonly ExplorableQuery[],
  query: string,
): ExplorableQuery | undefined {
  const named = query.trim();
  const byRef = /^q\d+$/i.test(named)
    ? queries.find((q) => q.ref.toLowerCase() === named.toLowerCase())
    : undefined;
  if (byRef) return byRef;
  const key = sqlKey(named);
  return [...queries].reverse().find((q) => sqlKey(q.sql) === key);
}

/** The refusal of a query no earlier call ran, listing those that ran. */
export function unknownQueryError(queries: readonly ExplorableQuery[]): string {
  const listed = queries
    .map((q) => `${q.ref} ${sqlKey(q.sql).slice(0, 80)}`)
    .join('; ');
  return `Unknown query. Earlier queries: ${listed}`;
}

/** A query as `result-explorer` reads it: columns, kinds and values, no SQL. */
export function explorerCandidateOfQuery(
  query: ExplorableQuery,
): ExplorerCandidate {
  return {
    ref: query.ref,
    ...(query.rationale ? { rationale: query.rationale } : {}),
    columns: query.columns.map((name) => ({
      name,
      kind: query.kinds[name] ?? 'unknown',
      values: query.sampleValues[name] ?? [],
    })),
    view: query.view ?? null,
  };
}
