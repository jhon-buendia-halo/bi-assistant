import type { Agent } from '@mastra/core/agent';
import type * as ReadinessWorkflow from '../workflows/data-readiness-assessment.workflow';
import type * as FindingSources from '../../modules/sessions/finding-sources';
import type { ReadinessAssessment } from '../../modules/sessions/readiness-bridge';
import {
  ASSESSED_REPORT_CONTEXT_KEY,
  getReadinessToolServices,
  type ReadinessToolReport,
} from '../readiness-tool-services';
import type { SqlRunResult } from '../tool-services';
import { getDatasetToolServices } from '../tool-services';
import { findFixture } from '../../modules/testing-data/fixtures/registry';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  explainReportBlock,
  type DataReadinessAssessmentRuntime,
} from '../workflows/data-readiness-assessment.steps';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { SESSION_ID_CONTEXT_KEY } from '../tools/visual.tools';
import { readinessModelOutput } from '../tools/readiness.tools';
import { dataReadinessAgent } from '../agents/data-readiness.agent';
import type { AssistantEvalSet, EvalTarget } from './assistant.evals';
import {
  EVAL_DETAILS_KEY,
  recordStepOutput,
  type EvalDetailsToolCall,
  type EvalRunDetails,
} from './eval-details';
import { lastUserText } from './insights-analyst-target';
import { readinessEvalOrientation } from './data-readiness.evals';

/**
 * The `data-readiness:assessment-workflow` eval target (agents.md 8.1):
 * every case runs the WHOLE Assess Data Readiness workflow (5.13) on the
 * run's first dataset, with the case's question as the workflow's question,
 * as `michaelTurnAgent` runs Michael. `runEvals` calls
 * the agent's `generate`; this target is the Data Readiness Agent with
 * `generate` replaced by one run of the workflow, whose runtime is the
 * app's (`TurnEngine`'s readiness runtime, eval-sized):
 * - Resolve dataset, Profile source, Score readiness and Save report run
 *   the deterministic engine through the readiness bridge
 *   (`startAssessment`, on the run's throwaway host bound to the agent);
 * - Rows behind findings (after Explain report; here the work Save report
 *   starts in a session runs when its step takes it) runs one read-only
 *   query per top finding
 *   (`recordFindingSources`, through `runReadOnlySql`) — recorded as the
 *   run's sources in `details.findingSources`, not as Sarah's tool calls;
 * - Explain report is the agent's own `generate` with the case's options
 *   (Block D1, step budget, scorer data) plus the report block (the turn
 *   engine's, the saved report's summary in it), and the assessed report
 *   on the context (`assess_data_readiness` refuses).
 * The scored answer is Explain report's answer; the tool calls are
 * Explain report's. `details.steps` holds every step's output,
 * `details.report` the summary the report block carried (what
 * `get_readiness_report` hands the model). A failed step fails the case
 * with its error.
 */

/** The target id (`AssistantEvalSet.target`). */
export const READINESS_WORKFLOW_EVAL_TARGET =
  'data-readiness:assessment-workflow';

/** What the target runs on; tests stand in for each part. */
export interface ReadinessWorkflowParts {
  workflow: {
    createRun(): Promise<{
      stream(args: { inputData: unknown; requestContext: unknown }): {
        fullStream: AsyncIterable<unknown>;
        result: Promise<{ status: string; error?: unknown }>;
      };
    }>;
  };
  /** The readiness bridge's assessment of a session dataset. */
  startAssessment(input: {
    sessionId: string;
    datasetName: string;
  }): Promise<ReadinessAssessment>;
  /** Read-only SQL on a datasource, over the run's datasets. */
  runSql(
    datasourceId: string,
    sql: string,
    limit: number,
    datasets: string[],
  ): Promise<SqlRunResult>;
  recordFindingSources: typeof FindingSources.recordFindingSources;
}

