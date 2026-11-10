import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ReadinessProgressListener } from '../../modules/data-readiness/progress';
import type { ReadinessReport } from '../../modules/data-readiness/engine/types';
import {
  getReadinessToolServices,
  type ReadinessReportList,
  type ReadinessToolReport,
} from '../readiness-tool-services';
import { askClarificationTool } from './clarification.tool';
import { describeEntityTool, runReadOnlySqlTool } from './dataset.tools';
import { showInPanelTool } from './panel.tool';
import { SESSION_ID_CONTEXT_KEY } from './visual.tools';

/**
 * The Data Readiness Agent's tools (agents.md 3.13, ADR-0031). They call the
 * readiness tool-services bridge, which profiles the dataset's datasource and
 * runs the deterministic engine on the server; none of them runs SQL, and
 * none throws to the model: every failure comes back as `{ error }`, its text
 * the bridge's Error message.
 *
 * Result shape (what the orchestrator sees vs. what the model sees):
 * - `assess_data_readiness` and `get_readiness_report` return the bridge's
 *   `{ summary, report }` (`ReadinessToolReport`) as the tool's raw result.
 *   That raw result is what the stream's `tool-result` chunk carries
 *   (`chunk.payload.result`), so the session orchestrator reads the full
 *   report from it with `readinessReportFromToolResult` (stream event and
 *   panel item, agents.md 2.10).
 * - The model never sees `report`: each tool's `toModelOutput` hands it only
 *   the `summary` (`ReadinessSummary`, agents.md 3.13). Mastra stores that
 *   projection with the message (`providerMetadata.mastra.modelOutput`), so
 *   memory replay on later turns sends the summary too, never the findings.
 * - Anything else that shows a tool result to a model (the tool-only
 *   synthesis pass, an eval judge) uses `readinessModelOutput` to get the
 *   same projection.
 * - `list_readiness_reports` returns the list as is; `{ error }` is unchanged.
 */

/** The ids of the tools whose raw result carries a full report. */
export const READINESS_REPORT_TOOLS: ReadonlySet<string> = new Set([
  'assess_data_readiness',
  'get_readiness_report',
]);

type Failure = { error: string };
type Context = { get: (key: string) => unknown };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The session id on the requestContext, or undefined. */
function sessionIdOf(context: Context | undefined): string | undefined {
  const value = context?.get(SESSION_ID_CONTEXT_KEY);
  return typeof value === 'string' && value ? value : undefined;
}

/** An optional scalar input: trimmed, and undefined when blank. */
function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Run one bridge call for the session in context; a missing session, an
 * uninstalled bridge and every thrown Error become `{ error }`.
 */
async function withSession<T>(
  context: Context | undefined,
  call: (sessionId: string) => Promise<T>,
): Promise<T | Failure> {
  const sessionId = sessionIdOf(context);
  if (!sessionId) return { error: 'No session in context' };
  try {
    return await call(sessionId);
  } catch (err) {
    // An aborted turn is not a tool failure: let the abort propagate.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return { error: message(err) };
  }
}

/**
 * The full report a successful `assess_data_readiness` or
 * `get_readiness_report` call produced, from its raw tool result; undefined
 * for an error or any other shape. The session orchestrator calls it on the
 * `tool-result` chunk (unit 10, BA-261).
 */
export function readinessReportFromToolResult(
  result: unknown,
): ReadinessReport | undefined {
  if (!isObject(result) || 'error' in result) return undefined;
  const report = result['report'];
  if (!isObject(report) || typeof report['id'] !== 'string') return undefined;
  return report as unknown as ReadinessReport;
}

/**
 * What the model sees of a readiness tool's raw result: the `summary` of a
 * report result, anything else (a list, `{ error }`) unchanged.
 */
export function readinessModelOutput(result: unknown): unknown {
  if (
    isObject(result) &&
    !('error' in result) &&
    isObject(result['summary']) &&
    'report' in result
  ) {
    return result['summary'];
  }
  return result;
}

