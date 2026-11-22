/**
 * Avery's tools (agents.md 2.21, 5.22): each one calls a member of the team
 * through the run's `OrchestratorToolsRuntime` (the same calls Answer a
 * Business Question's steps make) and answers Avery in a few lines of text.
 * The team never talks to the user here: only Avery does.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer.steps';

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

export const readReferenceImagesTool = createTool({
  id: 'read_reference_images',
  description:
    'Zoe, Image Analyst: describes the reference images the user attached to this run (charts, dashboards, tables). Call it first when the run has images, never otherwise. Returns her notes.',
  inputSchema: z.object({}),
  outputSchema: reply,
  execute: async (_input, context) => ({
    result: await runtimeOf(context?.requestContext).readImages(),
  }),
});

export const planAnalysisTool = createTool({
  id: 'plan_analysis',
  description:
    "Olivia, Analysis Lead: plans the analysis of the user's question over their datasets (measures, tables, scope, assumptions). Reads no data. Call it before analyse_data. Returns the plan, and her clarifying question with its options when the question can be read more than one way.",
  inputSchema: z.object({
    brief: z
      .string()
      .optional()
      .describe(
        "Your request to Olivia. First the user's question restated so it stands alone (on a follow-up, resolve words like 'it', 'each one' or 'and by region' from the conversation), then anything the plan must cover. She also reads the user's own words.",
      ),
  }),
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).plan(input.brief),
  }),
});

export const analyseDataTool = createTool({
  id: 'analyse_data',
  description:
    "Michael, Insights Analyst: runs read-only SQL over the user's datasets following the plan, and reports each query (why, rows) and the checks on them. Call it after plan_analysis; at most twice per run.",
  inputSchema: z.object({
    brief: z
      .string()
      .describe(
        "What Michael must find: the measures and scope from the plan, the user's answer if you asked one, and on a second call exactly what to fix.",
      ),
  }),
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).analyse(input.brief),
  }),
});

export const writeAnswerTool = createTool({
  id: 'write_answer',
  description:
    "Jessica, Insights Writer: writes the user's answer from Michael's results, every figure linked to its query. Call it once the results cover the question. Returns a short confirmation; the user reads her answer.",
  inputSchema: z.object({
    brief: z
      .string()
      .optional()
      .describe(
        "Your request to Jessica. First the user's question restated so it stands alone, then what she should know: what the user already learnt from earlier answers (so she does not repeat it), and the part the data covers when it covers only part of the question. She also reads the user's own words.",
      ),
  }),
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).writeAnswer(input.brief),
  }),
});

export const buildVisualTool = createTool({
  id: 'build_visual',
  description:
    'Ryan, Visualization Designer: charts the rows behind the written answer as an interactive visual. Call it after write_answer, only when a chart helps. Returns what he built.',
  inputSchema: z.object({
    instruction: z
      .string()
      .describe('What the chart should show, in one sentence.'),
  }),
  outputSchema: reply,
  execute: async (input, context) => ({
    result: await runtimeOf(context?.requestContext).buildVisual(
      input.instruction,
    ),
  }),
});

/** Avery's team, by tool id, without Ryan when the run builds no visual. */
export function orchestratorTools(requestContext: unknown) {
  const runtime = (requestContext as ContextLike | undefined)?.get(
    ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  ) as OrchestratorToolsRuntime | undefined;
  return {
    read_reference_images: readReferenceImagesTool,
    plan_analysis: planAnalysisTool,
    analyse_data: analyseDataTool,
    write_answer: writeAnswerTool,
    ...(runtime?.buildsVisual === false
      ? {}
      : { build_visual: buildVisualTool }),
  };
}
