import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveAgentModel } from '../model-resolver';
import { agentInstructions } from '../agent-prompt-overrides';
import { EVAL_JUDGE_PROMPT } from './system-prompts';

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
  // The shipped prompt, or the in-app override (ADR-0025).
  instructions: () =>
    agentInstructions('assistant-eval-judge', EVAL_JUDGE_PROMPT),
  model: async () => resolveAgentModel(),
});
