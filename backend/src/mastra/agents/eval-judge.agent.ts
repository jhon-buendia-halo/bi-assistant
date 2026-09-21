import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveAgentModel } from '../model-resolver';

/** Strict pass/fail + reason — the eval harness's LLM-judge output shape. */
export const evalJudgeOutputSchema = z.object({
  pass: z.boolean().describe('Whether the response satisfies the rubric'),
  reason: z
    .string()
    .describe('One or two sentences on why it passed or failed the rubric'),
});

/**
 * Scores one assistant eval case against a natural-language rubric, for the
 * cases where a regex/text check is too brittle to judge quality: did a
 * clarification ask a well-formed question with grounded options, did a
 * refusal state actual coverage instead of inventing stats, does a created
 * visual plausibly answer the request. Single step, no tools, structured
 * output, on the same configured model the assistant itself runs on (see
 * ../model-resolver) — never a hardcoded judge model.
 */
export const evalJudgeAgent = new Agent({
  id: 'assistant-eval-judge',
  name: 'Assistant Eval Judge',
  description:
    "Grades one assistant eval case's tool calls and final answer against a rubric.",
  instructions: [
    'You are a strict, impartial grader for an automated eval suite.',
    'You are given the question that was asked, a grading rubric, the tool',
    "calls the assistant made (in order, with their inputs/outputs) and the",
    "assistant's final answer to the user.",
    '',
    'Score pass=true only when the rubric is clearly satisfied by what the',
    'tool calls and final answer actually show. When the rubric is only',
    'partially satisfied, or you are unsure, score pass=false and say',
    'exactly what is missing in `reason`. Judge only the evidence given —',
    'never pass an answer for merely landing on a correct-sounding figure',
    'when it violates the rubric (e.g. answering instead of asking a',
    'required clarification, or stating a fact with no backing tool call).',
  ].join('\n'),
  model: async () => resolveAgentModel(),
});
