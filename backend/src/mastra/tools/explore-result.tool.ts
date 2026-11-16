import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  FILTER_OPS,
  FILTERS_MAX,
  FILTER_VALUES_MAX,
  PAGE_SIZE_MAX,
  SORT_KEYS_MAX,
  type PageRequest,
  type PageResult,
  type ResultView,
} from '../../modules/datasources/connectors/paged-sql.types';
import {
  EXPLORABLE_QUERIES_CONTEXT_KEY,
  explorerCandidateOfQuery,
  findExplorableQuery,
  unknownQueryError,
  type ExplorableQuery,
} from '../../modules/sessions/query-evidence/explorable-queries';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import {
  pageCountOf,
  understoodOf,
  type ExplorerSpec,
} from '../agents/result-explorer.prompts';
import { runErrorMessage } from '../workflows/workflow-run';
import {
  getDatasetToolServices,
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
} from '../tool-services';
import {
  DATASETS_CONTEXT_KEY,
  RATIONALE_DESCRIPTION,
} from './dataset-tool-context';

/** The page `explore_result` can ask for, at most (plan 0.4). */
export const EXPLORE_PAGE_MAX = 1000;

export const NEW_QUESTION_ERROR =
  'That asks a new question, not a filter on an earlier result; query the data instead.';
export const NO_QUERY_ERROR =
  'There is no earlier query result to explore yet; run run_readonly_sql first.';

const filterValue = z.union([z.string(), z.number(), z.boolean()]);

const inputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'The SQL exactly as an earlier run_readonly_sql call ran it; omit it for the latest query',
    ),
  filterText: z
    .string()
    .max(500)
    .optional()
    .describe(
      'The user\'s own words about the rows they want ("only Brazil", "newest first", "next page")',
    ),
  filters: z
    .array(
      z.object({
        column: z.string(),
        op: z.enum(FILTER_OPS),
        value: filterValue.optional(),
        valueTo: filterValue.optional().describe('The upper bound of between'),
        values: z
          .array(filterValue)
          .max(FILTER_VALUES_MAX)
          .optional()
          .describe('in and not_in'),
      }),
    )
    .max(FILTERS_MAX)
    .optional()
    .describe('The complete filter set, AND-ed; [] clears the filters'),
  sort: z
    .array(z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }))
    .max(SORT_KEYS_MAX)
    .optional()
    .describe('Sort keys; [] is the default order'),
  page: z.number().int().min(1).max(EXPLORE_PAGE_MAX).optional(),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE_MAX)
    .optional()
    .describe('Rows a page (default 50)'),
  rationale: z.string().describe(RATIONALE_DESCRIPTION),
});

type ExploreInput = z.infer<typeof inputSchema>;

/** What the tool returns; the model sees it without `sourceSql`, `datasourceId` and `view`. */
export interface ExploreResultOutput {
  sourceSql: string;
  datasourceId: string;
  view: ResultView;
  columns: string[];
  rows: Record<string, unknown>[];
  page: number;
  pageCount: number;
  matchedRows: number;
  capped: boolean;
  understood: string;
}

type RequestContextLike = { get: (key: string) => unknown };

function explorableQueries(
  requestContext: RequestContextLike,
): ExplorableQuery[] {
  const value = requestContext.get(EXPLORABLE_QUERIES_CONTEXT_KEY);
  return Array.isArray(value) ? (value as ExplorableQuery[]) : [];
}

