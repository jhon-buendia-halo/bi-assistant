import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { SessionsService } from '../sessions/sessions.service';
import type { SidePass } from '../sessions/turn-result';
import { EngineSettingsService } from '../engine/engine-settings.service';
import {
  engineConfigHash,
  resolveEngineOptions,
} from '../engine/engine-options';
import type { EngineOptions } from '../engine/engine-options';
import { LlmService } from '../llm/llm.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';
import {
  computeRegressionDiff,
  EvalRegressionSummary,
} from './eval-regression';
import {
  DEFAULT_SUITE_ID,
  expandVariants,
  loadSuite,
  suiteDatasetError,
  suiteForCases,
} from '../../mastra/evals/suite-loader';
import type {
  EvalSuite,
  SqlDialect,
  SuiteEvalCase,
} from '../../mastra/evals/suite-loader';
import {
  agentModelId,
  lastAgentModelId,
  resolveAgentModel,
} from '../../mastra/model-resolver';
import {
  addUsage,
  emptyUsage,
  estimateCostUsd,
  STOPPED_ATTEMPT_ERROR,
  summarizeCases,
  tallyCategories,
} from './eval-telemetry';
import type {
  CategoryTally,
  EvalRunLogCaseV2,
  EvalRunStatus as LogRunStatus,
  EvalRunSummary,
  PricingTable,
  TokenUsage,
} from './eval-telemetry';
import { loadPricing, writeRunLog } from './eval-run-log';
import { buildRunLogRecordV2, runEnvironment } from './eval-run-record';
import {
  mergeEngineOverrides,
  runAssistantEvalCaseRepeated,
} from '../../mastra/evals/assistant.evals';
import type {
  AssistantEvalCaseResult,
  EvalCaseOutcome,
} from '../../mastra/evals/assistant.evals';
import { resetResultSetCheckWarnings } from '../../mastra/evals/result-set-check';

/**
 * `queued` = waiting behind another run (one worker drains the queue);
 * `failed` covers a crash, a stop while running and a stop while queued —
 * `error` says which.
 */
export type EvalRunStatus = 'queued' | 'running' | 'completed' | 'failed';

/** The repeat counts pass^k is reported at (engineering plan §4). */
export const EVAL_REPEATS: readonly number[] = [1, 3, 5];

/** `error` of a run the operator stopped while it was running. */
export const STOPPED_BY_OPERATOR = 'Stopped by the operator';
/** `error` of a queued run the operator removed before it started. */
export const STOPPED_BEFORE_START = 'Stopped before it started';
/** `error` of a stored queued/running run whose backend is gone. */
export const INTERRUPTED_BY_RESTART =
  'Interrupted — the backend stopped before this run finished';

/** A Loop is capped so a mis-click cannot queue days of paid runs. */
const MAX_LOOP_JOBS = 60;
const MAX_LABEL_CHARS = 80;

/** `POST /agents/:key/evals/run`, as the service takes it. */
export interface EvalRunRequest {
  datasourceId: string;
  /** The questions to run; absent = every question in the suite. */
  caseIds?: string[];
  /** Which suite; the shipped World Cup one when unspecified. */
  suiteId?: string;
  /** Datasets to run against. Defaults to the suite's own. */
  datasets?: string[];
  /** Attempts per question: 1, 3 or 5 (default 1). */
  repeat?: number;
  /** Operator tag for the run log, e.g. `baseline` or `iter-2-guards`. */
  label?: string;
  /**
   * An `ARM_PRESETS` name, `custom:{json}`, or `custom` (overrides come from
   * `engine` alone). Absent = `baseline` (production defaults).
   */
  arm?: string;
  /** Explicit lever overrides, applied over the arm's preset. */
  engine?: Partial<EngineOptions>;
  /** Also run each case's paraphrase variants (`<id>~vN`). */
  includeVariants?: boolean;
  /** Only the cases in these categories (empty/absent = every category). */
  categories?: string[];
}

/** `POST /agents/:key/evals/loop`: one queued run per suite × arm. */
export interface EvalLoopRequest {
  datasourceId: string;
  suiteIds: string[];
  repeat?: number;
  arms: string[];
  label?: string;
  includeVariants?: boolean;
  categories?: string[];
}

export type EvalLoopStatus = 'running' | 'completed' | 'failed';

/** One cell of a loop's suite × arm matrix. */
export interface EvalLoopSummaryRow {
  jobId: string;
  status: EvalRunStatus;
  suite: string;
  arm: string;
  model?: string;
  repeat: number;
  passK: number;
  scored: number;
  passKRate: number;
  meanPassRate: number;
  flaky: number;
  gaps: number;
  tokens: number;
  costUsd?: number;
  costPerCorrectUsd?: number;
  /** Run-log filename, once the run has been logged. */
  file?: string;
}

