import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import {
  CONSUMPTION_GAP_STEP_SCHEMAS,
  gapResultSchema,
  gapRunInputSchema,
  type ReferenceDashboard,
} from './consumption-gap-analysis.schemas';
import {
  CONSUMPTION_GAP_DESCRIPTION,
  CONSUMPTION_GAP_RUNTIME_KEY,
  CONSUMPTION_GAP_STEPS,
  CONSUMPTION_GAP_WORKFLOW_ID,
  type ConsumptionGapRuntime,
  type GapQuery,
  type GapQueryResult,
} from './consumption-gap-analysis.steps';
import {
  applyProbes,
  confirmQuestion,
  dashboardRequirements,
  isConfirmation,
  layerTables,
  parseQuestions,
  probeQueries,
  resolveLayers,
  statusCounts,
  traceGaps,
} from './consumption-gap.gaps';
import {
  lineageCandidates,
  lineageFromChecks,
  lineageQueries,
} from './consumption-gap.lineage';
import {
  gapAnswer,
  gapReportTitle,
  renderGapReportBundle,
  type GapReport,
} from './consumption-gap.report';
import { engineInputSchema, withContract } from './workflow-contract';

// The Consumption Gap Analysis workflow, defined in code (agents.md 5.20),
// on Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow) and suspend/resume
// (https://mastra.ai/docs/workflows/suspend-and-resume, ADR-0043):
//
//   resolve-layers → load-layer-catalogs → read-dashboards
//   → derive-requirements → infer-lineage → confirm-requirements (waits)
//   → map-requirements → trace-gaps → probe-evidence → recommend-fixes
//   → render-report
//
// Resolve layers and Load layer catalogs read the datasets' schema notes and
// entities (fetched once per run): a dataset with no Consumption schema is
// refused before any model call. Load layer catalogs starts the lineage
// checks (read-only queries over candidate column pairs, ADR-0051), which run
// while Read dashboards reads every reference image with Grace at the same
// time and loads the saved dashboard, and Derive requirements runs the
// Requirements Analyst over the questions and adds each dashboard widget and
// filter in code; Infer lineage then takes the checks. The graph stays
// linear and one step runs at a time; no held work crosses the wait. Confirm requirements waits for the user's confirmation or
// edits (one revision, never a second wait). Map requirements runs the Layer
// Mapper; Trace gaps and Probe evidence give each requirement its status;
// Recommend fixes runs the Gap Advisor; Render report draws the report with
// the fixed runtime and writes the answer, both in code.
//
// A stopped run bails at the step that saw the stop, which ends the run as
// a success with that step's output (`stopped`).
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./consumption-gap-analysis.schemas.ts, and `withContract` validates
// its input before it runs and its output after.

