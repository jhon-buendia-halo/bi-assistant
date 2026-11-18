/**
 * The instructions and request text of the two model steps of Questions to
 * Insights v2 that run without tools (agents.md 5.11, Appendix F): Plan and
 * Write answer. Their first lines are fixed: the E2E stub model routes a
 * request by its system prompt's first line. Plain strings and pure
 * functions, no framework import, so Jest and the catalogue read them
 * without Mastra.
 */
import type { z } from 'zod';
import type {
  analyseQuerySchema,
  planSchema,
  validationFindingSchema,
} from './answer-business-question.schemas';
import { flaggedQueries } from './answer-business-question.steps';
import { coverageOf } from '../../modules/sessions/query-evidence/query-coverage';
import { imageNotesBlock } from './read-images.steps';

/** The Plan step's instructions' first line (the stub model routes by it). */
export const PLAN_FIRST_LINE =
  'You plan a data analysis for Questions to Insights.';

/** The Write answer step's instructions' first line. */
export const WRITE_ANSWER_FIRST_LINE =
  'You write the final answer for Questions to Insights.';

/** The Plan step's instructions (agents.md Appendix F). */
export const PLAN_INSTRUCTIONS = `${PLAN_FIRST_LINE}

You receive a business question, the conversation before it when there is one, and the catalog of the entities (tables) the analysis can read, with the columns of each (name and type). You have no tools, you run no query and you have not seen the data: you decide what the analysis must find, and whether the question can be analysed as asked.

Reply with one JSON object and nothing else:
- question: the question restated in one sentence, with the natural default for any fuzzy scope made explicit. When the question answers an earlier clarifying question, restate the original question with that answer.
- measures: the figures the answer needs, each a short noun phrase (for example "goals per player"), each one the listed columns can compute.
- entities: the catalog entities the analysis will likely read, by their catalog names.
- scope: the slice of the data the answer covers (periods, filters, groups), in one sentence.
- assumptions: each choice the analysis makes for something the question leaves open: a default scope, how a measure is defined, a filter. One sentence each; empty when there are none. Never a fact about the world or the domain (who hosted an event, what a rule says, what a dataset covers, what usually happens): you have not seen the data, and the analysis states only what its queries return.
- needsClarification: true only when the metric or meaning is undefined and the choice would change the analysis (for example "the best team" with no measure named). A fuzzy scope is not a reason: assume the natural default and list it under assumptions. Never true when the question answers an earlier clarifying question.
- clarification: when needsClarification is true, { "question": one short question, "options": 2-4 concrete options, each a short title optionally followed by " — " and one line explaining it }; otherwise null. Each option is a measure the listed columns can compute (say which in its explanation, in plain words); never offer a measure the columns cannot give, or one that mixes several measures into a score.

Never answer the question and never state a figure: the analysis step runs the queries.

A catalog entity whose name suggests a measure (a view such as customer_ltv or product_revenue) does not define what "best", "top", "most valuable" or "biggest" means: when the question names no measure, set needsClarification to true and offer that measure among the options.`;

/** The Write answer step's instructions (agents.md Appendix F). */
export const WRITE_ANSWER_INSTRUCTIONS = `${WRITE_ANSWER_FIRST_LINE}

You receive the user's question, the analysis plan, the SQL queries the analysis ran with their result rows, and the validation findings. You have no tools and you run nothing: every figure and fact you write comes from those result rows, never from general knowledge.

Reply with one JSON object and nothing else:
- headline: one line that answers the question with the key figure.
- answer: the whole answer in Markdown, starting with the headline line, then:
  - a compact Markdown table when the answer has three or more values;
  - "How I got this": 1-3 bullets in plain words for a business reader, no SQL;
  - "Assumptions": only the plan's assumptions that are choices the analysis made (a default scope, how a measure is defined, a filter) and that the answer rests on; leave out any that states a fact about the world or the domain; only when there are some;
  - "Caveats": only limits a query result or a validation finding shows (a result cut at its row limit, a failed check, data that does not cover part of the question); only when there are some.

Rules:
- Numbers: keep counts exact; round averages, ratios and other derived figures to at most 2 decimals, and percentages to at most 1 decimal (2.875 is 2.88, 3.000 is 3, 0.125 is 0.13, 25.00% is 25%); never add precision the data does not have.
- Ties: when values tie at a ranking's cut-off, name every tied entry and say they are tied.
- Coverage: when the data does not cover what the question asks, say so and state what the data does cover; never fill the gap from general knowledge.
- Nothing from general knowledge anywhere, assumptions and caveats included: no remark about what the domain usually is (how many matches a tournament normally has, how a rule usually counts), and nothing about values that did not appear in the results (do not say how own goals count when no own goal appears).
- No usable rows (every query failed, or none ran): say the analysis could not get the data and give no figure.
- Never dump a schema, a table list or SQL.
- Long lists: when a query's line says that only its first rows are shown (for example "102 rows, the first 50 shown") and the answer must list that result, write no table for it; put, alone on a line where the table goes, [[rows:<n>]] (n is the query's number in the request), optionally with the columns to show and their headers: [[rows:2 | name=Driver, total_race_starts=Race starts]]. The table of every row is put there for you. Never say that rows are missing or were cut because only some were shown to you.

Counts stay exact even when you describe a spread: never round a count into a range ("about 37,000 to 38,000"); give the exact smallest and largest counts the rows hold.`;

