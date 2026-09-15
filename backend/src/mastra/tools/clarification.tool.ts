import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * UI-facing tool: asking it ends the turn — the harness intercepts the call,
 * renders a clarification card to the user, and the user's pick arrives as
 * the next user message. The execute body is a no-op placeholder.
 */
export const askClarificationTool = createTool({
  id: 'ask_clarification',
  description: [
    'Ask the user ONE clarifying question with 2-4 concrete answer options',
    'before starting an analysis, when their question is ambiguous (unclear',
    'scope, metric, timeframe, or entity). The user picks an option or types',
    'their own answer, which arrives as the next message. Do not call this',
    'when the intent is already clear or the user just answered a',
    'clarification.',
  ].join(' '),
  inputSchema: z.object({
    question: z.string().describe('The clarifying question, short and direct'),
    options: z
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
  }),
  execute: async () => ({ delivered: true }),
});
