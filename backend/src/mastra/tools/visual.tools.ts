import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetToolTurnRecord } from '../tool-services';
import { usageSinkFrom } from '../usage-sink';

/** requestContext keys for the visual tools. */
export const SESSION_ID_CONTEXT_KEY = 'session-id';
export const ACTIVE_VISUAL_CONTEXT_KEY = 'active-visual-id';
/**
 * Holds a live reference to the current chat turn's captured SQL/rows
 * (`ToolDataRecord[]`), set once per turn in `SessionsService.streamMessage`
 * before the model starts and mutated in place as tool results arrive — so a
 * `create_visual`/`update_visual` call later in the same turn sees everything
 * gathered so far. A fresh object is created per turn, so there is no
 * leakage between turns or between sessions.
 */
export const TURN_RECORDS_CONTEXT_KEY = 'turn-data-records';
/**
 * The user's message for this turn. `create_visual` uses it as the
 * instruction when the model passes none, so the designer charts what was
 * asked instead of guessing from the turn's data (agents.md 3.6, BA-210).
 */
export const TURN_QUESTION_CONTEXT_KEY = 'turn-question';

function contextString(
  requestContext: { get: (key: string) => unknown },
  key: string,
): string | undefined {
  const value = requestContext.get(key);
  return typeof value === 'string' && value ? value : undefined;
}

function contextRecords(
  requestContext: { get: (key: string) => unknown },
  key: string,
): DatasetToolTurnRecord[] | undefined {
  const value = requestContext.get(key);
  return Array.isArray(value) ? (value as DatasetToolTurnRecord[]) : undefined;
}

export const createVisualTool = createTool({
  id: 'create_visual',
  description: [
    'Create a new interactive visual (HTML/CSS/JS chart) from one of your',
    'completed analysis answers. Defaults to your most recent answer; pass',
    'sourceMessageAt to target another. Pass instruction with what to chart',
    "in the user's words plus any design guidance (chart type, focus,",
    "styling); without it the user's request is used. Use update_visual",
    'instead when the user wants to change an existing visual.',
  ].join(' '),
  inputSchema: z.object({
    sourceMessageAt: z
      .string()
      .optional()
      .describe('ISO timestamp of the assistant answer to visualize'),
    instruction: z
      .string()
      .optional()
      .describe("What to chart, in the user's words, plus any design guidance"),
  }),
  execute: async ({ sourceMessageAt, instruction }, { requestContext }) => {
    const sessionId = contextString(requestContext, SESSION_ID_CONTEXT_KEY);
    if (!sessionId) return { error: 'No session in context' };
    const turnRecords = contextRecords(
      requestContext,
      TURN_RECORDS_CONTEXT_KEY,
    );
    const steer =
      instruction?.trim() ||
      contextString(requestContext, TURN_QUESTION_CONTEXT_KEY);
    try {
      return await getDatasetToolServices().createVisual(
        sessionId,
        sourceMessageAt,
        steer,
        turnRecords,
        usageSinkFrom(requestContext),
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const updateVisualTool = createTool({
  id: 'update_visual',
  description: [
    'Tailor an existing interactive visual: change chart type, colours,',
    'labels, filters, which series or how many items are shown, etc. Produces',
    'a new version. Defaults to the visual currently open in the right panel;',
    'pass visualId to target another one listed in the session context.',
  ].join(' '),
  inputSchema: z.object({
    visualId: z.string().optional().describe('Visual to change'),
    instruction: z
      .string()
      .describe("What to change, in the user's words plus any needed detail"),
  }),
  execute: async ({ visualId, instruction }, { requestContext }) => {
    const sessionId = contextString(requestContext, SESSION_ID_CONTEXT_KEY);
    if (!sessionId) return { error: 'No session in context' };
    const target =
      visualId ?? contextString(requestContext, ACTIVE_VISUAL_CONTEXT_KEY);
    if (!target) {
      return {
        error:
          'No visual is open and none was specified — ask which visual to change or create one with create_visual',
      };
    }
    const turnRecords = contextRecords(
      requestContext,
      TURN_RECORDS_CONTEXT_KEY,
    );
    try {
      return await getDatasetToolServices().updateVisual(
        sessionId,
        target,
        instruction,
        turnRecords,
        usageSinkFrom(requestContext),
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const visualTools = {
  create_visual: createVisualTool,
  update_visual: updateVisualTool,
};