/**
 * The words in a question that ask for a visual, as whole words: the cue,
 * with reference image notes, for telling Analyse and Write answer that
 * Build visual draws one after them.
 */
const VISUAL_CUE =
  /\b(dashboards?|charts?|graphs?|plots?|maps?|heatmaps?|pivots?|visual\w*)\b/i;

/**
 * Whether the request cues a visual: the run has reference image notes
 * (not blank), or the question names a visual. Only a run that also builds
 * a visual tells its steps so; any other request keeps its prompts as they
 * are, so the agents' eval results stay valid for it.
 */
export function visualCued(question: string, imageNotes?: string): boolean {
  return Boolean(imageNotes?.trim()) || VISUAL_CUE.test(question);
}

/** Analyse's last system block when a visual follows its queries. */
export const ANALYSE_VISUAL_LINE =
  'A later step draws the visual from your query results, so never say you cannot render a chart, a dashboard or a map. Run one query per view the request asks for, each returning the rows that view shows: the headline totals as one single-row query, and one query for each table, chart or map. For a view that crosses two dimensions, return one row per combination with the measure in one column, never one column per value, so the visual labels its columns with the values in the data.';

/** The last line of Write answer's request when a visual follows it. */
export const WRITE_ANSWER_VISUAL_LINE =
  'An interactive visual of these results is built right after your answer and shown under it. Never say you cannot render a chart, a dashboard or a map, and do not lay the data out as tables to stand in for one: state the findings and point the reader to the visual.';

/** The most result rows of one query Write answer reads. */
export const ANSWER_ROWS_CAP = 50;

/** The longest request Write answer gets, in characters. */
export const ANSWER_REQUEST_CAP = 40_000;

type Plan = z.output<typeof planSchema>;
type AnalyseQuery = z.output<typeof analyseQuerySchema>;
type Finding = z.output<typeof validationFindingSchema>;

/**
 * The Plan step's request: the question and the catalog block with its
 * columns, then Read images' notes when the run has any (agents.md 5.11);
 * without them, the request is what it was before Read images existed.
 */
export function planRequest(
  question: string,
  catalogBlock: string,
  imageNotes?: string,
): string {
  const notes = imageNotesBlock(imageNotes);
  return [
    `Question: ${question}`,
    '',
    catalogBlock,
    ...(notes ? ['', notes] : []),
  ].join('\n');
}

/** A message of the Plan step's request. */
export interface PlanMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

/**
 * The Plan step's messages (agents.md 5.11): the conversation before the
 * question, then the question with the catalog (`planRequest`), so a pick
 * of a clarification is planned with its question. After Clarify
 * (`answered`), the question, the clarifying question Plan asked and the
 * user's answer with the catalog: Plan restates the question with the
 * answer. A bare question with no conversation is the request alone.
 * `fallback` is the question a reply with no restatement plans. Read
 * images' notes, when not empty, end the request either way.
 */
export function planMessages(input: {
  messages: unknown;
  question: string;
  catalogBlock: string;
  answered?: { question: string; options: readonly string[]; answer: string };
  /** Read images' notes (agents.md 2.15); absent or `''` without images. */
  imageNotes?: string;
}): { messages: string | PlanMessage[]; fallback: string } {
  const before = Array.isArray(input.messages)
    ? (input.messages as PlanMessage[]).slice(0, -1)
    : [];
  const { answered } = input;
  if (answered) {
    return {
      messages: [
        ...before,
        { role: 'user', content: input.question },
        {
          role: 'assistant',
          content: [
            answered.question,
            ...answered.options.map((option) => `- ${option}`),
          ].join('\n'),
        },
        {
          role: 'user',
          content: planRequest(
            answered.answer,
            input.catalogBlock,
            input.imageNotes,
          ),
        },
      ],
      fallback: `${input.question} (${answered.answer})`,
    };
  }
  const request = planRequest(
    input.question,
    input.catalogBlock,
    input.imageNotes,
  );
  return {
    messages: Array.isArray(input.messages)
      ? [...before, { role: 'user', content: request }]
      : request,
    fallback: input.question,
  };
}

