import { randomUUID } from 'node:crypto';
import type { EvalRunView } from '../../modules/agents/eval-runs.service';
import { computeRegressionDiff } from '../../modules/agents/eval-regression';
import type { AssistantEvalCaseResult } from './assistant.evals';

/** What a run records when no model is saved (data-model 3.2). */
const FALLBACK_PROVIDER = 'openai';
const FALLBACK_MODEL = 'gpt-4o-mini';

/** The provider and model a run records, from the saved LLM settings view. */
export function savedLlmLabel(view: {
  provider?: string | null;
  model?: string | null;
}): { provider: string; model: string } {
  return {
    provider: view.provider ?? FALLBACK_PROVIDER,
    model: view.model ?? FALLBACK_MODEL,
  };
}

/** The slice of the eval-run store and datasets the recorder needs. */
export interface CliRunStore {
  insert(run: EvalRunView): Promise<unknown>;
  save(run: EvalRunView): Promise<unknown>;
  mostRecentCompleted(
    agentKey: string,
    excludeJobId: string,
    datasourceId: string,
    datasets: string[],
  ): Promise<EvalRunView | null>;
}

export interface CliRunInput {
  agentKey: string;
  /** Dataset names the run was scoped to. */
  datasets: string[];
  caseIds: string[];
  setId: string | null;
  provider: string;
  model: string;
  /** Every saved dataset, to find the datasource the names belong to. */
  datasetList: { name: string; datasourceId?: string }[];
}

export interface CliRun {
  /** The eval run id; also the trace marker passed to the runner. */
  jobId: string;
  add(result: AssistantEvalCaseResult): Promise<void>;
  finish(error?: string): Promise<void>;
}

/** The datasets' one shared datasource, else `""` (agents-evals R113). */
export function cliDatasourceId(
  names: string[],
  list: { name: string; datasourceId?: string }[],
): string {
  const ids = new Set(
    list
      .filter((d) => names.includes(d.name) && d.datasourceId)
      .map((d) => d.datasourceId as string),
  );
  return ids.size === 1 ? [...ids][0] : '';
}

/**
 * Saves a CLI eval run like the app does. The record is inserted on the first
 * finished question, so a refusal before any question leaves nothing; each
 * further question saves; `finish` completes it with the regression diff.
 */
export function cliRun(store: CliRunStore, input: CliRunInput): CliRun {
  const view: EvalRunView = {
    jobId: randomUUID(),
    agentKey: input.agentKey,
    datasourceId: cliDatasourceId(input.datasets, input.datasetList),
    datasets: input.datasets,
    caseIds: input.caseIds,
    status: 'running',
    results: [],
    totalCases: input.caseIds.length,
    startedAt: new Date().toISOString(),
    setId: input.setId,
    provider: input.provider,
    model: input.model,
    source: 'cli',
  };
  let inserted = false;
  return {
    jobId: view.jobId,
    async add(result) {
      view.results.push(result);
      if (inserted) await store.save(view);
      else {
        await store.insert(view);
        inserted = true;
      }
    },
    async finish(error) {
      if (!inserted) return;
      view.status = error ? 'failed' : 'completed';
      if (error) view.error = error;
      view.finishedAt = new Date().toISOString();
      if (!error) {
        try {
          const previous = await store.mostRecentCompleted(
            view.agentKey,
            view.jobId,
            view.datasourceId,
            view.datasets,
          );
          if (previous) {
            view.comparison = {
              previousRunId: previous.jobId,
              ...computeRegressionDiff(previous.results, view.results),
            };
          }
        } catch {
          // Best-effort, as in the app: no comparison, run still completed.
        }
      }
      await store.save(view);
    },
  };
}
