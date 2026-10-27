import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { SessionsService } from '../sessions/sessions.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';
import {
  computeRegressionDiff,
  EvalRegressionSummary,
} from './eval-regression';
import { assistantEvalDatasetError } from '../../mastra/evals/assistant-eval-datasets';
import {
  AssistantEvalCase,
  AssistantEvalCaseResult,
  EvalSession,
  cleanupEvalSession,
  createEvalSession,
  evalRunModel,
  fixtureForCases,
  runAssistantEvalCase,
  selectEvalCases,
} from '../../mastra/evals/assistant.evals';
import { evalSetsFor, evalTargetFor } from '../../mastra/evals/eval-sets';
import type { SampleFixture } from '../testing-data/fixtures/registry';
import { parseJudgeSetting } from '../../mastra/evals/judge-option';
import type { EvalJudgeSetting } from '../../mastra/evals/judge-option';
import { summarizeEvalResults } from '../../mastra/evals/eval-summary';
import type { EvalRunSummary } from '../../mastra/evals/eval-summary';
import { parseRepeats } from '../../mastra/evals/repeats-option';
import type { EvalRepeats } from '../../mastra/evals/repeats-option';
import { runCaseAttempts, sumCostUsd } from '../../mastra/evals/eval-attempts';
import { mergeUsage, ratesUsed } from '../../mastra/evals/eval-usage';
import type { ModelRate, ModelUsageEntry } from '../../mastra/evals/eval-usage';
import { getDatasetToolServices } from '../../mastra/tool-services';

export type EvalRunStatus = 'running' | 'completed' | 'failed';

/** Where a run was started (agents-evals R223). */
export type EvalRunSource = 'app' | 'cli';

export interface EvalRunView {
  jobId: string;
  agentKey: string;
  datasourceId: string;
  /**
   * Datasets bound to the datasource that the questions were scoped to; for
   * a command-line run, the datasets it names.
   */
  datasets: string[];
  /** Ids of the questions this run covers. */
  caseIds: string[];
  status: EvalRunStatus;
  /** Questions finished so far, in order. */
  results: AssistantEvalCaseResult[];
  totalCases: number;
  /** The question currently running, if any. */
  currentQuestion?: string;
  /** The attempt of `currentQuestion` in flight, 1 to `repeats` (R210). */
  currentAttempt?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  /**
   * Regression comparison against the most recent previous completed run
   * for this agent with the same datasource and datasets, computed once this
   * run finishes. Absent when no
   * previous completed run existed to compare against, and — since it was
   * added after runs were already being persisted — on older records saved
   * before this field existed; callers must treat it as optional.
   */
  comparison?: EvalRegressionSummary;
  /** Legacy attribute: stored runs carry the super admin's id (data-model 3.15). */
  ownerId?: string;
  /**
   * The run's judge option (agents-evals R144). Runs saved before it read as
   * `{ mode: 'on' }` (see `EvalRunsRepository`).
   */
  judge: EvalJudgeSetting;
  /** Attempts per question (R209); runs saved before it read as 1. */
  repeats: EvalRepeats;
  /** Router id of the model the agent runs on, resolved at start (R219). */
  model?: string;
  /**
   * The results' usage summed by agent and model (R219): empty at start,
   * absent on runs saved before usage was recorded.
   */
  usage?: ModelUsageEntry[];
  /** The results' cost in dollars; 0 at start, `null` when not priced. */
  costUsd?: number | null;
  /** The rates the cost was computed with, by model (R220). */
  rates?: Record<string, ModelRate>;
  /** The Evals tab or the command line (R223); old runs read as `app`. */
  source: EvalRunSource;
  /** Counts of the finished results, kept current while running (R148). */
  summary: EvalRunSummary;
}

/** The run options as the start request carries them, unchecked. */
export interface EvalRunOptionsInput {
  judge?: unknown;
  judgeCategories?: unknown;
  repeats?: unknown;
}

