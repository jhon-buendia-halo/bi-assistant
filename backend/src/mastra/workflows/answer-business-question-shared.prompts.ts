/**
 * The request text and system blocks of the shared-context experiment of
 * `answer-business-question` (approach B, ./run-context.ts): Plan, Analyse
 * and Write answer get a short index of the run's board instead of its large
 * context (each entity's columns, Read images' notes, the queries' rows) and
 * read what they need with `list_run_context` / `read_run_context`.
 *
 * The agents' instructions do not change: every shared-mode line is here, in
 * the request or the system blocks. Plain strings and pure functions, no
 * framework import, so Jest reads them without Mastra.
 */
import {
  ANALYSE_VISUAL_LINE,
  ANSWER_REQUEST_CAP,
  ANSWER_ROWS_CAP,
  findingStatus,
  planMessages,
  planRequest,
  WRITE_ANSWER_VISUAL_LINE,
  type PlanMessage,
} from './answer-business-question.prompts';
import {
  catalogBlock,
  type AnalyseQuery,
  type AnalysisPlan,
  type AnsweredClarification,
  type CatalogEntity,
  type ValidationFinding,
} from './answer-business-question.steps';
import {
  RUN_CONTEXT_KEYS,
  runContextIndexBlock,
  type RunContextBoard,
} from './run-context';

/**
 * The tool-loop budget of Plan and Write answer in shared mode: room for
 * one read per entity or query (or a few parallel reads) and the final JSON.
 */
export const SHARED_CONTEXT_MAX_STEPS = 8;

/** The board prefixes each step's index lists. */
const PLAN_PREFIXES = ['catalog/', RUN_CONTEXT_KEYS.imageNotes];
const ANALYSE_PREFIXES = [
  'catalog/',
  RUN_CONTEXT_KEYS.imageNotes,
  RUN_CONTEXT_KEYS.earlierQueries,
];
const WRITE_ANSWER_PREFIXES = ['queries/', RUN_CONTEXT_KEYS.imageNotes];

/** A shared tools line: the tools, what to read first, the reply. */
function toolsLine(have: string, where: string, first: string, json: boolean) {
  return [
    `In this run you ${have} two read tools for the run context listed above: list_run_context and read_run_context.`,
    `This run's details are there, not in ${where}.`,
    `Read ${first} before you rely on them, and read only the entries you need; you may call several reads in one step.`,
    ...(json
      ? ['Your final reply is still the one JSON object you are asked for.']
      : []),
  ].join(' ');
}

/** The tools line of Plan's shared request. */
export const SHARED_CONTEXT_TOOLS_LINE = toolsLine(
  'do have',
  'this message',
  "an entity's columns (catalog/<entity>)",
  true,
);

/** The tools line of Write answer's shared request: the queries' rows. */
export const SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE = toolsLine(
  'do have',
  'this message',
  "a query's rows (queries/<n>)",
  true,
);

/** The tools line of Analyse's shared system blocks (no JSON reply). */
export const SHARED_CONTEXT_ANALYSE_TOOLS_LINE = toolsLine(
  'also have',
  'these messages',
  "an entity's columns (catalog/<entity>)",
  false,
);

/** Analyse's line pointing at the earlier attempt's queries on a retry. */
export const SHARED_CONTEXT_EARLIER_LINE = `An earlier attempt of this analysis already ran queries: read the entry ${RUN_CONTEXT_KEYS.earlierQueries}, reuse their results and do not run them again.`;

/** The query index's first line in Write answer's shared request. */
export const SHARED_QUERY_INDEX_HEADER =
  "Queries (each one's rows are in its run context entry queries/<n>; read the ones the answer needs):";

/**
 * The catalog as the shared Plan request carries it: the entities without
 * their columns, then the board index of their columns and image notes.
 */
export function sharedCatalogIndexBlock(
  catalog: readonly CatalogEntity[],
  board: RunContextBoard,
): string {
  return [
    catalogBlock(catalog),
    '',
    runContextIndexBlock(board, PLAN_PREFIXES),
  ].join('\n');
}

/** What follows the question in Plan's shared request. */
function sharedPlanContext(
  catalog: readonly CatalogEntity[],
  board: RunContextBoard,
): string {
  return [
    sharedCatalogIndexBlock(catalog, board),
    '',
    SHARED_CONTEXT_TOOLS_LINE,
  ].join('\n');
}

/**
 * Plan's shared request: `planRequest` with the index block in place of the
 * catalog with columns, no inline image notes (they are an index entry),
 * then the tools line.
 */