/**
 * One query as Write answer reads it: why, what came back (with how many
 * rows are shown when it is not all of them, plan 1.25.6), the rows.
 */
function queryLines(query: AnalyseQuery, index: number): string {
  const shown = Math.min(query.rows.length, ANSWER_ROWS_CAP);
  const facts = query.error
    ? `failed: ${query.error}`
    : `${query.rowCount} rows${shown < query.rowCount ? `, the first ${shown} shown` : ''}${query.truncated ? ', cut at its row limit' : ''}`;
  const rows = query.error
    ? []
    : [JSON.stringify(query.rows.slice(0, ANSWER_ROWS_CAP))];
  return [
    `${index + 1}. ${query.rationale ?? '(no rationale given)'} (${facts})`,
    `SQL: ${query.sql}`,
    ...rows,
  ].join('\n');
}

/**
 * The Write answer step's request (agents.md 5.11): the question, the plan,
 * each query's rationale, outcome and rows (at most `ANSWER_ROWS_CAP` each,
 * the whole at most `ANSWER_REQUEST_CAP` characters) and the findings.
 * Read images' notes, when not empty, follow the plan, set off by blank
 * lines; without them the request is what it was before Read images.
 */
/**
 * How a Validate finding reads to the writer: a warning-only check that did
 * not pass is a `warning`, not a `failed` check, so it never becomes a
 * caveat (roadmap 1.29.8, known issue D).
 */
export function findingStatus(finding: {
  passed: boolean;
  check: string;
}): 'passed' | 'failed' | 'warning' {
  if (finding.passed) return 'passed';
  return /\(warning only\)/i.test(finding.check) ? 'warning' : 'failed';
}

export function writeAnswerRequest(input: {
  question: string;
  plan: Plan;
  queries: readonly AnalyseQuery[];
  findings: readonly Finding[];
  /** Read images' notes (agents.md 2.15); absent or `''` without images. */
  imageNotes?: string;
  /** Build visual runs after it and the request cues a visual (`visualCued`). */
  visualFollows?: boolean;
}): string {
  const notes = imageNotesBlock(input.imageNotes);
  const head = [
    `Question: ${input.question}`,
    '',
    'Plan:',
    JSON.stringify(input.plan),
    ...(notes ? ['', notes, ''] : []),
    '',
  ].join('\n');
  const findings = [
    '',
    'Validation findings:',
    ...(input.findings.length
      ? input.findings.map(
          (f) => `- ${findingStatus(f)}: ${f.check}. ${f.detail}`,
        )
      : ['- none']),
  ].join('\n');
  const queries = input.queries.length
    ? input.queries.map(queryLines).join('\n\n')
    : '(no query ran)';
  // When a visual follows, its line ends the request, after everything else.
  const tail = input.visualFollows ? `\n\n${WRITE_ANSWER_VISUAL_LINE}` : '';
  const room = Math.max(
    0,
    ANSWER_REQUEST_CAP - head.length - findings.length - tail.length,
  );
  const body =
    queries.length > room
      ? `${queries.slice(0, room)}\n[rows shortened to fit]`
      : queries;
  return `${head}Queries and their result rows:\n${body}\n${findings}${tail}`;
}

/**
 * The Analyse step's plan block (agents.md 5.11): the plan as the last
 * system message, and on a retry what the previous attempt's validation
 * found.
 */
export function analysePlanBlock(
  plan: Plan,
  retry?: { attempt: number; findings: readonly Finding[] },
): string {
  const lines = ['Analysis plan for this turn:', JSON.stringify(plan)];
  if (retry) {
    const failed = retry.findings.filter((f) => !f.passed);
    lines.push(
      '',
      `Attempt ${retry.attempt} of this analysis failed validation. Run the analysis again and fix:`,
      ...failed.map((f) => `- ${f.check}: ${f.detail}`),
    );
  }
  return lines.join('\n');
}

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
 * block only on a retry or a resumed attempt that has one, then Read
 * images' notes only when the run has images, and last the line saying a
 * visual follows only when one does; without them, the two blocks it has
 * always had.
 */
export function analyseSystemBlocks(input: {
  catalogBlock: string;
  planBlock: string;
  earlierBlock?: string;
  imageNotes?: string;
  /** Build visual runs after it and the request cues a visual (`visualCued`). */
  visualFollows?: boolean;
}): string[] {
  const notes = imageNotesBlock(input.imageNotes);
  return [
    input.catalogBlock,
    input.planBlock,
    ...(input.earlierBlock ? [input.earlierBlock] : []),
    ...(notes ? [notes] : []),
    ...(input.visualFollows ? [ANALYSE_VISUAL_LINE] : []),
  ];
}