/** `toModelOutput` in the AI SDK's tool-result output shape. */
function toModelJson(result: unknown): { type: 'json'; value: unknown } {
  return { type: 'json', value: readinessModelOutput(result) };
}

/** The stream chunk type of an assessment's live progress (BA-324). */
export const READINESS_PROGRESS_CHUNK = 'data-readiness-progress';

type ProgressWriter = {
  custom?: (chunk: {
    type: string;
    data: unknown;
    transient?: boolean;
  }) => Promise<void> | void;
};

/**
 * A progress listener that writes to the tool's stream writer as a transient
 * data chunk (streamed, not stored with the message). A failing writer never
 * fails the assessment.
 */
function progressListener(
  writer: ProgressWriter | undefined,
): ReadinessProgressListener | undefined {
  if (!writer || typeof writer.custom !== 'function') return undefined;
  return (progress) => {
    try {
      void Promise.resolve(
        writer.custom?.({
          type: READINESS_PROGRESS_CHUNK,
          data: progress,
          transient: true,
        }),
      ).catch(() => undefined);
    } catch {
      // Progress is best effort.
    }
  };
}

const datasetInput = () =>
  z
    .string()
    .optional()
    .describe(
      "Name of one of this session's datasets; leave it out when the session has only one",
    );

export const assessDataReadinessTool = createTool({
  id: 'assess_data_readiness',
  description:
    "Run a new data-readiness assessment of one of this session's datasets and store the report. It profiles the dataset's tables and scores them on the DMBOK dimensions with the deterministic engine; it returns the overall score and band, every dimension's score and the most severe findings.",
  inputSchema: z.object({ dataset: datasetInput() }),
  execute: ({ dataset }, ctx) =>
    withSession<ReadinessToolReport>(ctx.requestContext, (sessionId) =>
      getReadinessToolServices().assessReadiness({
        sessionId,
        datasetName: optional(dataset),
        signal: ctx.abortSignal,
        onProgress: progressListener(ctx.writer),
      }),
    ),
  toModelOutput: toModelJson,
});

export const getReadinessReportTool = createTool({
  id: 'get_readiness_report',
  description:
    "Read a stored readiness report: the newest for a dataset's datasource, or one by id. Pass reportId from list_readiness_reports for an earlier report; it returns the same summary as assess_data_readiness and runs nothing.",
  inputSchema: z.object({
    reportId: z
      .string()
      .optional()
      .describe(
        'Id of a stored report, from list_readiness_reports; leave it out for the newest',
      ),
    dataset: datasetInput(),
  }),
  execute: ({ reportId, dataset }, { requestContext }) =>
    withSession<ReadinessToolReport>(requestContext, (sessionId) =>
      getReadinessToolServices().getReadinessReport({
        sessionId,
        reportId: optional(reportId),
        datasetName: optional(dataset),
      }),
    ),
  toModelOutput: toModelJson,
});

export const listReadinessReportsTool = createTool({
  id: 'list_readiness_reports',
  description:
    "List the stored readiness reports of a dataset's datasource, newest first. Each row has the report id, when it ran, its overall score, band and entity count.",
  inputSchema: z.object({ dataset: datasetInput() }),
  execute: ({ dataset }, { requestContext }) =>
    withSession<ReadinessReportList>(requestContext, (sessionId) =>
      getReadinessToolServices().listReadinessReports({
        sessionId,
        datasetName: optional(dataset),
      }),
    ),
});

/**
 * Every tool the Data Readiness Agent is given, in the order of agents.md
 * 2.10: the three readiness tools, then `show_in_panel` and
 * `ask_clarification`.
 */
export const readinessTools = {
  assess_data_readiness: assessDataReadinessTool,
  get_readiness_report: getReadinessReportTool,
  list_readiness_reports: listReadinessReportsTool,
  // Drill-down into findings (ADR-0035): the shared, session-scoped,
  // read-only dataset tools. They never touch a score.
  describe_entity: describeEntityTool,
  run_readonly_sql: runReadOnlySqlTool,
  show_in_panel: showInPanelTool,
  ask_clarification: askClarificationTool,
};
