import type { RequestContext } from '@mastra/core/request-context';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  DEEP_ANALYSIS_RUNTIME_KEY,
  DEEP_ANALYSIS_STEPS,
  DEEP_ANALYSIS_WORKFLOW_ID,
  assembleReport,
  receivePlan,
  reportTitle,
  type AngleFinding,
  type DeepAnalysisRuntime,
} from './deep-analysis.steps';

// Deep analysis as a run workflow (agents.md 2.7, 5.15; plan 1.25.3): the
// assistant plans the angles, investigates each, writes the report, and code
// assembles and stores it. It runs once on its typed input
// (`POST /workflows/deep-analysis/runs[/stream]`, api.md 118-119); the run
// code puts the assistant calls and the run workspace on its RequestContext.

const [PLAN, INVESTIGATE, WRITE, ASSEMBLE] = DEEP_ANALYSIS_STEPS;

const runInput = z.object({
  question: z.string(),
  datasets: z.array(z.string()),
});

const angle = z.object({ title: z.string(), question: z.string() });

const finding = angle.extend({
  findings: z.string(),
  sql: z.array(z.string()),
});

const planned = z.object({
  question: z.string(),
  title: z.string(),
  angles: z.array(angle),
});

const investigated = z.object({
  question: z.string(),
  title: z.string(),
  findings: z.array(finding),
});

const written = z.object({
  question: z.string(),
  title: z.string(),
  executiveSummary: z.string(),
  body: z.string(),
  findings: z.array(finding),
});

const assembled = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  path: z.string(),
  angles: z.number(),
});

function runtimeOf(requestContext: RequestContext): DeepAnalysisRuntime {
  const runtime = requestContext.get<string, DeepAnalysisRuntime | undefined>(
    DEEP_ANALYSIS_RUNTIME_KEY,
  );
  if (!runtime) throw new Error('The deep analysis has no run to report to');
  return runtime;
}

const planStep = createStep({
  id: PLAN.id,
  description: PLAN.title,
  inputSchema: runInput,
  outputSchema: planned,
  execute: async ({ inputData, requestContext }) => {
    const question = inputData.question.trim();
    if (!question) throw new Error('question is required');
    const plan = receivePlan(
      await runtimeOf(requestContext).plan(question),
      question,
    );
    return { question, title: plan.title, angles: plan.angles };
  },
});

const investigateStep = createStep({
  id: INVESTIGATE.id,
  description: INVESTIGATE.title,
  inputSchema: planned,
  outputSchema: investigated,
  execute: async ({ inputData, requestContext }) => {
    const runtime = runtimeOf(requestContext);
    const findings: AngleFinding[] = [];
    // One angle at a time, in order (R6).
    for (const [index, item] of inputData.angles.entries()) {
      findings.push(
        await runtime.investigate({
          question: inputData.question,
          angle: item,
          index,
          total: inputData.angles.length,
        }),
      );
    }
    return { question: inputData.question, title: inputData.title, findings };
  },
});

const writeStep = createStep({
  id: WRITE.id,
  description: WRITE.title,
  inputSchema: investigated,
  outputSchema: written,
  execute: async ({ inputData, requestContext }) => {
    const report = await runtimeOf(requestContext).write({
      question: inputData.question,
      findings: inputData.findings,
    });
    return {
      question: inputData.question,
      title: reportTitle(report, inputData.title),
      executiveSummary: report.executiveSummary,
      body: report.report,
      findings: inputData.findings,
    };
  },
});

const assembleStep = createStep({
  id: ASSEMBLE.id,
  description: ASSEMBLE.title,
  inputSchema: written,
  outputSchema: assembled,
  execute: async ({ inputData, requestContext }) => {
    const runtime = runtimeOf(requestContext);
    const { markdown, report } = assembleReport({
      ...inputData,
      reportId: runtime.reportId,
      generatedAt: runtime.now?.() ?? new Date().toISOString(),
    });
    await runtime.store(report.path, markdown);
    return report;
  },
});

export const deepAnalysisWorkflow = createWorkflow({
  id: DEEP_ANALYSIS_WORKFLOW_ID,
  description:
    'Investigates a broad question from several angles with SQL and writes a report with an executive summary, findings, anomalies and recommendations.',
  inputSchema: runInput,
  outputSchema: assembled,
  // The run's document holds its state; the runtime object on the
  // RequestContext must never be serialized.
  options: { shouldPersistSnapshot: () => false },
})
  .then(planStep)
  .then(investigateStep)
  .then(writeStep)
  .then(assembleStep)
  .commit();