function datasetNames(requestContext: RequestContextLike): string[] {
  const value = requestContext.get(DATASETS_CONTEXT_KEY);
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** The query's current view as a request: where "next page" starts. */
function requestOfView(view: ResultView | undefined): PageRequest {
  if (!view) return {};
  return {
    filters: view.filters,
    sort: view.sort,
    page: view.page,
    pageSize: view.pageSize,
  };
}

/**
 * The explicit fields over the base request: filters and sort replace
 * theirs, and a new filter or order starts from page 1 unless a page is
 * given.
 */
function withExplicit(base: PageRequest, input: ExploreInput): PageRequest {
  const request: PageRequest = { ...base };
  if (input.filters !== undefined) request.filters = input.filters;
  if (input.sort !== undefined) request.sort = input.sort;
  if (input.page !== undefined) request.page = input.page;
  else if (input.filters !== undefined || input.sort !== undefined) {
    request.page = 1;
  }
  if (input.pageSize !== undefined) request.pageSize = input.pageSize;
  return request;
}

/** What the model reads: the page, without the source SQL, datasource or view. */
export function exploreModelOutput(result: unknown): unknown {
  if (!result || typeof result !== 'object' || 'error' in result) return result;
  const shown = { ...(result as Record<string, unknown>) };
  delete shown['sourceSql'];
  delete shown['datasourceId'];
  delete shown['view'];
  return shown;
}

/**
 * `explore_result` (agents.md 3.15; plan docs/plans/m1-27-result-explorer.md
 * 0.4): another page, a filter or an order over the full result of a query
 * an earlier call ran, read through the query inspector's page path. The
 * user's words go to `result-explorer`; explicit fields override what it
 * read. The full result is captured as a record of the source query, its
 * view written beside it as facts.
 */
export const exploreResultTool = createTool({
  id: 'explore_result',
  description: [
    'Page, filter or re-sort the full result of a query an earlier run_readonly_sql call already ran, when the user asks for more rows, another page, only some rows or another order of a result already shown; never for a new measure, grouping, join or table (use run_readonly_sql).',
    "Pass the user's words as filterText; filters, sort, page and pageSize, when given, override what they are read as.",
    'query is the SQL exactly as that call ran it; omit it for the latest query.',
    "Omitted filters and sort keep the query's current view; a page is at most 100 rows.",
  ].join(' '),
  inputSchema,
  toModelOutput: (output: unknown) => ({
    type: 'json' as const,
    value: exploreModelOutput(output),
  }),
  execute: async (input, context) => {
    const { requestContext } = context;
    const queries = explorableQueries(requestContext);
    if (!queries.length) return { error: NO_QUERY_ERROR };
    const named = input.query?.trim();
    let target = named
      ? findExplorableQuery(queries, named)
      : queries[queries.length - 1];
    if (!target) return { error: unknownQueryError(queries) };
    const services = getDatasetToolServices();
    if (!services.pageQuery) {
      return { error: 'Exploring an earlier result is not available here' };
    }

    let base = requestOfView(target.view);
    let understood: string | undefined;
    const words = input.filterText?.trim();
    if (words) {
      if (!services.interpretResult) {
        return { error: 'Reading a filter in words is not available here' };
      }
      let spec: ExplorerSpec;
      try {
        spec = await services.interpretResult({
          text: words,
          candidates: queries.map(explorerCandidateOfQuery),
          view: target.view ?? null,
          pageCount: pageCountOf(target.view ?? null),
        });
      } catch (error) {
        return {
          error: `The filter could not be understood: ${runErrorMessage(error)}`,
        };
      }
      if (spec.action === 'new-question') return { error: NEW_QUESTION_ERROR };
      // A named query stays the one explored; otherwise the model's pick.
      if (!named) target = queries[spec.query] ?? target;
      base = spec.interpretation.request;
      understood = spec.interpretation.understood;
    }
    const request = withExplicit(base, input);
    // Explicit filters or sort change what is shown: say it in words again.
    if (
      understood === undefined ||
      input.filters !== undefined ||
      input.sort !== undefined
    ) {
      understood = understoodOf(request);
    }

    let page: PageResult & { datasourceId: string };
    try {
      page = await services.pageQuery(
        {
          sql: target.sql,
          ...(target.datasourceId ? { datasourceId: target.datasourceId } : {}),
          columns: target.columns,
          kinds: target.kinds,
        },
        datasetNames(requestContext),
        request,
      );
    } catch (error) {
      return { error: runErrorMessage(error) };
    }

    // What the inspector needs beside the result, never in it.
    const facts = requestContext.get(QUERY_FACTS_CONTEXT_KEY);
    if (facts instanceof Map) {
      const known: QueryFacts = {
        datasourceId: page.datasourceId,
        totalRows: page.matchedRows,
        rowLimit: page.pageSize,
        view: page.view,
      };
      const callId = (context as { agent?: { toolCallId?: string } }).agent
        ?.toolCallId;
      if (callId) facts.set(callId, known);
      facts.set(queryFactsKey('explore_result', target.sql), known);
    }
    const output: ExploreResultOutput = {
      sourceSql: target.sql,
      datasourceId: page.datasourceId,
      view: page.view,
      columns: page.columns,
      rows: page.rows,
      page: page.page,
      pageCount: page.pageCount,
      matchedRows: page.matchedRows,
      capped: page.capped,
      understood,
    };
    return output;
  },
});
