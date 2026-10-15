import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetToolTurnRecord } from '../tool-services';
import {
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from './visual.tools';

/**
 * One tool puts what an agent wants to show beside the chat in the right
 * panel (ADR-0029, agents.md 3.11). The schema is flat on purpose: the prompt's
 * `## Tools` line is generated from the input's `shape`, which a union has not.
 * Per-kind validation lives in the bridge, which answers with the message the
 * model should see.
 */
export const showInPanelTool = createTool({
  id: 'show_in_panel',
  description: [
    'Show something in the right panel beside the chat: a workspace file, a Markdown document you compose, a query result as a table, or an existing visual.',
    "Each call replaces what the panel shows and is kept in the session's panel history.",
    'Use it when the user would rather read, sort or download the content than scroll the chat; keep the chat answer short and say what the panel shows.',
  ].join(' '),
  inputSchema: z.object({
    kind: z
      .enum(['file', 'document', 'table', 'visual'])
      .describe(
        'What to show: file (a text file in the session workspace), document (Markdown you write), table (a query result from this turn), visual (an existing visual)',
      ),
    title: z
      .string()
      .optional()
      .describe('Heading shown in the panel; defaults per kind'),
    path: z
      .string()
      .optional()
      .describe(
        'file: workspace-relative path, e.g. rfp/<rfpId>/rfp.md or notes/summary.md',
      ),
    markdown: z
      .string()
      .optional()
      .describe('document: the full Markdown text, at most 50,000 characters'),
    record: z
      .number()
      .int()
      .optional()
      .describe(
        'table: the number of the query result in this turn, 1 for the first; defaults to the latest',
      ),
    visualId: z
      .string()
      .optional()
      .describe('visual: id of a visual listed in the session context'),
  }),
  execute: async (input, { requestContext }) => {
    const sessionId = requestContext.get(SESSION_ID_CONTEXT_KEY);
    if (typeof sessionId !== 'string' || !sessionId) {
      return { error: 'No session in context' };
    }
    const records = requestContext.get(TURN_RECORDS_CONTEXT_KEY);
    try {
      return await getDatasetToolServices().showPanelItem(
        sessionId,
        input,
        Array.isArray(records)
          ? (records as DatasetToolTurnRecord[])
          : undefined,
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
