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
} from './qti-v2-turn.schemas';

/** The Plan step's instructions' first line (the stub model routes by it). */
export const PLAN_FIRST_LINE =
  'You plan a data analysis for Questions to Insights v2.';

/** The Write answer step's instructions' first line. */
export const WRITE_ANSWER_FIRST_LINE =
  'You write the final answer for Questions to Insights v2.';

/** The Plan step's instructions (agents.md Appendix F). */
export const PLAN_INSTRUCTIONS = `${PLAN_FIRST_LINE}

You receive a business question, the conversation before it when there is one, and the catalog of the entities (tables) the analysis can read. You have no tools and you run no query: you decide what the analysis must find, and whether the question can be analysed as asked.

Reply with one JSON object and nothing else:
- question: the question restated in one sentence, with the natural default for any fuzzy scope made explicit. When the question answers an earlier clarifying question, restate the original question with that answer.
- measures: the figures the answer needs, each a short noun phrase (for example "goals per player").
- entities: the catalog entities the analysis will likely read, by their catalog names.
- scope: the slice of the data the answer covers (periods, filters, groups), in one sentence.
- assumptions: each default you chose for something the question leaves open, one sentence each; empty when there are none.
- needsClarification: true only when the metric or meaning is undefined and the choice would change the analysis (for example "the best team" with no measure named). A fuzzy scope is not a reason: assume the natural default and list it under assumptions. Never true when the question answers an earlier clarifying question.
- clarification: when needsClarification is true, { "question": one short question, "options": 2-4 concrete options, each a short title optionally followed by " — " and one line explaining it }; otherwise null.

Never answer the question and never state a figure: the analysis step runs the queries.`;

/** The Write answer step's instructions (agents.md Appendix F). */
export const WRITE_ANSWER_INSTRUCTIONS = `${WRITE_ANSWER_FIRST_LINE}

You receive the user's question, the analysis plan, the SQL queries the analysis ran with their result rows, and the validation findings. You have no tools and you run nothing: every figure and fact you write comes from those result rows, never from general knowledge.

Reply with one JSON object and nothing else:
- headline: one line that answers the question with the key figure.
- answer: the whole answer in Markdown, starting with the headline line, then:
  - a compact Markdown table when the answer has three or more values;
  - "How I got this": 1-3 bullets in plain words for a business reader, no SQL;
  - "Assumptions": the plan's assumptions the answer rests on, only when there are some;
  - "Caveats": only limits the queries or the findings show (a result cut at its row limit, a failed check, data that does not cover part of the question), only when there are some.

Rules:
- Ties: when values tie at a ranking's cut-off, name every tied entry and say they are tied.
- Coverage: when the data does not cover what the question asks, say so and state what the data does cover; never fill the gap from general knowledge.
- No usable rows (every query failed, or none ran): say the analysis could not get the data and give no figure.
- Never dump a schema, a table list or SQL.`;

/** The most result rows of one query Write answer reads. */
export const ANSWER_ROWS_CAP = 50;

/** The longest request Write answer gets, in characters. */
export const ANSWER_REQUEST_CAP = 40_000;

type Plan = z.output<typeof planSchema>;
type AnalyseQuery = z.output<typeof analyseQuerySchema>;
type Finding = z.output<typeof validationFindingSchema>;

/** The Plan step's request: the question and the catalog block. */
export function planRequest(question: string, catalogBlock: string): string {
  return [`Question: ${question}`, '', catalogBlock].join('\n');
}

/** One query as Write answer reads it: why, what came back, the rows. */
function queryLines(query: AnalyseQuery, index: number): string {
  const facts = query.error
    ? `failed: ${query.error}`
    : `${query.rowCount} rows${query.truncated ? ', cut at its row limit' : ''}`;
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
 */
export function writeAnswerRequest(input: {
  question: string;
  plan: Plan;
  queries: readonly AnalyseQuery[];
  findings: readonly Finding[];
}): string {
  const head = [
    `Question: ${input.question}`,
    '',
    'Plan:',
    JSON.stringify(input.plan),
    '',
  ].join('\n');
  const findings = [
    '',
    'Validation findings:',
    ...(input.findings.length
      ? input.findings.map(
          (f) => `- ${f.passed ? 'passed' : 'failed'}: ${f.check}. ${f.detail}`,
        )
      : ['- none']),
  ].join('\n');
  const queries = input.queries.length
    ? input.queries.map(queryLines).join('\n\n')
    : '(no query ran)';
  const room = Math.max(0, ANSWER_REQUEST_CAP - head.length - findings.length);
  const body =
    queries.length > room
      ? `${queries.slice(0, room)}\n[rows shortened to fit]`
      : queries;
  return `${head}Queries and their result rows:\n${body}\n${findings}`;
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
