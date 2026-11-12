/**
 * A run of the `deep-analysis` workflow (agents.md 5.15; plan 1.25.3): the
 * runtime its steps call through (the assistant's three calls on the run
 * host, the run workspace the report is stored in), and what the stored run
 * keeps of it: the executive summary as its answer, with the report's
 * reference, and the report as a file of the run.
 */
import { RequestContext } from '@mastra/core/request-context';
import type { MastraService } from '../../mastra/mastra.service';
import {
  DEEP_ANALYSIS_RUNTIME_KEY,
  type AssembledReport,
  type DeepAnalysisRuntime,
} from '../../mastra/workflows/deep-analysis.steps';
import {
  investigateAngle,
  planAnalysis,
  writeAnalysis,
  type DeepAnalysisCallDeps,
} from '../deep-analysis/deep-analysis.calls';
import type {
  ChatMessage,
  FilePanelItem,
  SessionDoc,
} from '../sessions/entities/session.entity';

/** What the run code needs: the assistant calls' seams and the workspace. */
export interface DeepAnalysisRunDeps extends DeepAnalysisCallDeps {
  mastra: Pick<MastraService, 'getAgent' | 'ensureSessionWorkspace'>;
}

/** The id of the report's file item in the run (api.md 125, 126). */
export const DEEP_ANALYSIS_REPORT_ITEM_ID = 'deep-analysis-report';

/** The message a stopped deep analysis fails its running step with. */
export const DEEP_ANALYSIS_STOPPED = 'The run was stopped';

/**
 * The runtime of one run, on the run host `host`: the assistant's calls as
 * the chat's deep analysis makes them (memory-free, grounded on the host's
 * datasets), and the report written into the host's workspace. `stored()`
 * answers the report's size once Assemble stored it.
 */
export function deepAnalysisRuntime(
  deps: DeepAnalysisRunDeps,
  host: SessionDoc,
  runId: string,
  abortSignal?: AbortSignal,
): { runtime: DeepAnalysisRuntime; stored: () => number | undefined } {
  let bytes: number | undefined;
  const live = () => {
    if (abortSignal?.aborted) throw new Error(DEEP_ANALYSIS_STOPPED);
  };
  const runtime: DeepAnalysisRuntime = {
    reportId: runId,
    plan: (question) => {
      live();
      return planAnalysis(deps, host, question, abortSignal);
    },
    investigate: ({ question, angle, index, total }) => {
      live();
      return investigateAngle(
        deps,
        host,
        question,
        angle,
        index,
        total,
        abortSignal,
      );
    },
    write: ({ question, findings }) => {
      live();
      return writeAnalysis(deps, host, question, findings, abortSignal);
    },
    store: async (path, markdown) => {
      live();
      const workspace = await deps.mastra.ensureSessionWorkspace(
        host.id,
        host.name,
      );
      if (!workspace.filesystem) {
        throw new Error('run workspace has no filesystem');
      }
      await workspace.filesystem.writeFile(path, markdown);
      bytes = Buffer.byteLength(markdown, 'utf8');
    },
  };
  return { runtime, stored: () => bytes };
}

/** The RequestContext a run's engine run carries its runtime on. */
export function deepAnalysisContext(
  runtime: DeepAnalysisRuntime,
): RequestContext {
  const context = new RequestContext();
  context.set(DEEP_ANALYSIS_RUNTIME_KEY, runtime);
  return context;
}

/** Assemble's output, when the run's output is one. */
export function assembledReportOf(
  output: Record<string, unknown> | undefined,
): AssembledReport | undefined {
  if (
    !output ||
    typeof output['title'] !== 'string' ||
    typeof output['executiveSummary'] !== 'string' ||
    typeof output['path'] !== 'string' ||
    typeof output['angles'] !== 'number'
  ) {
    return undefined;
  }
  return {
    title: output['title'],
    executiveSummary: output['executiveSummary'],
    path: output['path'],
    angles: output['angles'],
  };
}

/**
 * What a finished run keeps of its report (R13 for a run): an answer whose
 * content is the executive summary, carrying the report's reference (the run
 * id as its key), and the report as a file item of the run, downloaded
 * through the run's routes.
 */
export function deepAnalysisRunAnswer(
  runId: string,
  report: AssembledReport,
  bytes: number,
  at: string,
): { answer: ChatMessage; panelItems: FilePanelItem[] } {
  return {
    answer: {
      role: 'assistant',
      content: report.executiveSummary,
      at,
      report: {
        jobId: runId,
        title: report.title,
        path: report.path,
        angles: report.angles,
      },
    },
    panelItems: [
      {
        id: DEEP_ANALYSIS_REPORT_ITEM_ID,
        kind: 'file',
        title: report.title,
        shownAt: at,
        path: report.path,
        bytes,
      },
    ],
  };
}
