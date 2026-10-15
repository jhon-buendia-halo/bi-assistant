import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDatasetToolServices } from '../tool-services';
import { SESSION_ID_CONTEXT_KEY } from './visual.tools';

/**
 * The workflow status bar above the chat (ADR-0029 addendum, agents.md 3.11):
 * the agent creates its steps (when its prompt has no `## Workflow` section)
 * and sets their status. The schema is flat on purpose, like
 * `show_in_panel`'s; the rules live in the bridge, which answers with the
 * message the model should see.
 */
export const updateWorkflowTool = createTool({
  id: 'update_workflow',
  description: [
    'Create or update the workflow status bar above the chat: the steps of the process you are guiding the user through and where they are in it.',
    'Call it when you start or finish a step; the steps of your ## Workflow section are already there, so only set their status.',
  ].join(' '),
  inputSchema: z.object({
    steps: z
      .string()
      .optional()
      .describe(
        'Only when your prompt has no ## Workflow section: the step titles in order, separated by " | ", e.g. "Scope | Analyse | Report"; replaces your steps',
      ),
    current: z
      .number()
      .int()
      .optional()
      .describe('The step in progress, 1 to the number of steps'),
    done: z
      .string()
      .optional()
      .describe('Completed step numbers, comma-separated, e.g. "1,2"'),
    skipped: z
      .string()
      .optional()
      .describe('Step numbers that do not apply, comma-separated'),
    waiting: z
      .boolean()
      .optional()
      .describe(
        "true when the current step waits for the user's answer or decision",
      ),
    note: z
      .string()
      .optional()
      .describe(
        'Markdown for the current step: what you need from the user now, at most 2,000 characters',
      ),
    todo: z
      .string()
      .optional()
      .describe(
        'What the user must do, or what still has to happen, for open steps: "<step>: <action>" items separated by " | ", e.g. "3: Confirm Medical and Dental go to bid | 4: Choose 2 to 4 carriers to invite"; replaces the action of each step it names; "<step>:" with nothing after it restores the default',
      ),
  }),
  execute: async (input, { requestContext }) => {
    const sessionId = requestContext.get(SESSION_ID_CONTEXT_KEY);
    if (typeof sessionId !== 'string' || !sessionId) {
      return { error: 'No session in context' };
    }
    try {
      return await getDatasetToolServices().updateWorkflow(sessionId, input);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