export function sharedPlanRequest(
  question: string,
  catalog: readonly CatalogEntity[],
  board: RunContextBoard,
): string {
  return planRequest(question, sharedPlanContext(catalog, board));
}

/**
 * Plan's shared messages, as `planMessages` builds them (the conversation
 * before the question, the clarification answered), each request being
 * `sharedPlanRequest`.
 */
export function sharedPlanMessages(input: {
  messages: unknown;
  question: string;
  catalog: readonly CatalogEntity[];
  board: RunContextBoard;
  answered?: AnsweredClarification;
}): { messages: string | PlanMessage[]; fallback: string } {
  return planMessages({
    messages: input.messages,
    question: input.question,
    catalogBlock: sharedPlanContext(input.catalog, input.board),
    ...(input.answered ? { answered: input.answered } : {}),
  });
}

/**
 * The system blocks Analyse adds in shared mode: the catalog with the board
 * index, the plan block, on a retry the line pointing at the earlier
 * queries' entry, the tools line, and last the visual line when one follows.
 */
export function sharedAnalyseSystemBlocks(input: {
  catalog: readonly CatalogEntity[];
  board: RunContextBoard;
  planBlock: string;
  hasEarlier?: boolean;
  /** Build visual runs after it and the request cues a visual. */
  visualFollows?: boolean;
}): string[] {
  return [
    [
      catalogBlock(input.catalog),
      '',
      runContextIndexBlock(input.board, ANALYSE_PREFIXES),
    ].join('\n'),
    input.planBlock,
    ...(input.hasEarlier ? [SHARED_CONTEXT_EARLIER_LINE] : []),
    SHARED_CONTEXT_ANALYSE_TOOLS_LINE,
    ...(input.visualFollows ? [ANALYSE_VISUAL_LINE] : []),
  ];
}

/**
 * One query of the shared query index: its number, rationale and outcome
 * (worded as Write answer's request words it, so the row-marker rule still
 * fires), its SQL and the columns of its first row; never its rows.
 */
function queryIndexLines(query: AnalyseQuery, index: number): string {
  const shown = Math.min(query.rows.length, ANSWER_ROWS_CAP);
  const facts = query.error
    ? `failed: ${query.error}`
    : `${query.rowCount} rows${shown < query.rowCount ? `, the first ${shown} shown` : ''}${query.truncated ? ', cut at its row limit' : ''}`;
  const first = query.rows[0];
  const columns = query.error
    ? []
    : [`Columns: ${first ? Object.keys(first).join(', ') : '(no rows)'}`];
  return [
    `${index + 1}. ${query.rationale ?? '(no rationale given)'} (${facts})`,
    `SQL: ${query.sql}`,
    ...columns,
  ].join('\n');
}

/**
 * Write answer's shared request: the question, the plan, the query index
 * (no rows), the findings as `writeAnswerRequest` writes them, the board
 * index of the queries and image notes, the tools line, and last the visual
 * line when one follows. The query index is cut to fit `ANSWER_REQUEST_CAP`.
 */
export function sharedWriteAnswerRequest(input: {
  question: string;
  plan: AnalysisPlan;
  queries: readonly AnalyseQuery[];
  findings: readonly ValidationFinding[];
  board: RunContextBoard;
  /** Build visual runs after it and the request cues a visual. */
  visualFollows?: boolean;
}): string {
  const head = [
    `Question: ${input.question}`,
    '',
    'Plan:',
    JSON.stringify(input.plan),
    '',
    SHARED_QUERY_INDEX_HEADER,
    '',
  ].join('\n');
  const tail = [
    '',
    '',
    'Validation findings:',
    ...(input.findings.length
      ? input.findings.map(
          (f) => `- ${findingStatus(f)}: ${f.check}. ${f.detail}`,
        )
      : ['- none']),
    '',
    runContextIndexBlock(input.board, WRITE_ANSWER_PREFIXES),
    '',
    SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE,
    ...(input.visualFollows ? ['', WRITE_ANSWER_VISUAL_LINE] : []),
  ].join('\n');
  const queries = input.queries.length
    ? input.queries.map(queryIndexLines).join('\n\n')
    : '(no query ran)';
  const room = Math.max(0, ANSWER_REQUEST_CAP - head.length - tail.length);
  const body =
    queries.length > room
      ? `${queries.slice(0, room)}\n[queries shortened to fit]`
      : queries;
  return `${head}${body}${tail}`;
}