const STEP = Object.fromEntries(
  CONSUMPTION_GAP_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof CONSUMPTION_GAP_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = CONSUMPTION_GAP_STEP_SCHEMAS;

/** What the engine hands the execute of a step with these schemas. */
type StepParams<
  S extends {
    input: z.ZodType;
    output: z.ZodType;
    suspend?: z.ZodType;
    resume?: z.ZodType;
  },
> = ExecuteFunctionParams<
  unknown,
  z.output<S['input']>,
  z.output<S['output']>,
  S['resume'] extends z.ZodType ? z.output<S['resume']> : unknown,
  S['suspend'] extends z.ZodType ? z.output<S['suspend']> : unknown,
  DefaultEngineType
>;

/**
 * Snapshots are written only while the run waits at Confirm requirements:
 * Mastra resumes a run from its snapshot (ADR-0043), and the runtime on the
 * RequestContext must never be serialised.
 */
const persistWhileWaiting = ({ workflowStatus }: { workflowStatus: string }) =>
  workflowStatus === 'suspended';

/** The run's runtime, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): ConsumptionGapRuntime {
  const runtime = params.requestContext.get(CONSUMPTION_GAP_RUNTIME_KEY) as
    ConsumptionGapRuntime | undefined;
  if (!runtime) {
    throw new Error(`The ${title} step has no consumption model to analyse`);
  }
  return runtime;
}

/** The query alone: what a step keeps beside it stays in the step. */
function bareQueries(queries: readonly GapQuery[]): GapQuery[] {
  return queries.map(({ id, datasourceId, sql, rationale }) => ({
    id,
    datasourceId,
    sql,
    rationale,
  }));
}

/** Each result found by its id. */
function byId(ran: { results: GapQueryResult[]; stopped: boolean }): {
  results: Map<string, GapQueryResult>;
  stopped: boolean;
} {
  return {
    results: new Map(ran.results.map((result) => [result.id, result])),
    stopped: ran.stopped,
  };
}

/** Run the queries (none: no call), each result found by its id. */
async function runQueries(
  runtime: ConsumptionGapRuntime,
  queries: readonly GapQuery[],
): Promise<{ results: Map<string, GapQueryResult>; stopped: boolean }> {
  if (!queries.length) return { results: new Map(), stopped: false };
  return byId(await runtime.runQueries({ queries: bareQueries(queries) }));
}

/** The lineage checks of these tables: the candidate pairs and their queries. */
function lineageChecksOf(tables: Parameters<typeof lineageCandidates>[0]) {
  const candidates = lineageCandidates(tables);
  return { candidates, queries: lineageQueries(candidates, tables) };
}

const resolveLayersStep = createStep({
  id: STEP['resolve-layers'].id,
  description: STEP['resolve-layers'].title,
  inputSchema: engineInputSchema(SCHEMAS['resolve-layers'].input),
  outputSchema: SCHEMAS['resolve-layers'].output,
  execute: withContract(
    STEP['resolve-layers'].title,
    SCHEMAS['resolve-layers'],
    async (params: StepParams<(typeof SCHEMAS)['resolve-layers']>) => {
      const runtime = runtimeOf(params, STEP['resolve-layers'].title);
      // The free refusal first: no Consumption schema, no model call.
      const layers = resolveLayers(
        await runtime.datasetLayers({ datasets: params.inputData.datasets }),
      );
      return { ...params.inputData, layers };
    },
  ),
});

const loadLayerCatalogsStep = createStep({
  id: STEP['load-layer-catalogs'].id,
  description: STEP['load-layer-catalogs'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-layer-catalogs'].input),
  outputSchema: SCHEMAS['load-layer-catalogs'].output,
  execute: withContract(
    STEP['load-layer-catalogs'].title,
    SCHEMAS['load-layer-catalogs'],
    async (params: StepParams<(typeof SCHEMAS)['load-layer-catalogs']>) => {
      const runtime = runtimeOf(params, STEP['load-layer-catalogs'].title);
      // The datasets as the dataset tools list them: names and types, no rows.
      const datasets = await runtime.datasetLayers({
        datasets: params.inputData.datasets,
      });
      const tables = layerTables(datasets, params.inputData.layers);
      // The lineage checks start now and run while the dashboards are read
      // and the requirements derived; Infer lineage takes them (ADR-0051).
      const { queries } = lineageChecksOf(tables);
      if (queries.length) {
        runtime.startLineage({ queries: bareQueries(queries) });
      }
      return { ...params.inputData, tables };
    },
  ),
});

const readDashboardsStep = createStep({
  id: STEP['read-dashboards'].id,
  description: STEP['read-dashboards'].title,
  inputSchema: engineInputSchema(SCHEMAS['read-dashboards'].input),
  outputSchema: SCHEMAS['read-dashboards'].output,
  execute: withContract(
    STEP['read-dashboards'].title,
    SCHEMAS['read-dashboards'],
    async (params: StepParams<(typeof SCHEMAS)['read-dashboards']>) => {
      const runtime = runtimeOf(params, STEP['read-dashboards'].title);
      const { question, datasets, artifact, images, layers, tables } =
        params.inputData;
      const questions = parseQuestions(question);
      const paths = images ?? [];
      // Every reference image read by Grace at the same time (agents.md
      // 2.13). The first failure aborts the other reads, which are awaited,
      // and is the step's error: no read is left running or paid for.
      const batch = new AbortController();
      let failure: { error: unknown } | undefined;
      const reads = await Promise.all(
        paths.map((image) =>
          runtime
            .readDashboard({ image, signal: batch.signal })
            .catch((error: unknown) => {
              failure ??= { error };
              batch.abort();
              return undefined;
            }),
        ),
      );
      if (failure) throw failure.error;
      // A dashboard's id is its image's place, whatever order they ended in.
      const dashboards: ReferenceDashboard[] = [];
      reads.forEach((read, index) => {
        if (!read || read.stopped) return;
        const id = `D${index + 1}`;
        dashboards.push({
          id,
          source: 'image',
          name: read.blueprint.title.trim() || `Dashboard ${id}`,
          blueprint: read.blueprint,
        });
      });
      const base = { questions, datasets, layers, tables };
      if (reads.some((read) => read?.stopped)) {
        return params.bail({ ...base, dashboards, stopped: true });
      }
      // The saved dashboard, last, from Artifacts, without a model call.
      if (artifact.trim()) {
        const loaded = await runtime.loadDashboard({
          artifact: artifact.trim(),
        });
        dashboards.push({
          id: `D${paths.length + 1}`,
          source: 'artifact',
          name: loaded.name,
          blueprint: loaded.blueprint,
        });
      }
      return { ...base, dashboards, stopped: false };
    },
  ),
});

const inferLineageStep = createStep({
  id: STEP['infer-lineage'].id,
  description: STEP['infer-lineage'].title,
  inputSchema: engineInputSchema(SCHEMAS['infer-lineage'].input),
  outputSchema: SCHEMAS['infer-lineage'].output,
  execute: withContract(
    STEP['infer-lineage'].title,
    SCHEMAS['infer-lineage'],
    async (params: StepParams<(typeof SCHEMAS)['infer-lineage']>) => {
      const runtime = runtimeOf(params, STEP['infer-lineage'].title);
      const { candidates, queries } = lineageChecksOf(params.inputData.tables);
      // The checks Load layer catalogs started; each is a source of the
      // answer, in query order (ADR-0051).
      const ran = queries.length
        ? byId(await runtime.takeLineage())
        : { results: new Map<string, GapQueryResult>(), stopped: false };
      const lineage = lineageFromChecks(
        candidates,
        queries.map((query) => ({
          query,
          result: ran.results.get(query.id),
        })),
      );
      const output = { ...params.inputData, lineage, stopped: ran.stopped };
      return ran.stopped ? params.bail(output) : output;
    },
  ),
});

const deriveRequirementsStep = createStep({
  id: STEP['derive-requirements'].id,
  description: STEP['derive-requirements'].title,
  inputSchema: engineInputSchema(SCHEMAS['derive-requirements'].input),
  outputSchema: SCHEMAS['derive-requirements'].output,
  execute: withContract(
    STEP['derive-requirements'].title,
    SCHEMAS['derive-requirements'],
    async (params: StepParams<(typeof SCHEMAS)['derive-requirements']>) => {
      const runtime = runtimeOf(params, STEP['derive-requirements'].title);
      const { questions, dashboards } = params.inputData;
      // The questions' requirements from the model, the dashboards' in code.
      const derived = await runtime.deriveRequirements({
        questions,
        dashboards,
      });
      const output = {
        ...params.inputData,
        requirements: [
          ...derived.requirements,
          ...dashboardRequirements(dashboards),
        ],
        stopped: derived.stopped,
      };
      return derived.stopped ? params.bail(output) : output;
    },
  ),
});

const confirmRequirementsStep = createStep({
  id: STEP['confirm-requirements'].id,
  description: STEP['confirm-requirements'].title,
  inputSchema: engineInputSchema(SCHEMAS['confirm-requirements'].input),
  outputSchema: SCHEMAS['confirm-requirements'].output,
  suspendSchema: SCHEMAS['confirm-requirements'].suspend,
  resumeSchema: SCHEMAS['confirm-requirements'].resume,
  execute: withContract(
    STEP['confirm-requirements'].title,
    SCHEMAS['confirm-requirements'],
    async (params: StepParams<(typeof SCHEMAS)['confirm-requirements']>) => {
      const { questions, requirements } = params.inputData;
      const answer = params.resumeData?.answer?.trim();
      // The run waits for the user's confirmation or edits (api.md 138).
      if (!answer) return params.suspend(confirmQuestion(requirements));
      if (isConfirmation(answer)) {
        return { ...params.inputData, feedback: '', stopped: false };
      }
      // Anything else is feedback: applied once, and the run goes on.
      const runtime = runtimeOf(params, STEP['confirm-requirements'].title);
      const revised = await runtime.reviseRequirements({
        questions,
        requirements,
        feedback: answer,
      });
      const output = {
        ...params.inputData,
        requirements: revised.requirements,
        feedback: answer,
        stopped: revised.stopped,
      };
      return revised.stopped ? params.bail(output) : output;
    },
  ),
});

const mapRequirementsStep = createStep({
  id: STEP['map-requirements'].id,
  description: STEP['map-requirements'].title,
  inputSchema: engineInputSchema(SCHEMAS['map-requirements'].input),
  outputSchema: SCHEMAS['map-requirements'].output,
  execute: withContract(
    STEP['map-requirements'].title,
    SCHEMAS['map-requirements'],
    async (params: StepParams<(typeof SCHEMAS)['map-requirements']>) => {
      const runtime = runtimeOf(params, STEP['map-requirements'].title);
      const { requirements, tables } = params.inputData;
      const mapped = await runtime.mapRequirements({ requirements, tables });
      const output = {
        ...params.inputData,
        mappings: mapped.mappings,
        stopped: mapped.stopped,
      };
      return mapped.stopped ? params.bail(output) : output;
    },
  ),
});

const traceGapsStep = createStep({
  id: STEP['trace-gaps'].id,
  description: STEP['trace-gaps'].title,
  inputSchema: engineInputSchema(SCHEMAS['trace-gaps'].input),
  outputSchema: SCHEMAS['trace-gaps'].output,
  execute: withContract(
    STEP['trace-gaps'].title,
    SCHEMAS['trace-gaps'],
    (params: StepParams<(typeof SCHEMAS)['trace-gaps']>) => {
      const { requirements, mappings, lineage, tables } = params.inputData;
      // The lineage comes back with a `mapped` edge per field mapped twice.
      const traced = traceGaps({ requirements, mappings, lineage, tables });
      return Promise.resolve({
        ...params.inputData,
        assessments: traced.assessments,
        lineage: traced.lineage,
      });
    },
  ),
});

const probeEvidenceStep = createStep({
  id: STEP['probe-evidence'].id,
  description: STEP['probe-evidence'].title,
  inputSchema: engineInputSchema(SCHEMAS['probe-evidence'].input),
  outputSchema: SCHEMAS['probe-evidence'].output,
  execute: withContract(
    STEP['probe-evidence'].title,
    SCHEMAS['probe-evidence'],
    async (params: StepParams<(typeof SCHEMAS)['probe-evidence']>) => {
      const runtime = runtimeOf(params, STEP['probe-evidence'].title);
      const { requirements, assessments, tables, lineage } = params.inputData;
      const probes = probeQueries({
        requirements,
        assessments,
        tables,
        lineage,
      });
      // Each probe is a source of the answer; a failed one is a result.
      const ran = await runQueries(runtime, probes);
      const results = [...ran.results.values()];
      const output = {
        ...params.inputData,
        assessments: applyProbes(assessments, probes, results),
        probeCount: results.length,
        failedProbeCount: results.filter((result) => result.error !== null)
          .length,
        stopped: ran.stopped,
      };
      return ran.stopped ? params.bail(output) : output;
    },
  ),
});

const recommendFixesStep = createStep({
  id: STEP['recommend-fixes'].id,
  description: STEP['recommend-fixes'].title,
  inputSchema: engineInputSchema(SCHEMAS['recommend-fixes'].input),
  outputSchema: SCHEMAS['recommend-fixes'].output,
  execute: withContract(
    STEP['recommend-fixes'].title,
    SCHEMAS['recommend-fixes'],
    async (params: StepParams<(typeof SCHEMAS)['recommend-fixes']>) => {
      const runtime = runtimeOf(params, STEP['recommend-fixes'].title);
      const { requirements, assessments, tables, lineage } = params.inputData;
      const advised = await runtime.recommendFixes({
        requirements,
        assessments,
        tables,
        lineage,
      });
      const output = {
        ...params.inputData,
        fixes: advised.fixes,
        stopped: advised.stopped,
      };
      return advised.stopped ? params.bail(output) : output;
    },
  ),
});

const renderReportStep = createStep({
  id: STEP['render-report'].id,
  description: STEP['render-report'].title,
  inputSchema: engineInputSchema(SCHEMAS['render-report'].input),
  outputSchema: SCHEMAS['render-report'].output,
  execute: withContract(
    STEP['render-report'].title,
    SCHEMAS['render-report'],
    async (params: StepParams<(typeof SCHEMAS)['render-report']>) => {
      const runtime = runtimeOf(params, STEP['render-report'].title);
      const data = params.inputData;
      const report: GapReport = {
        questions: data.questions,
        datasets: data.datasets,
        layers: data.layers,
        tables: data.tables,
        lineage: data.lineage,
        dashboards: data.dashboards,
        requirements: data.requirements,
        assessments: data.assessments,
        fixes: data.fixes,
        probeCount: data.probeCount,
      };
      // The report and the answer, both built in code (no model writes them).
      const title = gapReportTitle(report);
      const answer = gapAnswer(report);
      const saved = await runtime.saveReport({
        bundle: renderGapReportBundle(report),
        answer,
        title,
      });
      return {
        visualId: saved.visualId,
        title: saved.title,
        requirementCount: data.requirements.length,
        counts: statusCounts(data.assessments),
        fixCount: data.fixes.length,
        edgeCount: data.lineage.edges.length,
        answer,
      };
    },
  ),
});

export const consumptionGapAnalysisWorkflow = createWorkflow({
  id: CONSUMPTION_GAP_WORKFLOW_ID,
  description: CONSUMPTION_GAP_DESCRIPTION,
  inputSchema: gapRunInputSchema,
  outputSchema: gapResultSchema,
  options: {
    // The run's input is validated against `gapRunInputSchema` before the
    // first step (the input node has already checked it, api.md 118).
    validateInputs: true,
    // Only a run waiting at Confirm requirements is snapshotted (for its
    // resume); its runtime on the RequestContext is functions only.
    shouldPersistSnapshot: persistWhileWaiting,
  },
})
  .then(resolveLayersStep)
  .then(loadLayerCatalogsStep)
  .then(readDashboardsStep)
  .then(deriveRequirementsStep)
  .then(inferLineageStep)
  .then(confirmRequirementsStep)
  .then(mapRequirementsStep)
  .then(traceGapsStep)
  .then(probeEvidenceStep)
  .then(recommendFixesStep)
  .then(renderReportStep)
  .commit();
