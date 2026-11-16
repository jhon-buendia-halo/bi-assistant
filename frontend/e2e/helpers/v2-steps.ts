/**
 * The structured model calls of Insights Analyst (`answer-business-question`):
 * Plan and Write answer each call the model once with no tools and ask for
 * JSON, and their instructions start with a fixed first line. The LLM stubs
 * recognise them by that line and answer with a plan or an answer, so every
 * v2 run in the E2E suite gets through both steps; any other call (Analyse,
 * a step chat) gets the test's own scripted reply.
 *
 * Structured output reaches a provider in one of two forms, and the stubs
 * answer both: as JSON text (OpenAI `response_format`, Anthropic
 * `output_config`, or a schema injected into the prompt), or as a call of a
 * tool named `json` (the AI SDK's tool mode).
 */

export const V2_PLAN_LINE =
  'You plan a data analysis for Questions to Insights.';
export const V2_ANSWER_LINE =
  'You write the final answer for Questions to Insights.';

/** Which structured step a model call belongs to. */
export type V2Step = 'plan' | 'answer' | 'quality';

/**
 * The first line of Check data quality's request to Sarah (the Data
 * Readiness Agent): her system prompt is the agent's own, so the call is
 * recognised by its last user message, before any system-prompt routing.
 */
export const V2_QUALITY_LINE =
  'Check the data quality behind an answer from Questions to Insights.';

/**
 * The first line of `result-explorer`'s instructions (roadmap 1.28.4,
 * backend `result-explorer.prompts.ts`): the structured call that turns a
 * reader's words into a view of a query result. Keep it equal to that file.
 */
export const RESULT_EXPLORER_LINE =
  "You turn a user's words about a query's result into a view of that same result: filters, a sort and a page. You never write SQL.";

/** Whether one of these system texts starts `result-explorer`'s instructions. */
export function isResultExplorerCall(systemTexts: string[]): boolean {
  return systemTexts.some((text) => firstLine(text) === RESULT_EXPLORER_LINE);
}

/** `result-explorer`'s reply (plan 1.28, 0.3). */
export interface ExplorerReply {
  action: 'explore' | 'new-question';
  query: number | null;
  filters: {
    column: string;
    op: string;
    value: string | number | boolean | null;
    valueTo: string | number | boolean | null;
    values: (string | number | boolean)[] | null;
  }[];
  sort: { column: string; direction: 'asc' | 'desc' }[];
  page: { move: 'keep' | 'first' | 'next' | 'previous' | 'last' | 'to'; to: number | null };
  understood: string;
}

/** Plan's output (`PlanOutput`). */
export interface V2Plan {
  question: string;
  measures: string[];
  entities: string[];
  scope: string;
  assumptions: string[];
  needsClarification: boolean;
  clarification: { question: string; options: string[] } | null;
}

/** Write answer's output (`AnswerOutput`). */
export interface V2Answer {
  headline: string;
  answer: string;
}

/** The tool the AI SDK's tool mode asks a structured object through. */
export const JSON_TOOL = 'json';

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

/**
 * The structured step whose instructions one of these system texts start
 * with; null for any other call. Each system text is checked, since a
 * provider may put a schema prompt in a system message of its own.
 */
export function v2StepOf(
  systemTexts: string[],
  lastUserText = '',
): V2Step | null {
  if (firstLine(lastUserText) === V2_QUALITY_LINE) return 'quality';
  for (const text of systemTexts) {
    const line = firstLine(text);
    if (line === V2_PLAN_LINE) return 'plan';
    if (line === V2_ANSWER_LINE) return 'answer';
  }
  return null;
}

/** A clear plan for `question`: Analyse runs next. */
export function clearPlan(question: string): V2Plan {
  return {
    question: question.split('\n')[0].trim().slice(0, 300),
    measures: ['match count'],
    entities: ['matches'],
    scope: 'The picked datasets',
    assumptions: ['Every match in the data counts once'],
    needsClarification: false,
    clarification: null,
  };
}

/** A plan that asks `clarification` first: the run stops at Clarify. */
export function clarifyingPlan(
  question: string,
  clarification: { question: string; options: string[] },
): V2Plan {
  return {
    ...clearPlan(question),
    needsClarification: true,
    clarification,
  };
}

/** An answer whose Markdown is `text`, its first line the headline. */
export function answerFrom(text: string): V2Answer {
  return { headline: firstLine(text), answer: text };
}

/**
 * Sarah's reply to Check data quality: the first listed engine finding
 * (`1. [severity] ...` under `Engine findings:`) when there is one, else none.
 */
export function dataQualityReply(request: string): {
  issues: { finding: number; impact: string }[];
} {
  const listed = request.split('Engine findings:')[1] ?? '';
  return /^1\. \[/m.test(listed)
    ? {
        issues: [
          {
            finding: 1,
            impact:
              'This finding could limit how far the answer can be trusted.',
          },
        ],
      }
    : { issues: [] };
}
