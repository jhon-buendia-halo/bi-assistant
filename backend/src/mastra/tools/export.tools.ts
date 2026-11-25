/**
 * export_conversation (agents.md 3.18): the conversation exported to a PDF
 * and a PowerPoint, with the content the agent writes. Shared by Avery's
 * team tools and Elena's own: it calls the run's `ExportToolsRuntime` and
 * answers in text.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  EXPORT_CONVERSATION_TOOL,
  exportContentSchema,
  type ExportContent,
} from '../workflows/export-request';
import { ORCHESTRATOR_TOOLS_RUNTIME_KEY } from '../workflows/orchestrated-answer-michael.steps';

/** The requestContext key of the run's `ExportToolsRuntime`. */
export const EXPORT_TOOLS_RUNTIME_KEY = 'export-tools-runtime';

/** What export_conversation calls: the run that exports the conversation. */
export interface ExportToolsRuntime {
  /**
   * The run may export the conversation (export_conversation is offered):
   * the user's words ask for it (`asksForExport`).
   */
  exportsConversation: boolean;
  /**
   * Export the conversation with the agent's content: what was exported, or
   * the figures to fix, for the agent.
   */
  exportConversation(content: ExportContent): Promise<string>;
}

/** A tool's RequestContext, as the tools read it. */
interface ContextLike {
  get(key: string): unknown;
}

/**
 * The run's export runtime: its own key, else Avery's tools runtime (which
 * carries the same two members until her run sets the export key), else an
 * error the model reads.
 */
function exportRuntimeOf(requestContext: unknown): ExportToolsRuntime {
  const context = requestContext as ContextLike | undefined;
  const runtime = (context?.get(EXPORT_TOOLS_RUNTIME_KEY) ??
    context?.get(ORCHESTRATOR_TOOLS_RUNTIME_KEY)) as
    ExportToolsRuntime | undefined;
  if (!runtime)
    throw new Error('This tool only runs inside an orchestrated run.');
  return runtime;
}

export const exportConversationTool = createTool({
  id: EXPORT_CONVERSATION_TOOL,
  description:
    "Exports the whole conversation (each earlier question, Avery's answer to it and its dashboard, and the queries behind them) to a PDF and a PowerPoint the user downloads and shares. You write the title, the summary and one headline per earlier question; every figure in them must be copied from the answers. Call it only when the user asks to export, download or share the conversation; at most twice per run. Returns what was exported, or the figures to fix.",
  inputSchema: exportContentSchema,
  outputSchema: z.object({ result: z.string() }),
  execute: async (input, context) => ({
    result: await exportRuntimeOf(context?.requestContext).exportConversation(
      exportContentSchema.parse(input),
    ),
  }),
});