export interface EvalLoopView {
  loopId: string;
  status: EvalLoopStatus;
  jobs: EvalRunView[];
  summary: { rows: EvalLoopSummaryRow[] };
}

export interface EvalRunView {
  jobId: string;
  agentKey: string;
  /**
   * The suite the questions came from. Records written before suites existed
   * have neither field; every reader treats a missing `suiteId` as the
   * shipped `world-cup` suite, which is what those runs actually ran.
   */
  suiteId: string;
  /** The suite's display name, denormalised so a report needs no lookup. */
  suiteName: string;
  datasourceId: string;
  /** Datasets bound to the datasource that the questions were scoped to. */
  datasets: string[];
  /** Ids of the questions this run covers (variant ids included). */
  caseIds: string[];
  status: EvalRunStatus;
  /**
   * Questions finished so far, in order: one representative entry per case
   * (the first non-PASS attempt, else attempt 1) carrying the case's pass^k
   * verdict and every attempt.
   */
  results: AssistantEvalCaseResult[];
  totalCases: number;
  /** The question currently running, if any. */
  currentQuestion?: string;
  error?: string;
  /** When the run started executing (when it was queued, until then). */
  startedAt: string;
  finishedAt?: string;
  /**
   * Regression comparison against the most recent previous completed run
   * for this agent with the same suite, datasource and datasets, computed
   * once this run finishes. Absent when no previous completed run existed
   * to compare against, and on older records saved before this field
   * existed; callers must treat it as optional.
   */
  comparison?: EvalRegressionSummary;
  /**
   * Tokens the whole run spent, summed over its cases (turn + side passes +
   * LLM judge). Absent on runs recorded before token accounting existed, and
   * `calls: 0` when the provider reported nothing — which is not free.
   */
  usage?: TokenUsage;
  /**
   * Dollars, from `logs/pricing.json`. Absent when the model that ran has no
   * rate configured: an unpriced run reports exact token counts rather than a
   * confident wrong number.
   */
  estimatedCostUsd?: number;
  /** The model id the run actually resolved to, e.g. `openai/gpt-4o-mini`. */
  model?: string;
  /** Pass rate per failure class (pass^k verdicts; GAP/SKIP not counted). */
  categories?: Record<string, CategoryTally>;

  /*
   * Everything below was added with pass^k and the engine levers; runs
   * recorded before then lack it (read `repeat` as 1).
   */
  /** Attempts per case. */
  repeat?: number;
  label?: string;
  /** Arm preset name, `custom:{json}` or `custom`. */
  arm?: string;
  /** The overrides the run asked for (arm preset + explicit `engine`). */
  engineOverrides?: Partial<EngineOptions>;
  /** The levers the turns actually ran with, resolved (from `TurnResult.engine`). */
  engine?: EngineOptions;
  configHash?: string;
  /** The judge's router id, when a judge ran or one is pinned. */
  judgeModel?: string;
  reasoningEffort?: string;
  /** SQL dialect of the datasource (`referenceSqlFor`). */
  dialect?: SqlDialect;
  /** The Loop this run is one cell of. */
  loopId?: string;
  /** Position within its loop (suite-major). */
  loopIndex?: number;
  /** When the run was queued. */
  queuedAt?: string;
  includeVariants?: boolean;
  /** Category filter the cases were selected with. */
  categoryFilter?: string[];
  /** Live pass^k headline — updated after every case. */
  summary?: EvalRunSummary;
  /** The side passes' share of `usage` (grounding, synthesis, review, …). */
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  /** Run-log filename under `logs/evals/` (`GET …/evals/logs/:file`). */
  logFile?: string;
}

/** A validated run, ready to queue. */
interface PreparedRun {
  agentKey: string;
  datasourceId: string;
  suite: EvalSuite;
  cases: SuiteEvalCase[];
  scoped: DatasetDoc[];
  repeat: number;
  arm: string;
  engineOverrides: Partial<EngineOptions>;
  dialect?: SqlDialect;
  label?: string;
  includeVariants: boolean;
  categories?: string[];
}

type PrepareResult = PreparedRun | { error: string; emptySelection?: boolean };

