import { Inject, Injectable } from '@nestjs/common';
import { OWNED_EVAL_RUNS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { EvalRunView } from '../eval-runs.service';
import type { AssistantEvalPath } from '../../../mastra/evals/assistant.evals';

/** Past and in-flight eval runs, newest first; owner-scoped (data-model 3.15). */
@Injectable()
export class EvalRunsRepository {
  constructor(
    @Inject(OWNED_EVAL_RUNS_STORE)
    private readonly store: DocStore<EvalRunView>,
  ) {}

  list(agentKey: string): Promise<EvalRunView[]> {
    return this.store.find({ agentKey }, { sort: { startedAt: -1 } });
  }

  get(jobId: string): Promise<EvalRunView | null> {
    return this.store.findOne({ jobId });
  }

  /**
   * The most recently completed run for this agent, path and data scope,
   * excluding `excludeJobId`. Regression tracking diffs a finishing run
   * against this baseline, so a `model` run is only ever compared with a
   * `model` run and a `legacy` run with a `legacy` run; a run saved before
   * paths existed counts as `model` (agents-evals R40). `null` when no
   * comparable completed run exists.
   */
  async mostRecentCompleted(
    agentKey: string,
    excludeJobId: string,
    datasourceId: string,
    datasets: string[],
    path: AssistantEvalPath = 'model',
  ): Promise<EvalRunView | null> {
    const completed = await this.store.find(
      { agentKey, status: 'completed', datasourceId },
      { sort: { startedAt: -1 } },
    );
    const scope = new Set(datasets);
    return (
      completed.find(
        (run) =>
          run.jobId !== excludeJobId &&
          (run.path ?? 'model') === path &&
          new Set(run.datasets).size === scope.size &&
          run.datasets.every((dataset) => scope.has(dataset)),
      ) ?? null
    );
  }

  insert(run: EvalRunView): Promise<EvalRunView> {
    return this.store.insert(run);
  }

  /** Runs are rewritten wholesale as each question lands. */
  save(run: EvalRunView): Promise<EvalRunView | null> {
    return this.store.update({ jobId: run.jobId }, run, { upsert: true });
  }

  delete(jobId: string): Promise<number> {
    return this.store.deleteOne({ jobId });
  }
}
