/**
 * The earlier-queries block and the system blocks Michael's analysis streams
 * with (agents.md 5.23). Plain strings and pure functions, no framework
 * import, so Jest and the catalogue read them without Mastra.
 */
import type { z } from 'zod';
import type {
  analyseQuerySchema,
  validationFindingSchema,
} from './analysis.schemas';
import { flaggedQueries } from './analysis.steps';
import { coverageOf } from '../../modules/sessions/query-evidence/query-coverage';

type AnalyseQuery = z.output<typeof analyseQuerySchema>;
type Finding = z.output<typeof validationFindingSchema>;

/** The earlier-queries block's first line (agents.md 5.11). */
export const EARLIER_BLOCK_HEADER =
  'Queries an earlier attempt of this analysis already ran (reuse their results; do not run them again):';

/** The longest earlier-queries block, in characters. */
export const EARLIER_BLOCK_CAP = 8_000;

/** The result rows of each earlier query the block shows. */
export const EARLIER_ROWS_SHOWN = 5;

/** Room kept at the block's end for the line saying what was left out. */
const EARLIER_NOTE_ROOM = 60;

/** One earlier query as one line: number, rationale, SQL, coverage, rows. */
function earlierQueryLine(
  query: AnalyseQuery,
  index: number,
  flag: string | undefined,
): string {
  const facts = query.error
    ? [`failed: ${query.error}`]
    : [
        `coverage: ${coverageOf({ tool: 'run_readonly_sql', sql: query.sql, rowCount: query.rowCount, truncated: query.truncated })}`,
        `${query.rowCount} rows${query.truncated ? ' (cut at its row limit)' : ''}`,
        `first rows: ${JSON.stringify(query.rows.slice(0, EARLIER_ROWS_SHOWN))}`,
      ];
  return [
    `${index + 1}. ${flag ? `[flagged: ${flag}] ` : ''}${query.rationale ?? '(no rationale given)'}`,
    `SQL: ${query.sql.replace(/\s+/g, ' ').trim()}`,
    ...facts,
  ]
    .join(' | ')
    .replace(/\n/g, ' ');
}

/**
 * The earlier-queries block (agents.md 5.11): on a retry, and on an attempt
 * resumed after the agent's clarifying question, the queries the attempt
 * before ran, one line each under their own number, those a failed check
 * flagged (`flaggedQueries`) first; at most `EARLIER_BLOCK_CAP` characters,
 * a last line saying how many were left out. `''` with no query. A resumed
 * retry passes the queries it ran before it asked as `resumed`: they follow
 * the earlier attempt's under the same header, numbering and cap, and no
 * check of the earlier attempt flags them.
 */
export function earlierQueriesBlock(
  earlier: readonly AnalyseQuery[],
  findings: readonly Finding[],
  resumed: readonly AnalyseQuery[] = [],
): string {
  const queries = [...earlier, ...resumed];
  if (!queries.length) return '';
  const flags = [
    ...flaggedQueries(earlier, findings),
    ...resumed.map(() => undefined),
  ];
  const order = queries
    .map((_query, index) => index)
    .sort((a, b) => Number(!flags[a]) - Number(!flags[b]) || a - b);
  const lines = [EARLIER_BLOCK_HEADER];
  let used = EARLIER_BLOCK_HEADER.length;
  for (const [position, index] of order.entries()) {
    const line = earlierQueryLine(queries[index], index, flags[index]);
    const room = EARLIER_BLOCK_CAP - used - 1 - EARLIER_NOTE_ROOM;
    if (line.length <= room) {
      lines.push(line);
      used += line.length + 1;
      continue;
    }
    const cut = room > 1;
    if (cut) lines.push(`${line.slice(0, room - 1)}…`);
    const left = order.length - position - (cut ? 1 : 0);
    if (left > 0) {
      lines.push(
        `(${left} more ${left === 1 ? 'query' : 'queries'} not listed to fit.)`,
      );
    }
    break;
  }
  return lines.join('\n');
}

/**
 * The system blocks the Analyse step adds after the agent's own context
 * (agents.md 5.11): the catalog block, the plan block, the earlier-queries
 * block only on a retry or a resumed attempt that has one.
 */
export function analyseSystemBlocks(input: {
  catalogBlock: string;
  planBlock: string;
  earlierBlock?: string;
}): string[] {
  return [
    input.catalogBlock,
    input.planBlock,
    ...(input.earlierBlock ? [input.earlierBlock] : []),
  ];
}

/** The most queries Michael's review lists. */
const REVIEW_QUERIES_SHOWN = 12;

/**
 * Michael's analysis as Avery reads it (agents.md 5.23): each query he ran,
 * why and what came back, then his own note.
 */
export function analysisReview(outcome: {
  queries: readonly AnalyseQuery[];
  text: string;
}): string {
  const lines = outcome.queries
    .slice(0, REVIEW_QUERIES_SHOWN)
    .map((query, index) => {
      const facts = query.error
        ? `failed: ${query.error}`
        : `${query.rowCount.toLocaleString('en-US')} rows${query.truncated ? ', cut at its row limit' : ''}`;
      return `${index + 1}. ${query.rationale ?? 'A query'} (${facts})`;
    });
  const more = outcome.queries.length - REVIEW_QUERIES_SHOWN;
  return [
    `**Queries run:** ${outcome.queries.length}`,
    ...lines,
    ...(more > 0 ? [`…and ${more} more.`] : []),
    ...(outcome.text.trim() ? ['', '**His note**', outcome.text.trim()] : []),
  ].join('\n');
}
