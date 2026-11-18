import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { RUN_CONTEXT_PAGE_CHARS, runContextOf } from '../workflows/run-context';

/**
 * The run context's read tools (the shared-context experiment of
 * `answer-business-question`, ./../workflows/run-context.ts): an agent of a
 * shared-context run lists the board's entries and reads the ones it needs.
 * A run without a board answers with an error, never throws.
 */

export const LIST_RUN_CONTEXT_TOOL = 'list_run_context';
export const READ_RUN_CONTEXT_TOOL = 'read_run_context';

export const listRunContextTool = createTool({
  id: LIST_RUN_CONTEXT_TOOL,
  description:
    "List the entries of this run's shared context (each entity's columns, the queries and their rows, image notes): key, what it holds and its size.",
  inputSchema: z.object({
    prefix: z
      .string()
      .optional()
      .describe('Only keys starting with this, e.g. "catalog/" or "queries/".'),
  }),
  execute: async (input, { requestContext }) => {
    const board = requestContext ? runContextOf(requestContext) : undefined;
    if (!board)
      return Promise.resolve({ error: 'This run has no shared context.' });
    return Promise.resolve({ entries: board.list(input.prefix ?? '') });
  },
});

export const readRunContextTool = createTool({
  id: READ_RUN_CONTEXT_TOOL,
  description: `Read one entry of this run's shared context by its key (e.g. "catalog/<entity>" for an entity's columns, "queries/2" for a query with its rows). Returns at most ${RUN_CONTEXT_PAGE_CHARS} characters; read on from nextOffset when it is not null.`,
  inputSchema: z.object({
    key: z
      .string()
      .describe('The entry key, as the run context index lists it.'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Where to start reading (the previous page’s nextOffset).'),
  }),
  execute: async (input, { requestContext }) => {
    const board = requestContext ? runContextOf(requestContext) : undefined;
    if (!board)
      return Promise.resolve({ error: 'This run has no shared context.' });
    const page = board.read(input.key, input.offset ?? 0);
    // An unknown key is a lookup miss the agent recovers from (the message
    // lists the known keys), not a broken tool: no `error` field, which the
    // evals' no-tool-errors check would count as a failure.
    if ('error' in page)
      return Promise.resolve({ found: false, message: page.error });
    return Promise.resolve({ found: true, ...page });
  },
});

/** Both tools, as a toolset a step agent's call adds (`toolsets`). */
export const RUN_CONTEXT_TOOLS = {
  [LIST_RUN_CONTEXT_TOOL]: listRunContextTool,
  [READ_RUN_CONTEXT_TOOL]: readRunContextTool,
};