/**
 * The real engine and services, required on first use: they keep the
 * workflow engine off the eval catalogue's module graph.
 */
function defaultParts(): ReadinessWorkflowParts {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { dataReadinessAssessmentWorkflow } =
    require('../workflows/data-readiness-assessment.workflow') as typeof ReadinessWorkflow;
  const { recordFindingSources } =
    require('../../modules/sessions/finding-sources') as typeof FindingSources;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    workflow:
      dataReadinessAssessmentWorkflow as unknown as ReadinessWorkflowParts['workflow'],
    startAssessment: (input) => {
      // The installed services are the readiness bridge (SessionsService).
      const bridge = getReadinessToolServices() as unknown as Partial<{
        startAssessment(input: {
          sessionId: string;
          datasetName: string;
        }): Promise<ReadinessAssessment>;
      }>;
      if (typeof bridge.startAssessment !== 'function') {
        return Promise.reject(new Error('Data readiness is not available'));
      }
      return bridge.startAssessment(input);
    },
    runSql: (datasourceId, sql, limit, datasets) =>
      getDatasetToolServices().runReadOnlySql(
        datasourceId,
        sql,
        limit,
        datasets,
      ),
    recordFindingSources,
  };
}

type GenerateOptions = {
  context?: { role: 'system'; content: string }[];
  requestContext?: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  [key: string]: unknown;
};

/** Whether a source's result is an error (`{ error }`). */
function failedResult(result: unknown): boolean {
  return (
    !!result &&
    typeof result === 'object' &&
    typeof (result as { error?: unknown }).error === 'string'
  );
}

/**
 * The agent, its `generate` running the whole Assess Data Readiness
 * workflow (above). Every other member is the agent's own.
 */
