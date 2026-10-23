import { Inject, Injectable } from '@nestjs/common';
import { EVAL_RUNS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { EvalRunView } from '../eval-runs.service';
import { LEGACY_JUDGE_SETTING } from '../../../mastra/evals/judge-option';
import { LEGACY_REPEATS } from '../../../mastra/evals/repeats-option';
import {
  summarizeEvalResults,
  withResultDefaults,
} from '../../../mastra/evals/eval-summary';
import type { StoredEvalCaseResult } from '../../../mastra/evals/eval-summary';
import type { EvalSplit } from '../../../mastra/evals/eval-set-files';
import { evalCaseIndex } from '../../../mastra/evals/eval-case-index';

/**
 * A run as the store may hold it: one saved before BA-184 has no judge
 * option, no summary and no statuses; one saved before BA-242 has no
 * repeats, no source, no usage and no split on its results (data-model 3.8).
 */
export type StoredEvalRun = Omit<
  EvalRunView,
  'judge' | 'summary' | 'results' | 'repeats' | 'source'
> & {
  judge?: EvalRunView['judge'];
  summary?: EvalRunView['summary'];
  results?: StoredEvalCaseResult[];
  repeats?: EvalRunView['repeats'];
  source?: EvalRunView['source'];
};

/** The split of the question bank case with this id, if there is one. */
function questionBankSplit(caseId: string): EvalSplit | undefined {
  return evalCaseIndex().get(caseId)?.split;
}

/**
 * A stored run with the read-time defaults of data-model 3.8 (no migration):
 * judged when it has no option, statuses from each `passed` flag (R144,
 * R147); one attempt per question and the source `app` when it has neither,
 * and each result's split from `splitOf`, by default the question bank's,
 * else `dev` (R209, R215, R223); and the summary recomputed from the results
 * (R148, R213). Usage stays absent on a run saved before it was recorded.
 */
export function withEvalRunDefaults(
  run: StoredEvalRun,
  splitOf: (caseId: string) => EvalSplit | undefined = questionBankSplit,
): EvalRunView {
  const results = (run.results ?? []).map((result) =>
    withResultDefaults(result, splitOf),
  );
  return {
    ...run,
    results,
    judge: run.judge ?? { ...LEGACY_JUDGE_SETTING },
    repeats: run.repeats ?? LEGACY_REPEATS,
    source: run.source ?? 'app',
    summary: summarizeEvalResults(results),
  };
}

/** Past and in-flight eval runs, newest first. */
@Injectable()
export class EvalRunsRepository {
  constructor(
    @Inject(EVAL_RUNS_STORE)
    private readonly store: DocStore<EvalRunView>,
  ) {}

  async list(agentKey: string): Promise<EvalRunView[]> {
    const runs: StoredEvalRun[] = await this.store.find(
      { agentKey },
      { sort: { startedAt: -1 } },
    );
    return runs.map((run) => withEvalRunDefaults(run));
  }

  async get(jobId: string): Promise<EvalRunView | null> {
    const run: StoredEvalRun | null = await this.store.findOne({ jobId });
    return run ? withEvalRunDefaults(run) : null;
  }

  /**
   * The most recently completed run for this agent and data scope that
   * shares at least one question id with `questionIds`, excluding
   * `excludeJobId`. Regression tracking diffs a finishing run against this
   * baseline (agents-evals R40). A run of another set on the same datasource
   * and datasets (`world-cup-databricks` and `world-cup-databricks-only`) has
   * no question in common, so it would skip every question; it is not
   * comparable. `null` when no comparable completed run exists.
   */
  async mostRecentCompleted(
    agentKey: string,
    excludeJobId: string,
    datasourceId: string,
    datasets: string[],
    questionIds: string[],
  ): Promise<EvalRunView | null> {
    const completed: StoredEvalRun[] = await this.store.find(
      { agentKey, status: 'completed', datasourceId },
      { sort: { startedAt: -1 } },
    );
    const scope = new Set(datasets);
    const questions = new Set(questionIds);
    const baseline = completed.find(
      (run) =>
        run.jobId !== excludeJobId &&
        new Set(run.datasets).size === scope.size &&
        run.datasets.every((dataset) => scope.has(dataset)) &&
        [
          ...(run.caseIds ?? []),
          ...(run.results ?? []).map((result) => result.id),
        ].some((id) => questions.has(id)),
    );
    return baseline ? withEvalRunDefaults(baseline) : null;
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
