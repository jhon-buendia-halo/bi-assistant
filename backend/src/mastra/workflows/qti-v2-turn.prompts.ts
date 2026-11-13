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

Never answer the question and never state a figure: the analysis step runs the queries.`;

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
- Never dump a schema, a table list or SQL.`;

/** The most result rows of one query Write answer reads. */
export const ANSWER_ROWS_CAP = 50;

/** The longest request Write answer gets, in characters. */
export const ANSWER_REQUEST_CAP = 40_000;

type Plan = z.output<typeof planSchema>;
type AnalyseQuery = z.output<typeof analyseQuerySchema>;
type Finding = z.output<typeof validationFindingSchema>;

/** The Plan step's request: the question and the catalog block with its columns. */
export function planRequest(question: string, catalogBlock: string): string {
  return [`Question: ${question}`, '', catalogBlock].join('\n');
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
 * `fallback` is the question a reply with no restatement plans.
 */
export function planMessages(input: {
  messages: unknown;
  question: string;
  catalogBlock: string;
  answered?: { question: string; options: readonly string[]; answer: string };
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
          content: planRequest(answered.answer, input.catalogBlock),
        },
      ],
      fallback: `${input.question} (${answered.answer})`,
    };
  }
  const request = planRequest(input.question, input.catalogBlock);
  return {
    messages: Array.isArray(input.messages)
      ? [...before, { role: 'user', content: request }]
      : request,
    fallback: input.question,
  };
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