export function readinessWorkflowTurnAgent(
  agent: Agent,
  given?: ReadinessWorkflowParts,
): Agent {
  let loaded = given;
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const parts = (loaded ??= defaultParts());
    const requestContext = options.requestContext;
    if (!requestContext) throw new Error('An eval case runs with a context');
    const datasets = requestContext.get(DATASETS_CONTEXT_KEY);
    const runDatasets = Array.isArray(datasets) ? (datasets as string[]) : [];
    const dataset = runDatasets[0];
    if (!dataset)
      throw new Error('An Assess Data Readiness case needs a dataset');
    const sessionId = requestContext.get(SESSION_ID_CONTEXT_KEY);
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error(
        'An Assess Data Readiness case needs the run host (no session in context)',
      );
    }
    let assessment: ReadinessAssessment | undefined;
    let saved: ReadinessToolReport | undefined;
    let explained: Record<string, unknown> | undefined;
    let answer = '';
    const findingSources: EvalDetailsToolCall[] = [];
    const started = (): ReadinessAssessment => {
      if (!assessment) throw new Error('The dataset has not been resolved');
      return assessment;
    };
    const runtime: DataReadinessAssessmentRuntime = {
      resolve: async ({ dataset: name }) => {
        assessment = await parts.startAssessment({
          sessionId,
          datasetName: name,
        });
        return {
          dataset: assessment.dataset,
          datasourceName: assessment.datasourceName,
          datasourceKind: assessment.datasourceKind,
          tableCount: assessment.tableCount,
        };
      },
      profile: async () => ({ ...(await started().profile()), stopped: false }),
      score: () => {
        const summary = started().score();
        return {
          overallScore: summary.overallScore,
          maturity: summary.maturity,
          findingCount: summary.findingCount,
          dimensionScores: summary.dimensionScores.map((d) => ({
            dimension: d.dimension,
            score: d.score,
            assessed: d.assessed,
            findingCount: d.findingCount,
          })),
        };
      },
      // A case has no images, and the early work runs one step after the
      // other here: the rows behind findings when their step takes them.
      startImageNotes: () => undefined,
      readsImages: () => false,
      imageNotes: () =>
        Promise.resolve({ imageNotes: '', imageCount: 0, stopped: false }),
      save: async () => {
        saved = await started().save();
        return { reportId: saved.report.id };
      },
      startFindingRows: () => undefined,
      findingRows: () => {
        if (!saved) throw new Error('The report has not been saved');
        return parts.recordFindingSources({
          report: saved.report,
          run: (datasourceId, sql, limit) =>
            parts.runSql(datasourceId, sql, limit, runDatasets),
          signal: new AbortController().signal,
          record: (args, result) => {
            findingSources.push({
              name: 'run_readonly_sql',
              input: args,
              output: result,
              failed: failedResult(result),
            });
          },
        });
      },
      explain: async ({ dataset: name, reportId }) => {
        // The run has assessed: the block carries the stored report's
        // summary, as the turn engine's does, and `assess_data_readiness`
        // refuses (agents.md 3.13, 5.13).
        if (!saved) throw new Error('The report has not been saved');
        requestContext.set(ASSESSED_REPORT_CONTEXT_KEY, reportId);
        explained = await agent.generate(
          input as never,
          {
            ...options,
            context: [
              ...(options.context ?? []),
              {
                role: 'system',
                content: explainReportBlock({
                  dataset: name,
                  reportId,
                  summary: readinessModelOutput(saved),
                }),
              },
            ],
          } as never,
        );
        answer =
          typeof explained['text'] === 'string' ? explained['text'].trim() : '';
        return { answer, stopped: false };
      },
    };
    requestContext.set(DATA_READINESS_ASSESSMENT_RUNTIME_KEY, runtime);
    const steps: Record<string, unknown> = {};
    const created = await parts.workflow.createRun();
    const run = created.stream({
      inputData: { question: lastUserText(input).trim(), dataset },
      requestContext,
    });
    for await (const event of run.fullStream) recordStepOutput(event, steps);
    const outcome = await run.result;
    if (outcome.status === 'failed') {
      throw outcome.error instanceof Error
        ? outcome.error
        : new Error('The Assess Data Readiness run failed');
    }
    if (!explained) {
      throw new Error(
        'The Assess Data Readiness run ended before Explain report',
      );
    }
    const details: EvalRunDetails = {
      steps,
      // The summary Explain report's prompt carried (its block above).
      ...(saved
        ? {
            report: {
              ...(readinessModelOutput(saved) as Record<string, unknown>),
            },
          }
        : {}),
      findingSources,
    };
    return { ...explained, text: answer, [EVAL_DETAILS_KEY]: details };
  };
  return new Proxy(agent, {
    get(target, property): unknown {
      if (property === 'generate') return generate;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * The eval target of the `data-readiness:assessment-workflow` sets: the
 * Data Readiness Agent as its chat set has it (Block D1 orientation over
 * the set's fixture's datasource, no knowledge block, a run host bound to
 * the agent, the judge reading 12,000 characters of each tool result as
 * the model saw it), each case one whole workflow run.
 */
export function readinessWorkflowEvalTarget(
  sets: AssistantEvalSet[],
  now: () => Date = () => new Date(),
  loadAgent: () => Agent = () => dataReadinessAgent,
  wholeRun: (agent: Agent) => Agent = (agent) =>
    readinessWorkflowTurnAgent(agent),
): EvalTarget {
  const fixture = sets[0] ? findFixture(sets[0].fixtureId) : undefined;
  const datasourceName = fixture?.datasourceName ?? 'PostgreSQL';
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: 'data-readiness',
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      run ??= wholeRun((agent ??= loadAgent()));
      return run;
    },
    sets,
    sendsKnowledge: false,
    sessionAgentKey: 'data-readiness',
    judgeTraceChars: 12_000,
    judgeOutput: readinessModelOutput,
    orientation: ({ datasets, snapshots }) =>
      readinessEvalOrientation(
        datasets,
        snapshots,
        datasourceName,
        now().toISOString().slice(0, 10),
      ),
  };
}