/** A queued or running run, with what only the worker needs. */
interface EvalJob {
  view: EvalRunView;
  suite: EvalSuite;
  cases: SuiteEvalCase[];
  engineOverrides: Partial<EngineOptions>;
  controller: AbortController;
  /** Settings → LLM reasoning effort, read when the run started. */
  settingsEffort?: string;
  captured: { engine: boolean; configHash: boolean; judgeModel: boolean };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function addSidePasses(
  total: Partial<Record<SidePass, TokenUsage>>,
  more: Partial<Record<SidePass, TokenUsage>> | undefined,
): void {
  for (const [pass, usage] of Object.entries(more ?? {}) as [
    SidePass,
    TokenUsage | undefined,
  ][]) {
    if (!usage) continue;
    const sofar = total[pass];
    total[pass] = sofar ? addUsage(sofar, usage) : usage;
  }
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Eval runs are long (one production turn per attempt, with tool loops), so
 * they follow the same start/poll shape as deep analysis rather than
 * blocking an HTTP request. One worker drains a FIFO queue, so a second
 * start — or a Loop of suite × arm runs — waits its turn instead of racing
 * the first for the datasource and the model. Runs are in-memory: a backend
 * restart forgets the queue (the stored records stay; `stop` clears them).
 */
@Injectable()
export class EvalRunsService {
  private readonly logger = new Logger(EvalRunsService.name);
  private readonly runs = new Map<string, EvalRunView>();
  private readonly queue: EvalJob[] = [];
  private current?: EvalJob;
  private draining?: Promise<void>;
  private readonly loops = new Map<string, string[]>();

  constructor(
    private readonly datasets: DatasetsRepository,
    private readonly repository: EvalRunsRepository,
    private readonly datasources: DatasourcesService,
    private readonly sessions: SessionsService,
    private readonly engineSettings: EngineSettingsService,
    private readonly llm: LlmService,
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
    const live = this.runs.get(jobId);
    if (live && (live.status === 'running' || live.status === 'queued')) {
      return false;
    }
    this.runs.delete(jobId);
    return (await this.repository.delete(jobId)) > 0;
  }

  async status(jobId: string): Promise<EvalRunView | null> {
    return this.runs.get(jobId) ?? (await this.repository.get(jobId));
  }

  /** Resolves once the queue is empty and nothing is running (tests, shutdown). */
  async whenIdle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /**
   * Validate a run and queue it. Returns its job id, and whether it has to
   * wait behind another run.
   */
  async start(
    agentKey: string,
    request: EvalRunRequest,
  ): Promise<{ jobId: string; queued: boolean } | { error: string }> {
    const prepared = await this.prepare(agentKey, request);
    if ('error' in prepared) return { error: prepared.error };
    const view = this.createView(prepared, {});
    await this.repository.insert(view);
    const queued = this.busy();
    this.enqueue([this.jobFor(view, prepared)]);
    return { jobId: view.jobId, queued };
  }

  /**
   * Queue one run per suite × arm, suite-major (every arm of the first
   * suite, then the next suite), all tagged with one `loopId`. Validated as
   * a whole: one bad arm or suite queues nothing. A suite with no case in
   * the requested categories is skipped rather than failing the loop.
   */
  async startLoop(
    agentKey: string,
    request: EvalLoopRequest,
  ): Promise<
    { loopId: string; jobIds: string[]; skipped: string[] } | { error: string }
  > {
    if (agentKey !== 'assistant') {
      return { error: `Agent "${agentKey}" has no evals to run` };
    }
    if (!request?.datasourceId) {
      return { error: 'Pick a datasource to run against' };
    }
    const suiteIds = uniqueStrings(request.suiteIds);
    const arms = uniqueStrings(request.arms);
    if (!suiteIds.length)
      return { error: 'Pick at least one suite to loop over' };
    if (!arms.length) return { error: 'Pick at least one arm to loop over' };
    if (suiteIds.length * arms.length > MAX_LOOP_JOBS) {
      return {
        error: `A loop is capped at ${MAX_LOOP_JOBS} runs (${suiteIds.length} suites × ${arms.length} arms asked for)`,
      };
    }

    const all = await this.datasets.list();
    const prepared: PreparedRun[] = [];
    const skipped: string[] = [];
    for (const suiteId of suiteIds) {
      for (const arm of arms) {
        const result = await this.prepare(
          agentKey,
          {
            datasourceId: request.datasourceId,
            suiteId,
            repeat: request.repeat,
            arm,
            label: request.label,
            includeVariants: request.includeVariants,
            categories: request.categories,
          },
          all,
        );
        if ('error' in result) {
          if (result.emptySelection && request.categories?.length) {
            skipped.push(suiteId);
            break;
          }
          return { error: `${suiteId} × ${arm}: ${result.error}` };
        }
        prepared.push(result);
      }
    }
    if (!prepared.length) {
      return {
        error:
          'None of the selected suites has a question in the selected categories',
      };
    }

    const loopId = randomUUID();
    const views = prepared.map((run, loopIndex) =>
      this.createView(run, { loopId, loopIndex }),
    );
    // Insert every cell before any is queued, so the loop's runs stay
    // contiguous in the queue even if another start lands meanwhile.
    for (const view of views) await this.repository.insert(view);
    this.loops.set(
      loopId,
      views.map((view) => view.jobId),
    );
    this.enqueue(
      views.map((view, index) => this.jobFor(view, prepared[index])),
    );
    return { loopId, jobIds: views.map((view) => view.jobId), skipped };
  }

  /** A loop's runs (in queue order), its status and its suite × arm matrix. */
  async getLoop(loopId: string): Promise<EvalLoopView | null> {
    const known = this.loops.get(loopId);
    let jobs: EvalRunView[];
    if (known) {
      jobs = (await Promise.all(known.map((id) => this.status(id)))).filter(
        (view): view is EvalRunView => Boolean(view),
      );
    } else {
      jobs = (await this.repository.findByLoop(loopId)).map(
        (run) => this.runs.get(run.jobId) ?? run,
      );
    }
    if (!jobs.length) return null;
    const status: EvalLoopStatus = jobs.some(
      (job) => job.status === 'queued' || job.status === 'running',
    )
      ? 'running'
      : jobs.some((job) => job.status === 'failed')
        ? 'failed'
        : 'completed';
    return { loopId, status, jobs, summary: { rows: jobs.map(loopRow) } };
  }

  /**
   * Stop a run. Running: the in-flight attempt is aborted, the run ends
   * `failed` ("Stopped by the operator") and its log is written with status
   * `aborted`. Queued: removed from the queue, never started, never logged.
   * A stored run still marked queued/running that no worker owns (the
   * backend restarted) is marked failed so it stops looking alive.
   */
  async stop(jobId: string): Promise<{ ok: boolean; message: string }> {
    if (this.current?.view.jobId === jobId) {
      if (!this.current.controller.signal.aborted) {
        this.current.controller.abort();
      }
      return {
        ok: true,
        message: 'Stopping — the question in flight is being aborted',
      };
    }
    const index = this.queue.findIndex((job) => job.view.jobId === jobId);
    if (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      job.view.status = 'failed';
      job.view.error = STOPPED_BEFORE_START;
      job.view.currentQuestion = undefined;
      job.view.finishedAt = new Date().toISOString();
      await this.save(job.view);
      return { ok: true, message: 'Removed from the queue' };
    }
    const stored = await this.status(jobId);
    if (!stored) return { ok: false, message: `Eval run "${jobId}" not found` };
    if (stored.status === 'running' || stored.status === 'queued') {
      stored.status = 'failed';
      stored.error = INTERRUPTED_BY_RESTART;
      stored.currentQuestion = undefined;
      stored.finishedAt = new Date().toISOString();
      await this.save(stored);
      return { ok: true, message: 'Marked as interrupted' };
    }
    return { ok: false, message: `That run has already ${stored.status}` };
  }

  /* ---------------------------------------------------------- preparation */

  /**
   * Every check a run needs before a row is persisted or a token is spent:
   * agent, datasource, repeat, arm, suite, bound datasets, case selection,
   * scope and the suite's own dataset preflight (`suiteDatasetError`).
   */
  private async prepare(
    agentKey: string,
    request: EvalRunRequest,
    allDatasets?: DatasetDoc[],
  ): Promise<PrepareResult> {
    if (agentKey !== 'assistant') {
      return { error: `Agent "${agentKey}" has no evals to run` };
    }
    const datasourceId = request?.datasourceId ?? '';
    if (!datasourceId) return { error: 'Pick a datasource to run against' };

    const repeat = request.repeat ?? 1;
    if (!EVAL_REPEATS.includes(repeat)) {
      return { error: `Repeat must be 1, 3 or 5 (got ${String(repeat)})` };
    }

    // `custom` alone means "the overrides are all in `engine`" — the UI's
    // custom arm has no preset to look up. `runTurn` resolves the merged
    // overrides over the production defaults itself.
    const arm = request.arm?.trim() || 'baseline';
    let engineOverrides: Partial<EngineOptions>;
    try {
      engineOverrides = mergeEngineOverrides(
        arm === 'custom' ? undefined : arm,
        request.engine,
      );
    } catch (err) {
      return { error: errorText(err) };
    }

    // An explicit empty list selects nothing — it must not be read as "run
    // everything", or an empty selection would start a full (paid) run.
    if (request.caseIds && request.caseIds.length === 0) {
      return {
        error: 'Pick at least one question to run',
        emptySelection: true,
      };
    }

    // Which set the questions belong to — it owns the entity list the datasets
    // are checked against. Without an explicit suiteId the set is the one the
    // case ids belong to (ids are unique across suites), and with neither the
    // shipped World Cup suite, as in `runAssistantEvals`. A set that cannot be
    // resolved (unknown id, or questions spanning several sets) fails the
    // start rather than running blind.
    let suite: EvalSuite;
    try {
      suite = request.suiteId
        ? loadSuite(request.suiteId)
        : request.caseIds
          ? suiteForCases(request.caseIds)
          : loadSuite(DEFAULT_SUITE_ID);
    } catch (err) {
      return { error: errorText(err) };
    }

    const all = allDatasets ?? (await this.datasets.list());
    const bound = all.filter((d) => d.datasourceId === datasourceId);
    if (bound.length === 0) {
      return {
        error:
          'That datasource has no datasets — create one in Datasets before running evals',
      };
    }

    const includeVariants = Boolean(request.includeVariants);
    let cases = expandVariants(suite, includeVariants);
    if (request.caseIds) {
      // An explicit empty list selects nothing — it must not be read as "run
      // everything", or an empty selection would start a full (paid) run. A
      // variant follows its base case's selection.
      const wanted = new Set(request.caseIds);
      cases = cases.filter(
        (evalCase) =>
          wanted.has(evalCase.id) ||
          (evalCase.variantOf !== undefined && wanted.has(evalCase.variantOf)),
      );
    }
    const categories = uniqueStrings(request.categories);
    if (categories.length) {
      const allowed = new Set(categories);
      cases = cases.filter((evalCase) => allowed.has(evalCase.category ?? ''));
    }
    if (cases.length === 0) {
      return {
        error: 'Pick at least one question to run',
        emptySelection: true,
      };
    }

    // Scope: the caller's explicit choice, else the suite's own datasets, else
    // the whole datasource. Running a suite against every dataset on the
    // datasource lets a genomics run see World Cup tables — extra schema, and
    // out-of-scope questions quietly becoming answerable.
    const byName = new Map(bound.map((dataset) => [dataset.name, dataset]));
    let scoped = bound;
    if (request.datasets?.length) {
      const missing = request.datasets.filter((name) => !byName.has(name));
      if (missing.length) {
        return {
          error: `That datasource has no dataset named ${missing.join(', ')}`,
        };
      }
      scoped = request.datasets.map((name) => byName.get(name)!);
    } else {
      // A suite names its datasets by the `fixtures:register` convention; an
      // operator may have saved the same tables under another name, so fall
      // back and let `requiredEntities` decide.
      const declared = suite.datasets.map((name) => byName.get(name));
      if (declared.every(Boolean)) scoped = declared as typeof bound;
    }

    // Each suite declares the entities its questions cannot run without, so
    // this rejects a health-insurance run against the World Cup scope (and
    // vice versa) before a single token is spent.
    const datasetError = suiteDatasetError(
      suite,
      scoped.map((dataset) => dataset.name),
      scoped,
    );
    if (datasetError) return { error: datasetError };

    const label = request.label?.trim().slice(0, MAX_LABEL_CHARS) || undefined;
    return {
      agentKey,
      datasourceId,
      suite,
      cases,
      scoped,
      repeat,
      arm,
      engineOverrides,
      // A REST datasource has no per-dialect reference: its suite's own
      // `expectedSql` is already SQLite (`referenceSqlFor` falls back to it).
      ...(scoped[0]?.datasourceKind === 'postgres' ||
      scoped[0]?.datasourceKind === 'databricks'
        ? { dialect: scoped[0].datasourceKind }
        : {}),
      ...(label ? { label } : {}),
      includeVariants,
      ...(categories.length ? { categories } : {}),
    };
  }

  private createView(
    run: PreparedRun,
    extra: { loopId?: string; loopIndex?: number },
  ): EvalRunView {
    const now = new Date().toISOString();
    const view: EvalRunView = {
      jobId: randomUUID(),
      agentKey: run.agentKey,
      suiteId: run.suite.id,
      suiteName: run.suite.name,
      datasourceId: run.datasourceId,
      datasets: run.scoped.map((d) => d.name),
      status: 'queued',
      results: [],
      caseIds: run.cases.map((evalCase) => evalCase.id),
      totalCases: run.cases.length,
      currentQuestion: run.cases[0]?.question,
      startedAt: now,
      queuedAt: now,
      repeat: run.repeat,
      arm: run.arm,
      engineOverrides: run.engineOverrides,
      ...(run.label ? { label: run.label } : {}),
      ...(run.dialect ? { dialect: run.dialect } : {}),
      ...(extra.loopId ? { loopId: extra.loopId } : {}),
      ...(extra.loopIndex !== undefined ? { loopIndex: extra.loopIndex } : {}),
      ...(run.includeVariants ? { includeVariants: true } : {}),
      ...(run.categories ? { categoryFilter: run.categories } : {}),
    };
    this.runs.set(view.jobId, view);
    return view;
  }

  private jobFor(view: EvalRunView, run: PreparedRun): EvalJob {
    return {
      view,
      suite: run.suite,
      cases: run.cases,
      engineOverrides: run.engineOverrides,
      controller: new AbortController(),
      captured: { engine: false, configHash: false, judgeModel: false },
    };
  }

  /* --------------------------------------------------------------- worker */

  private busy(): boolean {
    return Boolean(this.draining) || this.queue.length > 0;
  }

  private enqueue(jobs: EvalJob[]): void {
    this.queue.push(...jobs);
    // The worker body runs synchronously up to its first await, so it must
    // never start on an empty queue (its `finally` would run before
    // `draining` is assigned and leave it set forever).
    if (this.draining || !this.queue.length) return;
    this.draining = (async () => {
      try {
        let job: EvalJob | undefined;
        while ((job = this.queue.shift())) {
          this.current = job;
          try {
            await this.execute(job);
          } catch (err) {
            this.logger.error(
              `Eval run ${job.view.jobId} crashed the worker: ${errorText(err)}`,
            );
          } finally {
            this.current = undefined;
          }
        }
      } finally {
        this.draining = undefined;
      }
    })();
  }

  private async save(view: EvalRunView): Promise<void> {
    try {
      await this.repository.save(view);
    } catch (err) {
      this.logger.warn(
        `Could not persist eval run ${view.jobId}: ${errorText(err)}`,
      );
    }
  }

  private async execute(job: EvalJob): Promise<void> {
    const { view, controller } = job;
    const logCases: EvalRunLogCaseV2[] = [];
    const sidePassUsage: Partial<Record<SidePass, TokenUsage>> = {};
    const repeat = view.repeat ?? 1;
    let logStatus: LogRunStatus = 'completed';
    let stoppedEarly = false;

    view.status = 'running';
    view.startedAt = new Date().toISOString();
    view.currentQuestion = job.cases[0]?.question;
    const pricing: PricingTable = loadPricing();
    try {
      await this.save(view);
      // A measurement gap warns once per run, not once per case (see
      // `runResultSetCheck`).
      resetResultSetCheckWarnings();
      await this.resolveRunConfig(job);

      for (const [index, evalCase] of job.cases.entries()) {
        if (controller.signal.aborted) {
          stoppedEarly = true;
          break;
        }
        view.currentQuestion = evalCase.question;
        const outcome = await runAssistantEvalCaseRepeated(
          evalCase,
          {
            sessions: this.sessions,
            datasets: view.datasets,
            suite: job.suite,
            engine: job.engineOverrides,
            arm: view.arm,
            ...(view.dialect ? { dialect: view.dialect } : {}),
            abortSignal: controller.signal,
          },
          repeat,
          { pricing: { model: view.model, table: pricing } },
        );
        const { logCase, result } = outcome;
        // A stop mid-case leaves it unfinished; `foldAttempts` already folds
        // that to SKIP (or FAIL, when a finished draw failed), and its
        // attempts stay in the log because their tokens were spent. A stop
        // that lands after the last case finished leaves nothing unrun.
        const unfinished =
          logCase.attempts.length < repeat ||
          logCase.attempts.some(
            (attempt) => attempt.error === STOPPED_ATTEMPT_ERROR,
          );
        const stoppedHere =
          outcome.stopped && (unfinished || index < job.cases.length - 1);
        if (stoppedHere) stoppedEarly = true;

        view.results.push(result);
        logCases.push(logCase);
        if (logCase.usage) {
          view.usage = addUsage(view.usage ?? emptyUsage(), logCase.usage);
        }
        this.captureConfig(job, outcome);
        addSidePasses(sidePassUsage, outcome.sidePassUsage);
        if (Object.keys(sidePassUsage).length) {
          view.sidePassUsage = { ...sidePassUsage };
        }
        view.model = lastAgentModelId() ?? view.model;
        // Roll the tallies forward per case, not once at the end, so a run
        // that dies mid-suite still reports what its finished questions cost
        // and scored — and the tab shows pass^k live.
        view.categories = tallyCategories(logCases);
        view.summary = summarizeCases(
          logCases,
          estimateCostUsd(view.model, view.usage, pricing),
        );
        view.currentQuestion = job.cases[index + 1]?.question;
        // Persist as we go so a crash mid-suite still leaves the finished
        // questions on the run.
        await this.save(view);
        if (outcome.stopped || controller.signal.aborted) break;
      }

      if (stoppedEarly) {
        view.status = 'failed';
        view.error = STOPPED_BY_OPERATOR;
        logStatus = 'aborted';
      } else {
        view.status = 'completed';
        await this.attachRegressionComparison(view);
      }
    } catch (err) {
      view.status = 'failed';
      if (controller.signal.aborted) {
        view.error = STOPPED_BY_OPERATOR;
        logStatus = 'aborted';
      } else {
        view.error = errorText(err);
        logStatus = 'failed';
        this.logger.error(`Eval run ${view.jobId} failed: ${view.error}`);
      }
    } finally {
      view.currentQuestion = undefined;
      view.finishedAt = new Date().toISOString();
      await this.priceRun(view, logCases, pricing);
      this.logRun(view, logCases, logStatus, sidePassUsage, pricing);
      await this.save(view);
    }
  }

  /**
   * What the run will run on, before its first turn: the resolved levers
   * (production defaults + overrides), the reasoning effort and model, and
   * the config hash those give — the same inputs `runTurn` hashes. The first
   * turn's own `engine`/`configHash` replace these (`captureConfig`); these
   * stand in when no turn ran at all (every case errored, or a stop came
   * first), so even that log says what it was going to measure.
   */
  private async resolveRunConfig(job: EvalJob): Promise<void> {
    const { view } = job;
    try {
      view.engine = resolveEngineOptions(
        await this.engineSettings.resolved(),
        job.engineOverrides,
      );
    } catch (err) {
      view.engine = resolveEngineOptions(undefined, job.engineOverrides);
      this.logger.warn(
        `Engine settings unavailable for eval run ${view.jobId}: ${errorText(err)}`,
      );
    }
    try {
      job.settingsEffort = (await this.llm.getView()).reasoningEffort;
    } catch {
      job.settingsEffort = undefined;
    }
    view.reasoningEffort = view.engine.reasoningEffort ?? job.settingsEffort;
    try {
      view.model = agentModelId(await resolveAgentModel());
    } catch {
      view.model = lastAgentModelId() ?? view.model;
    }
    try {
      const pinned = await this.engineSettings.judgeModel();
      if (pinned) view.judgeModel = pinned;
    } catch {
      // No pin readable: the judge runs on the assistant's model.
    }
    view.configHash = engineConfigHash(view.engine, {
      model: view.model ?? 'unknown',
      reasoningEffort: view.reasoningEffort,
    });
  }

  /** The first outcome that carries them wins: every turn ran the same config. */
  private captureConfig(job: EvalJob, outcome: EvalCaseOutcome): void {
    const { view, captured } = job;
    if (outcome.engine && !captured.engine) {
      captured.engine = true;
      view.engine = outcome.engine;
      view.reasoningEffort =
        outcome.engine.reasoningEffort ??
        job.settingsEffort ??
        view.reasoningEffort;
    }
    if (outcome.configHash && !captured.configHash) {
      captured.configHash = true;
      view.configHash = outcome.configHash;
    }
    if (outcome.judgeModel && !captured.judgeModel) {
      captured.judgeModel = true;
      view.judgeModel = outcome.judgeModel;
    }
  }

  /**
   * Resolve what the run ran on and price it. What *actually* ran beats what
   * is configured now: settings can be changed while a run is in flight, and
   * a token count attributed to the wrong model would be priced wrongly and
   * compared against the wrong baseline.
   */
  private async priceRun(
    view: EvalRunView,
    logCases: EvalRunLogCaseV2[],
    pricing: PricingTable,
  ): Promise<void> {
    try {
      view.model =
        lastAgentModelId() ?? agentModelId(await resolveAgentModel());
    } catch (err) {
      this.logger.warn(
        `Could not resolve the model for eval run ${view.jobId}: ${errorText(err)}`,
      );
    }
    view.estimatedCostUsd = estimateCostUsd(view.model, view.usage, pricing);
    view.categories = tallyCategories(logCases);
    view.summary = summarizeCases(logCases, view.estimatedCostUsd);
  }

  /**
   * Write the run's v2 log — the spending and quality record the
   * improvement loop reads. Called on every terminal state: a failed or
   * stopped run still spent money on the questions it finished. Best-effort
   * on purpose: the tokens are already paid for, so a read-only checkout or
   * a full disk must warn, never fail the run.
   */
  private logRun(
    view: EvalRunView,
    logCases: EvalRunLogCaseV2[],
    status: LogRunStatus,
    sidePassUsage: Partial<Record<SidePass, TokenUsage>>,
    pricing: PricingTable,
  ): void {
    try {
      const record = buildRunLogRecordV2({
        runId: view.jobId,
        ...(view.label ? { label: view.label } : {}),
        harness: 'in-app',
        suite: view.suiteId ?? DEFAULT_SUITE_ID,
        agentKey: view.agentKey,
        datasets: view.datasets,
        ...(view.dialect
          ? { datasourceKind: view.dialect, dialect: view.dialect }
          : {}),
        ...(view.model ? { model: view.model } : {}),
        ...(view.reasoningEffort
          ? { reasoningEffort: view.reasoningEffort }
          : {}),
        ...(view.judgeModel ? { judgeModel: view.judgeModel } : {}),
        repeat: view.repeat ?? 1,
        ...(view.arm ? { arm: view.arm } : {}),
        engine:
          view.engine ?? resolveEngineOptions(undefined, view.engineOverrides),
        configHash: view.configHash ?? 'unknown',
        ...(view.loopId ? { loopId: view.loopId } : {}),
        startedAt: view.startedAt,
        finishedAt: view.finishedAt ?? new Date().toISOString(),
        cases: logCases,
        notReached: Math.max(view.totalCases - logCases.length, 0),
        pricing,
        status,
        ...(view.error ? { error: view.error } : {}),
        ...(Object.keys(sidePassUsage).length ? { sidePassUsage } : {}),
        ...(view.comparison
          ? {
              comparedToRunId: view.comparison.previousRunId,
              regressions: view.comparison.regressions.map((d) => d.id),
              improvements: view.comparison.improvements.map((d) => d.id),
              flakyChanges: (view.comparison.flakyChanges ?? []).map(
                (d) => d.id,
              ),
            }
          : {}),
        environment: runEnvironment(),
      });
      const written = writeRunLog(record);
      if (written) {
        view.logFile = basename(written.file);
      } else {
        this.logger.warn(
          `Eval run ${view.jobId} was not logged: the logs directory is not ` +
            'writable (set EVAL_LOG_DIR to a writable folder to record runs).',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not write the run log for eval run ${view.jobId}: ${errorText(err)} ` +
          '(set EVAL_LOG_DIR to a writable folder to record runs).',
      );
    }
  }

  /**
   * Diff this run's pass^k verdicts against the agent's most recent previous
   * completed run of the same suite and data scope, and attach the outcome
   * to `view.comparison` — best-effort, so a repository hiccup here degrades
   * the report (no comparison section) rather than marking an
   * otherwise-successful run failed. The baseline is simply the latest such
   * run, whatever its arm or repeat; `sameConfig`/`sameRepeat` say whether
   * the two are like-for-like, and the UI shows both hashes.
   */
  private async attachRegressionComparison(view: EvalRunView): Promise<void> {
    try {
      const previous = await this.repository.mostRecentCompleted(
        view.agentKey,
        view.jobId,
        view.datasourceId,
        view.datasets,
        view.suiteId,
      );
      if (!previous) return;
      const diff = computeRegressionDiff(previous.results, view.results);
      view.comparison = {
        previousRunId: previous.jobId,
        ...diff,
        sameConfig:
          Boolean(view.configHash) && previous.configHash === view.configHash,
        sameRepeat: (previous.repeat ?? 1) === (view.repeat ?? 1),
      };
    } catch (err) {
      this.logger.warn(
        `Could not compute regression comparison for eval run ${view.jobId}: ${errorText(err)}`,
      );
    }
  }
}

/** A run as one cell of its loop's matrix. */
function loopRow(view: EvalRunView): EvalLoopSummaryRow {
  const summary = view.summary;
  return {
    jobId: view.jobId,
    status: view.status,
    suite: view.suiteId ?? DEFAULT_SUITE_ID,
    arm: view.arm ?? 'baseline',
    ...(view.model ? { model: view.model } : {}),
    repeat: view.repeat ?? 1,
    passK: summary?.passK ?? 0,
    scored: summary?.scored ?? 0,
    passKRate: summary?.passKRate ?? 0,
    meanPassRate: summary?.meanPassRate ?? 0,
    flaky: summary?.flaky ?? 0,
    gaps: summary?.gaps ?? 0,
    tokens: view.usage?.totalTokens ?? 0,
    ...(view.estimatedCostUsd !== undefined
      ? { costUsd: view.estimatedCostUsd }
      : {}),
    ...(summary?.costPerCorrectUsd !== undefined
      ? { costPerCorrectUsd: summary.costPerCorrectUsd }
      : {}),
    ...(view.logFile ? { file: view.logFile } : {}),
  };
}
