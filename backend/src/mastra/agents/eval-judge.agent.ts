import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveJudgeModel } from '../model-resolver';

/**
 * Strict pass/fail + reason + how sure the judge is — the eval harness's
 * LLM-judge output shape.
 *
 * `confidence` drives the harness's one retry: a `pass: false` the judge
 * itself calls `low` gets a second opinion, and the second opinion wins
 * (`assistant.evals.ts`). It is optional in the schema on purpose — a judge
 * that omits it still produced a usable verdict, and treating that as
 * invalid JSON would turn a real verdict into a measurement gap. A missing
 * confidence is read as `high` (no retry).
 */
export const evalJudgeOutputSchema = z.object({
  pass: z.boolean().describe('Whether the response satisfies the rubric'),
  reason: z
    .string()
    .describe('One or two sentences on why it passed or failed the rubric'),
  confidence: z
    .enum(['high', 'low'])
    .optional()
    .describe(
      '"high" when the evidence clearly decides the rubric either way; ' +
        '"low" when it is ambiguous, incomplete or you had to guess',
    ),
});

export type EvalJudgeOutput = z.infer<typeof evalJudgeOutputSchema>;

/**
 * Scores one assistant eval case against a natural-language rubric, for the
 * cases where a regex/text check is too brittle to judge quality: did a
 * clarification ask a well-formed question with grounded options, did a
 * refusal state actual coverage instead of inventing stats, does a created
 * visual plausibly answer the request. Single step, no tools, structured
 * output, on the assistant's own configured model by default (see
 * ../model-resolver) — or a model pinned via `EngineSettings.judgeModel`,
 * so the ruler stays steady when the assistant's model changes. Never a
 * hardcoded judge model.
 */
export const evalJudgeAgent = new Agent({
  id: 'assistant-eval-judge',
  name: 'Assistant Eval Judge',
  description:
    "Grades one assistant eval case's tool calls and final answer against a rubric.",
  instructions: [
    'You are a strict, impartial grader for an automated eval suite.',
    'You are given the question that was asked, a grading rubric, the tool',
    'calls the assistant made (in order, with their inputs/outputs) and the',
    "assistant's final answer to the user.",
    '',
    'Score pass=true only when the rubric is clearly satisfied by what the',
    'tool calls and final answer actually show. When the rubric is only',
    'partially satisfied, or you are unsure, score pass=false and say',
    'exactly what is missing in `reason`. Judge only the evidence given —',
    'never pass an answer for merely landing on a correct-sounding figure',
    'when it violates the rubric (e.g. answering instead of asking a',
    'required clarification, or stating a fact with no backing tool call).',
    '',
    'Rubrics often describe answers that are "close but wrong": nearly',
    'right, but with one invented entity, the wrong coverage years, a figure',
    'without the filter the rubric requires, or a refusal that still guesses.',
    'Those must FAIL even when the rest of the answer is good — look for them',
    'explicitly before you pass anything.',
    '',
    'Always report `confidence`: "high" when the evidence clearly decides the',
    'rubric either way, "low" when it is ambiguous, incomplete, or you had to',
    'guess. A low-confidence fail is re-graded, so say "low" honestly rather',
    'than failing an answer you could not actually judge.',
  ].join('\n'),
  model: async () => resolveJudgeModel(),
});
