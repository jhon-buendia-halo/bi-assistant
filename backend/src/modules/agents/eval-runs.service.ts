import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { SessionsService } from '../sessions/sessions.service';
import { OntologyService } from '../ontology/ontology.service';
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
import { parseEvalArm } from '../../mastra/evals/memory-arm-option';
import type { EvalArm } from '../../mastra/evals/memory-case';
import { evalMemoryScope } from '../../mastra/evals/eval-memory';
import { LEARNING_STORE } from '../memory/learning-store.port';
import type { LearningStore } from '../memory/learning-store.port';

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
   * for this agent with the same datasource, datasets and memory arm,
   * computed once this run finishes. Absent when no
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
  /**
   * The arm the run measures (R231): its cross-session memory. Runs saved
   * before it read as `{ memory: 'none' }`.
   */
  arm: EvalArm;
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
  /** `{ memory }` (api.md endpoint 36); none = `{ memory: 'none' }`. */
  arm?: unknown;
}

/** A command-line run, its options already checked (agents.md 8.5). */
export interface CommandLineEvalRun {
  agentKey: string;
  /** The datasets `EVAL_DATASETS` names. */
  datasets: string[];
  caseIds: string[];
  judge: EvalJudgeSetting;
  repeats: EvalRepeats;
  /** From `EVAL_MEMORY`, its value already known (R232). */
  arm: EvalArm;
}

/** The refusal of an arm whose memory this build does not have (R232). */
function notBuilt(memory: string): string {
  return `The memory arm "${memory}" is not built in this version`;
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
    private readonly knowledge: OntologyService,
    /** Finds the memory port's store, when the build has one (R232). */
    private readonly moduleRef?: ModuleRef,
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

    // R19 step 10: the arm, no memory when none is given (R231, R232).
    const arm = parseEvalArm(options.arm);
    if ('error' in arm) return { error: arm.error };
    const memory = this.memoryFor(agentKey, arm.arm);
    if ('error' in memory) return { error: memory.error };

    const view = await this.record({
      agentKey,
      datasourceId,
      datasets: bound.map((d) => d.name),
      cases,
      judge: judge.setting,
      repeats: repeats.repeats,
      arm: arm.arm,
      source: 'app',
    });

    // Outlives the request.
    void this.run(view, cases, undefined, memory.store);
    return { jobId: view.jobId };
  }

  /**
   * Run questions on the datasets the command line names (R42, R223) and
   * wait for the run to end. The run is saved as a run started in the app
   * is, with the source `cli` and the datasource of those datasets, and
   * compared with the earlier comparable run (R40). The selection, the judge
   * option, the repeats and the memory arm's value were checked before the
   * backend booted; refused, with nothing recorded and no model called, when
   * the datasets do not cover the questions' sample (R20), the arm's memory
   * is not built or cannot run on the agent (R232), or this process already
   * runs one of the agent's runs.
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
    const memory = this.memoryFor(agentKey, request.arm);
    if ('error' in memory) return { error: memory.error };
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
      arm: request.arm,
      source: 'cli',
    });
    await this.run(view, cases, onResult, memory.store);
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
   * The store a run's attempts use under its arm (R19 step 10, R232): none
   * under `none`; refused for a memory arm on another agent than the
   * assistant, for `hindsight-mastra`, which this version does not build, and
   * for `mastra` on a build with no store for the memory port.
   */
  private memoryFor(
    agentKey: string,
    arm: EvalArm,
  ): { store?: LearningStore } | { error: string } {
    if (arm.memory === 'none') return {};
    if (agentKey !== 'assistant') {
      return { error: 'Memory arms run only on the assistant' };
    }
    if (arm.memory === 'hindsight-mastra') {
      return { error: notBuilt(arm.memory) };
    }
    const store = this.learningStore();
    return store ? { store } : { error: notBuilt(arm.memory) };
  }

  /**
   * The memory port's one store (BA-81's "Mastra only" memory), found by its
   * token in whichever module registers it; undefined on a build with no
   * provider for it. The one place the eval looks the store up.
   */
  private learningStore(): LearningStore | undefined {
    try {
      return (
        this.moduleRef?.get<LearningStore>(LEARNING_STORE, {
          strict: false,
        }) ?? undefined
      );
    } catch {
      return undefined;
    }
  }

  /**
   * A new run, in memory and in the store, holding the agent until it ends
   * (R22): its repeats, its arm, the model the agent runs on, no usage yet
   * and its source.
   */
  private async record(fields: {
    agentKey: string;
    datasourceId: string;
    datasets: string[];
    cases: AssistantEvalCase[];
    judge: EvalJudgeSetting;
    repeats: EvalRepeats;
    arm: EvalArm;
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
      arm: { ...fields.arm },
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
    /** The arm's store, under a memory arm (agents.md 8.3). */
    store?: LearningStore,
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
        // its result (pass^k, R210, R211); under a memory arm each with a
        // scope of its own (R238).
        const result = await runCaseAttempts(
          evalCase,
          view.repeats,
          (attempt) =>
            runAssistantEvalCase(
              evalCase,
              view.datasets,
              evalSession?.id,
              knowledgeBlock,
              target,
              view.judge,
              {
                model: view.model,
                ...(store
                  ? {
                      memory: {
                        store,
                        scope: evalMemoryScope(
                          view.jobId,
                          evalCase.id,
                          attempt,
                        ),
                        warn: (message: string) => this.logger.warn(message),
                      },
                    }
                  : {}),
              },
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
   * previous completed run with the same data scope, the same memory arm
   * (R246) and at least one question in common (agents-evals R40), and
   * attach the outcome to `view.comparison` —
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
        view.arm.memory,
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
