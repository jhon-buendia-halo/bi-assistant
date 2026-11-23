/**
 * Avery's tools (agents.md 2.21, 5.23): each one calls a member of the team
 * through the run's `OrchestratorToolsRuntime` and answers Avery in a few
 * lines of text. The team never talks to the user here: only Avery does.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  AVERY_TEAM,
  MICHAEL_ANSWER_TOOL,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer-michael.steps';
import { BUILD_DASHBOARD_TOOL } from '../workflows/bi-dashboard.schemas';
import {
  EXPORT_CONVERSATION_TOOL,
  exportContentSchema,
} from '../workflows/export-request';

/** A tool's RequestContext, as the tools read it. */
interface ContextLike {
  get(key: string): unknown;
}

/** The run's tools runtime, or an error the model reads. */
function runtimeOf(requestContext: unknown): OrchestratorToolsRuntime {
  const runtime = (requestContext as ContextLike | undefined)?.get(
    ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  ) as OrchestratorToolsRuntime | undefined;
  if (!runtime)
    throw new Error('This tool only runs inside an orchestrated run.');
  return runtime;
}

/** What every tool answers: text for Avery. */
const reply = z.object({ result: z.string() });

export const answerFromDataTool = createTool({
  id: MICHAEL_ANSWER_TOOL,
  description:
    "Michael, Insights Analyst, working alone with you: plans the analysis from your brief, runs read-only SQL over the user's datasets and writes the answer the user reads, every figure linked to its query. Returns his queries, their checks and his answer. At most twice per run.",
  inputSchema: z.object({
    brief: z
      .string()
      .describe(
        "What Michael must answer: first the user's question restated so it stands alone (on a follow-up, resolved from the conversation), then the measures, the scope and anything his answer must say (a tie to name, a limit of the data to state first). On a second call, exactly what to fix.",
      ),
  }),
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).answerFromData(
      input.brief,
    ),
  }),
});

export const buildDashboardTool = createTool({
  id: BUILD_DASHBOARD_TOOL,
  description:
    "Clara, Business Intelligence Analyst: builds an interactive dashboard on the user's real rows (filters, KPIs and charts that recompute), or changes the conversation's dashboard into its next version. Call it only when the user asks for a dashboard or a change to it. Returns what she built.",
  inputSchema: z.object({
    brief: z
      .string()
      .describe(
        'What the dashboard must show, restated so it stands alone: its measures, breakdowns and filters. On a change, exactly what to change and what to keep.',
      ),
  }),
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).buildDashboard(
      input.brief,
    ),
  }),
});

export const exportConversationTool = createTool({
  id: EXPORT_CONVERSATION_TOOL,
  description:
    "Exports the whole conversation (each earlier question, Avery's answer to it and its dashboard, and the queries behind them) to a PDF and a PowerPoint the user downloads and shares. You write the title, the summary and one headline per earlier question; every figure in them must be copied from the answers. Call it only when the user asks to export, download or share the conversation; at most twice per run. Returns what was exported, or the figures to fix.",
  inputSchema: exportContentSchema,
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).exportConversation(
      exportContentSchema.parse(input),
    ),
  }),
});

/** Every team tool Avery has, by tool id (`ask_clarification` is added by her agent). */
const TEAM_TOOLS = {
  [MICHAEL_ANSWER_TOOL]: answerFromDataTool,
  [BUILD_DASHBOARD_TOOL]: buildDashboardTool,
  [EXPORT_CONVERSATION_TOOL]: exportConversationTool,
};

/**
 * Whether the run hides a tool: Clara with no dashboard, the export unless
 * the user asked for one.
 */
function hiddenIn(
  id: string,
  runtime: OrchestratorToolsRuntime | undefined,
): boolean {
  if (!runtime) return false;
  if (id === BUILD_DASHBOARD_TOOL) return !runtime.buildsDashboard;
  if (id === EXPORT_CONVERSATION_TOOL) return !runtime.exportsConversation;
  return false;
}

/**
 * Avery's team in a run, by tool id (agents.md 2.21, 5.23): her tools,
 * without Clara unless the run may build a dashboard and without
 * export_conversation unless the user asked to export the conversation.
 * With no run (her agent page, a tool's details), every tool she can have.
 */
export function orchestratorTools(requestContext: unknown) {
  const runtime = (requestContext as ContextLike | undefined)?.get(
    ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  ) as OrchestratorToolsRuntime | undefined;
  // A run that names no tools is offered all of hers.
  const offered = runtime ? (runtime.tools ?? AVERY_TEAM.tools) : undefined;
  return Object.fromEntries(
    Object.entries(TEAM_TOOLS).filter(
      ([id]) => (!offered || offered.includes(id)) && !hiddenIn(id, runtime),
    ),
  ) as Partial<typeof TEAM_TOOLS>;
}
