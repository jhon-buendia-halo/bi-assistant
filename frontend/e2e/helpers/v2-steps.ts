/**
 * How the LLM stubs tell the app's special model calls apart.
 *
 * Avery (the Chief of Staff of Answer a Business Question (Avery + Michael),
 * the one question-answering workflow) is recognised by her instructions'
 * first line and moved automatically (`averyMove`): she briefs Michael
 * through `answer_from_data`, so a spec scripts Michael's turn only.
 *
 * Plan and Write answer (Olivia's and Jessica's structured calls, which only
 * the evals still make) each call the model once with no tools and ask for
 * JSON, and their instructions start with a fixed first line. The stubs
 * recognise them by that line and answer with a plan or an answer; any other
 * call (Michael's turn, a step chat) gets the test's own scripted reply.
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
 * The first line of the former Check data quality step's request (the
 * step was replaced by Build visual): kept
 * for the stubs that still route a call by it.
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

/** A plan that asks `clarification` first: the run waits at Plan. */
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
 * The reply to the former Check data quality step: the first listed engine finding
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

// ------------------------------------------------------------------ Avery

/**
 * The first line of Avery's shipped instructions (backend
 * `orchestrated-answer-michael.prompts.ts`, `ORCHESTRATOR_FIRST_LINE`). Keep
 * it equal to that line: the stubs tell her calls apart by it.
 */
export const AVERY_FIRST_LINE =
  'You are Avery, the Chief of Staff of a data team. You are the only person the user talks to: you decide who on the team works on their question, brief them, check what they bring back and hand the user one answer.';

/** Avery's tool that runs Michael (Insights Analyst) on her brief. */
export const AVERY_ANSWER_TOOL = 'answer_from_data';

/** How `answer_from_data` starts when Michael asked a question (orchestrator-turn.ts). */
export const MICHAEL_ASKS_PREFIX =
  'Michael needs an answer before he can go on: ';

/** Avery's closing words in the stubs: none, so the run's answer is Michael's. */
export const AVERY_CLOSING = '';

/** Whether one of these system texts starts Avery's instructions. */
export function isAveryCall(systemTexts: string[]): boolean {
  return systemTexts.some((text) => firstLine(text) === AVERY_FIRST_LINE);
}

/**
 * Avery's scripted move, from her turn so far:
 *
 * - no `answer_from_data` result yet: she calls it with the user's words as
 *   her brief (Michael's own request still carries the question as its user
 *   message, so a reply script keyed on the question answers him);
 * - Michael asked the user a question (his `ask_clarification`): she asks it
 *   with her own `ask_clarification`, and the run waits;
 * - Michael answered: she closes with `AVERY_CLOSING` (no words), so the
 *   run's answer is exactly his.
 */
export type AveryMove =
  | { toolCall: { name: string; arguments: Record<string, unknown> } }
  | { text: string };

export function averyMove(question: string, michaelResult?: string): AveryMove {
  if (michaelResult === undefined) {
    return {
      toolCall: {
        name: AVERY_ANSWER_TOOL,
        arguments: { brief: question.trim() || 'Answer the user.' },
      },
    };
  }
  if (michaelResult.startsWith(MICHAEL_ASKS_PREFIX)) {
    const [first, ...rest] = michaelResult.split('\n');
    return {
      toolCall: {
        name: 'ask_clarification',
        arguments: {
          question: first.slice(MICHAEL_ASKS_PREFIX.length).trim(),
          options: rest
            .filter((line) => line.startsWith('- '))
            .map((line) => line.slice(2).trim())
            .join('\n'),
        },
      },
    };
  }
  return { text: AVERY_CLOSING };
}

/** A tool result's text, from a string, JSON text, content parts or `{ result }`. */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return toolResultText(JSON.parse(trimmed));
      } catch {
        return content;
      }
    }
    return content;
  }
  if (Array.isArray(content)) return content.map(toolResultText).join('');
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    for (const key of ['result', 'text', 'value', 'content', 'output']) {
      if (key in record) return toolResultText(record[key]);
    }
  }
  return '';
}