/** A command-line run, its options already checked (agents.md 8.5). */
export interface CommandLineEvalRun {
  agentKey: string;
  /** The datasets `EVAL_DATASETS` names. */
  datasets: string[];
  caseIds: string[];
  judge: EvalJudgeSetting;
  repeats: EvalRepeats;
}

/**
 * Eval runs are long (one model call per question, with tool loops), so they
 * follow the same start/poll shape as deep analysis rather than blocking an
 * HTTP request. Runs are in-memory while they run and persisted after every
 * question; the command line runs through the same service (R223).
 */
@Injectable()
export class EvalRunsService {
  private readonly logger = new Logger(EvalRunsService.name);
  private readonly runs = new Map<string, EvalRunView>();
  /**
   * One running job per agent, so a double-click cannot double-spend. Keyed
   * by agent key; it guards this process only.
   */
  private readonly active = new Map<string, string>();

  constructor(
    private readonly datasets: DatasetsRepository,
    private readonly repository: EvalRunsRepository,
    private readonly datasources: DatasourcesService,
    private readonly sessions: SessionsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** Display name for a datasource id, falling back to the id itself. */
  async datasourceName(id: string): Promise<string> {
    try {
      const all = await this.datasources.list();
      return all.find((ds) => ds.id === id)?.name ?? id;
    } catch {
      return id;
    }
  }

  /** Every run for an agent, newest first. */
  async list(agentKey: string): Promise<EvalRunView[]> {
    const stored = await this.repository.list(agentKey);
    // In-flight runs are authoritative in memory; the store lags by a question.
    return stored.map((run) => this.runs.get(run.jobId) ?? run);
  }

  async remove(jobId: string): Promise<boolean> {
    const own = this.runs.get(jobId);
    if (own?.status === 'running') return false;
    if (own) this.runs.delete(jobId);
    return (await this.repository.delete(jobId)) > 0;
  }

  /**
   * Resolve the datasource's datasets and start a run. Returns the id of the
   * already-running job instead of starting a second one.
   */
  async start(
    agentKey: string,
    datasourceId: string,
    caseIds?: string[],
    options: EvalRunOptionsInput = {},
  ): Promise<{ jobId: string } | { conflictWith: string } | { error: string }> {
    // The agent's own sets: those whose `agentKey` (default `assistant`) is it.
    const sets = evalSetsFor(agentKey);
    if (sets.length === 0) {
      return { error: `Agent "${agentKey}" has no evals to run` };
    }
    const running = this.active.get(agentKey);
    if (running) return { conflictWith: running };

    if (!datasourceId) return { error: 'Pick a datasource to run against' };

    const all = await this.datasets.list();
    const bound = all.filter((d) => d.datasourceId === datasourceId);
    if (bound.length === 0) {
      return {
        error:
          'That datasource has no datasets — create one in Datasets before running evals',
      };
    }

    const cases = selectEvalCases(caseIds, sets);
    if (cases.length === 0) {
      return { error: 'Pick at least one question to run' };
    }

    // Which sample the selected questions belong to — its registry entry owns
    // the entity list the datasets are checked against. A set bound to a
    // fixture the registry no longer has must fail the start, not run blind.
    let fixture: SampleFixture;
    try {
      fixture = fixtureForCases(caseIds, sets);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }

    const datasetError = assistantEvalDatasetError(
      bound.map((dataset) => dataset.name),
      bound,
      fixture,
    );
    if (datasetError) return { error: datasetError };

    // R19 step 8: the judge option, off when none is given (R144).
    const judge = parseJudgeSetting(options.judge, options.judgeCategories);
    if ('error' in judge) return { error: judge.error };

    // R19 step 9: the repeats, 1 when none is given (R209).
    const repeats = parseRepeats(options.repeats);
    if ('error' in repeats) return { error: repeats.error };

    const view = await this.record({
      agentKey,
      datasourceId,
      datasets: bound.map((d) => d.name),
      cases,
      judge: judge.setting,
      repeats: repeats.repeats,
      source: 'app',
    });

    // Outlives the request.
    void this.run(view, cases);
    return { jobId: view.jobId };
  }

  /**
   * Run questions on the datasets the command line names (R42, R223) and
   * wait for the run to end. The run is saved as a run started in the app
   * is, with the source `cli` and the datasource of those datasets, and
   * compared with the earlier comparable run (R40). The selection, the judge
   * option and the repeats were checked before the backend booted; refused,
   * with nothing recorded, when the datasets do not cover the questions'
   * sample (R20) or this process already runs one of the agent's runs.
   * `onResult` hears each question once all of its attempts are saved.
   */
  async runFromCommandLine(
    request: CommandLineEvalRun,
    onResult?: (result: AssistantEvalCaseResult) => void,
  ): Promise<{ run: EvalRunView } | { error: string }> {
    const { agentKey, datasets, caseIds } = request;
    const sets = evalSetsFor(agentKey);
    if (sets.length === 0) {
      return { error: `Agent "${agentKey}" has no evals to run` };
    }
    const cases = selectEvalCases(caseIds, sets);
    if (cases.length === 0) {
      return { error: 'Pick at least one question to run' };
    }
    let fixture: SampleFixture;
    try {
      fixture = fixtureForCases(caseIds, sets);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    // As a chat turn reads them, a dataset saved before datasources
    // included (the same preflight the command line always ran).
    const snapshots = await getDatasetToolServices().getDatasets(datasets);
    const datasetError = assistantEvalDatasetError(
      datasets,
      snapshots,
      fixture,
    );
    if (datasetError) return { error: datasetError };
    if (this.active.has(agentKey)) {
      return { error: 'An eval run is already in progress for this agent' };
    }

    const view = await this.record({
      agentKey,
      // The preflight passed, so every named dataset has this datasource.
      datasourceId:
        snapshots.find((dataset) => datasets.includes(dataset.name))
          ?.datasourceId ?? '',
      datasets,
      cases,
      judge: request.judge,
      repeats: request.repeats,
      source: 'cli',
    });
    await this.run(view, cases, onResult);
    return { run: view };
  }

  async status(jobId: string): Promise<EvalRunView | null> {
    return this.runs.get(jobId) ?? (await this.repository.get(jobId));
  }

  /**
   * The repeats of the run `view` was compared with, for the report's note
   * when they differ (R218); undefined with no comparison, or when that run
   * is gone.
   */
  async comparedRunRepeats(view: EvalRunView): Promise<number | undefined> {
    if (!view.comparison) return undefined;
    try {
      return (await this.status(view.comparison.previousRunId))?.repeats;
    } catch {
      return undefined;
    }
  }

  /**
   * A new run, in memory and in the store, holding the agent until it ends
   * (R22): its repeats, the model the agent runs on, no usage yet and its
   * source.
   */
  private async record(fields: {
    agentKey: string;
    datasourceId: string;
    datasets: string[];
    cases: AssistantEvalCase[];
    judge: EvalJudgeSetting;
    repeats: EvalRepeats;
    source: EvalRunSource;
  }): Promise<EvalRunView> {
    const model = await evalRunModel();
    const view: EvalRunView = {
      jobId: randomUUID(),
      agentKey: fields.agentKey,
      datasourceId: fields.datasourceId,
      datasets: fields.datasets,
      status: 'running',
      results: [],
      caseIds: fields.cases.map((evalCase) => evalCase.id),
      totalCases: fields.cases.length,
      currentQuestion: fields.cases[0]?.question,
      currentAttempt: 1,
      startedAt: new Date().toISOString(),
      judge: fields.judge,
      repeats: fields.repeats,
      ...(model ? { model } : {}),
      usage: [],
      costUsd: 0,
      source: fields.source,
      summary: summarizeEvalResults([]),
    };
    this.runs.set(view.jobId, view);
    this.active.set(view.agentKey, view.jobId);
    await this.repository.insert(view);
    return view;
  }

  private async run(
    view: EvalRunView,
    cases: AssistantEvalCase[],
    onResult?: (result: AssistantEvalCaseResult) => void,
  ): Promise<void> {
    // The agent the cases run on, with its context and clean-up (agents.md
    // 8.1); the RFP Builder tags its drafts with this run.
    const target = evalTargetFor(view.agentKey, view.jobId);
    // A throwaway session so create_visual/update_visual behave the way they
    // do in a real chat turn (see assistant.evals.ts). Best-effort: a run
    // still measures the agent without one, just with visual-tool support
    // degraded to "No session in context".
    let evalSession: EvalSession | undefined;
    try {
      evalSession = await createEvalSession(
        this.sessions,
        view.datasets,
        target.sessionAgentKey,
      );
    } catch (err) {
      this.logger.warn(
        `Could not create a throwaway session for eval run ${view.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // Same curated-knowledge block a real chat turn gets from
    // SessionsService.agentContext, computed once per run — every case in
    // the run shares the same datasets.
    const knowledgeBlock = await this.knowledge.definitionBlock(view.datasets);
    try {
      for (const [index, evalCase] of cases.entries()) {
        view.currentQuestion = evalCase.question;
        // Every attempt of this question, one after another, folded into
        // its result (pass^k, R210, R211).
        const result = await runCaseAttempts(
          evalCase,
          view.repeats,
          () =>
            runAssistantEvalCase(
              evalCase,
              view.datasets,
              evalSession?.id,
              knowledgeBlock,
              target,
              view.judge,
              { model: view.model },
            ),
          (attempt) => {
            view.currentAttempt = attempt;
          },
        );
        view.results.push(result);
        view.usage = mergeUsage(view.usage, result.usage);
        view.costUsd = sumCostUsd(view.results.map((each) => each.costUsd));
        view.rates = ratesUsed(view.usage);
        view.summary = summarizeEvalResults(view.results);
        view.currentQuestion = cases[index + 1]?.question;
        view.currentAttempt = view.currentQuestion ? 1 : undefined;
        // Persist as we go so a crash mid-suite still leaves the finished
        // questions on the run.
        await this.repository.save(view);
        onResult?.(result);
      }
      view.status = 'completed';
      await this.attachRegressionComparison(view);
    } catch (err) {
      view.status = 'failed';
      view.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Eval run ${view.jobId} failed: ${view.error}`);
    } finally {
      view.currentQuestion = undefined;
      view.currentAttempt = undefined;
      view.finishedAt = new Date().toISOString();
      this.active.delete(view.agentKey);
      await this.repository.save(view);
      // The agent's own clean-up: the RFP Builder's drafts of this run.
      await target.finish?.(view.datasets);
      await cleanupEvalSession(this.sessions, evalSession);
    }
  }

  /**
   * Diff this run's per-case results against the agent's most recent
   * previous completed run with the same data scope and at least one question
   * in common (agents-evals R40), and attach the outcome to `view.comparison` —
   * best-effort, so a repository hiccup here degrades the report (no
   * comparison section) rather than marking an otherwise-successful run
   * failed. The verdicts compared are the folded ones (pass^k), whatever the
   * repeats of the two runs (R211).
   */
  private async attachRegressionComparison(view: EvalRunView): Promise<void> {
    try {
      const previous = await this.repository.mostRecentCompleted(
        view.agentKey,
        view.jobId,
        view.datasourceId,
        view.datasets,
        Array.from(
          new Set([
            ...view.caseIds,
            ...view.results.map((result) => result.id),
          ]),
        ),
      );
      if (!previous) return;
      const diff = computeRegressionDiff(previous.results, view.results);
      view.comparison = { previousRunId: previous.jobId, ...diff };
    } catch (err) {
      this.logger.warn(
        `Could not compute regression comparison for eval run ${view.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
