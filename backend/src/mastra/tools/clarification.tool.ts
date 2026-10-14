import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/** A JSON-encoded array becomes the array; anything else passes as is. */
export function parseJsonList(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim().startsWith('[')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * UI-facing tool: asking it ends the turn — the harness intercepts the call,
 * renders a clarification card to the user, and the user's pick arrives as
 * the next user message. The execute body is a no-op placeholder.
 */
export const askClarificationTool = createTool({
  id: 'ask_clarification',
  description: [
    'Ask the user ONE clarifying question with 2-4 concrete answer options,',
    'either before starting an analysis when their question is ambiguous',
    '(unclear scope, metric, timeframe, or entity), or mid-analysis when the',
    'data itself is ambiguous — a filter value, member/entity name or',
    'timeframe with several plausible matches. When the ambiguity is about',
    'values, quote the actual values found in the data as the options. The',
    'user picks an option or types their own answer, which arrives as the',
    'next message; continue the analysis from there. At most one call per',
    'user question — do not call this when the intent is already clear or the',
    'user just answered a clarification.',
  ].join(' '),
  inputSchema: z.object({
    question: z.string().describe('The clarifying question, short and direct'),
    // Some models send the list JSON-encoded as one string; a well-formed
    // one is read as the list itself (agents.md 3.5, BA-210).
    options: z.preprocess(
      parseJsonList,
      z
        .array(
          z.object({
            label: z.string().describe('Short option title'),
            description: z
              .string()
              .optional()
              .describe('One line explaining what this option means'),
          }),
        )
        .min(2)
        .max(4),
    ),
  }),
  execute: () => Promise.resolve({ delivered: true }),
});
