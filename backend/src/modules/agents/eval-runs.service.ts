import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { SessionsService } from '../sessions/sessions.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';
import { computeRegressionDiff, EvalRegressionSummary } from './eval-regression';
import {
  DEFAULT_SUITE_ID,
  loadSuite,
  suiteDatasetError,
} from '../../mastra/evals/suite-loader';
import type { EvalSuite } from '../../mastra/evals/suite-loader';
import {
  agentModelId,
  lastAgentModelId,
  resolveAgentModel,
} from '../../mastra/model-resolver';
import {
  addUsage,
  emptyUsage,
  estimateCostUsd,
  tallyCategories,
} from './eval-telemetry';
import type {
  CategoryTally,
  EvalRunLogCase,
  TokenUsage,
} from './eval-telemetry';
import { loadPricing, writeRunLog } from './eval-run-log';
import {
  AssistantEvalCase,
  AssistantEvalCaseResult,
  EvalSession,
  cleanupEvalSession,
  createEvalSession,
  runAssistantEvalCase,
  selectSuiteCases,
  suiteForCases,
} from '../../mastra/evals/assistant.evals';

export type EvalRunStatus = 'running' | 'completed' | 'failed';

/**
 * One finished question in the shape the run log and the category tallies
 * want: a verdict rather than a boolean, plus the id of the first check that
 * said no — which is the qualifier that makes a failure greppable across runs
 * (`result-set-match` vs `llm-judge` vs a tool check are three different
 * problems, and the overall pass rate hides which one moved).
 */
function logCase(result: AssistantEvalCaseResult): EvalRunLogCase {
  const firstFailure = result.checkResults.find((check) => !check.passed);
  return {
    id: result.id,
    category: result.category,
    verdict: result.error ? 'ERROR' : result.passed ? 'PASS' : 'FAIL',
    reason: result.error ? 'run-error' : firstFailure?.id,
    durationMs: result.durationMs,
    usage: result.usage,
  };
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
  /** Ids of the questions this run covers. */
  caseIds: string[];
  status: EvalRunStatus;
  /** Questions finished so far, in order. */
  results: AssistantEvalCaseResult[];
  totalCases: number;
  /** The question currently running, if any. */
  currentQuestion?: string;
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
  /**
   * Tokens the whole run spent, summed over its cases (agent + LLM judge).
   * Absent on runs recorded before token accounting existed, and `calls: 0`
   * when the provider reported nothing — which is not the same as free.
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
  /** Pass rate per failure class — what the improvement loop is steered by. */
  categories?: Record<string, CategoryTally>;
}

/**
 * Eval runs are long (one model call per question, with tool loops), so they
 * follow the same start/poll shape as deep analysis rather than blocking an
 * HTTP request. Runs are in-memory: a backend restart forgets them.
 */
@Injectable()
export class EvalRunsService {
  private readonly logger = new Logger(EvalRunsService.name);
  private readonly runs = new Map<string, EvalRunView>();
  /** One running job per agent, so a double-click cannot double-spend. */
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
    if (this.runs.get(jobId)?.status === 'running') return false;
    this.runs.delete(jobId);
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
    /**
     * Which suite (question set) to run. When omitted, the suite is the one
     * the named questions belong to — case ids are unique across suites.
     */
    suiteId?: string,
  ): Promise<{ jobId: string } | { conflictWith: string } | { error: string }> {
    if (agentKey !== 'assistant') {
      return { error: `Agent "${agentKey}" has no evals to run` };
    }
    const running = this.active.get(agentKey);
    if (running) return { conflictWith: running };

    if (!datasourceId) return { error: 'Pick a datasource to run against' };

    // Which set the questions belong to — it owns the entity list the datasets
    // are checked against. A set that cannot be resolved (unknown id, or
    // questions spanning several sets) must fail the start, not run blind.
    let suite: EvalSuite;
    try {
      suite = suiteId ? loadSuite(suiteId) : suiteForCases(caseIds);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }

    const all = await this.datasets.list();
    const bound = all.filter((d) => d.datasourceId === datasourceId);
    if (bound.length === 0) {
      return {
        error:
          'That datasource has no datasets — create one in Datasets before running evals',
      };
    }

    const cases = selectSuiteCases(suite, caseIds);
    if (cases.length === 0) {
      return { error: 'Pick at least one question to run' };
    }

    // Scope the run to the datasets the suite declares, when the datasource
    // actually has them. Handing the agent every dataset on the datasource —
    // which is what this used to do — lets a genomics run see World Cup and
    // health-insurance tables: extra schema for the model to wade through, and
    // a question that should be out of scope quietly becoming answerable.
    //
    // The fallback matters: a suite names its datasets by the convention
    // `fixtures:register` uses, but an operator may have saved the same tables
    // under their own name. When not every declared dataset is present, fall
    // back to the whole datasource and let `requiredEntities` decide — that is
    // the check that actually guarantees the questions can run.
    const byName = new Map(bound.map((dataset) => [dataset.name, dataset]));
    const declared = suite.datasets.map((name) => byName.get(name));
    const scoped = declared.every(Boolean)
      ? (declared as typeof bound)
      : bound;

    // Each suite declares the entities its questions cannot run without, so
    // this rejects a health-insurance run against the World Cup scope (and
    // vice versa) before a single token is spent.
    const datasetError = suiteDatasetError(
      suite,
      scoped.map((dataset) => dataset.name),
      scoped,
    );
    if (datasetError) return { error: datasetError };

    const jobId = randomUUID();
    const view: EvalRunView = {
      jobId,
      agentKey,
      suiteId: suite.id,
      suiteName: suite.name,
      datasourceId,
      datasets: scoped.map((d) => d.name),
      status: 'running',
      results: [],
      caseIds: cases.map((evalCase) => evalCase.id),
      totalCases: cases.length,
      currentQuestion: cases[0]?.question,
      startedAt: new Date().toISOString(),
    };
    this.runs.set(jobId, view);
    this.active.set(agentKey, jobId);
    await this.repository.insert(view);

    void this.run(view, cases, suite);
    return { jobId };
  }

  async status(jobId: string): Promise<EvalRunView | null> {
    return this.runs.get(jobId) ?? (await this.repository.get(jobId));
  }

  private async run(
    view: EvalRunView,
    cases: AssistantEvalCase[],
    suite: EvalSuite,
  ): Promise<void> {
    // A throwaway session so create_visual/update_visual behave the way they
    // do in a real chat turn (see assistant.evals.ts). Best-effort: a run
    // still measures the agent without one, just with visual-tool support
    // degraded to "No session in context".
    let evalSession: EvalSession | undefined;
    try {
      evalSession = await createEvalSession(this.sessions, view.datasets);
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
    const knowledgeBlock = await this.knowledge.definitionBlock(
      view.datasets,
    );
    try {
      for (const [index, evalCase] of cases.entries()) {
        view.currentQuestion = evalCase.question;
        const result = await runAssistantEvalCase(
          evalCase,
          view.datasets,
          evalSession?.id,
          knowledgeBlock,
          suite,
        );
        view.results.push(result);
        // Roll the tallies forward per case, not once at the end, so a run
        // that dies mid-suite still reports what its finished questions cost.
        this.accumulate(view, result);
        view.currentQuestion = cases[index + 1]?.question;
        // Persist as we go so a crash mid-suite still leaves the finished
        // questions on the run.
        await this.repository.save(view);
      }
      view.status = 'completed';
      await this.attachRegressionComparison(view);
    } catch (err) {
      view.status = 'failed';
      view.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Eval run ${view.jobId} failed: ${view.error}`);
    } finally {
      view.currentQuestion = undefined;
      view.finishedAt = new Date().toISOString();
      this.active.delete(view.agentKey);
      await this.priceRun(view);
      await this.repository.save(view);
      this.logRun(view);
      await cleanupEvalSession(this.sessions, evalSession);
    }
  }

  /** Fold one finished question into the run's usage and category tallies. */
  private accumulate(view: EvalRunView, result: AssistantEvalCaseResult): void {
    if (result.usage) {
      view.usage = addUsage(view.usage ?? emptyUsage(), result.usage);
    }
    view.categories = tallyCategories(view.results.map(logCase));
  }

  /**
   * Resolve what the run ran on and price it. What *actually* ran beats what
   * is configured now: settings can be changed while a run is in flight, and
   * a token count attributed to the wrong model would be priced wrongly and
   * compared against the wrong baseline.
   */
  private async priceRun(view: EvalRunView): Promise<void> {
    try {
      view.model =
        lastAgentModelId() ?? agentModelId(await resolveAgentModel());
      view.estimatedCostUsd = estimateCostUsd(
        view.model,
        view.usage,
        loadPricing(),
      );
    } catch (err) {
      this.logger.warn(
        `Could not resolve the model for eval run ${view.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Append the run to the repo's `logs/evals` history — the spending and
   * quality record the improvement loop reads. Best-effort on purpose: the
   * tokens are already paid for, so a read-only checkout or a full disk must
   * warn, never fail the run. Failed runs are logged too; a run that died
   * halfway still spent money on the questions it finished.
   */
  private logRun(view: EvalRunView): void {
    try {
      const cases = view.results.map(logCase);
      const usage = view.usage ?? emptyUsage();
      const written = writeRunLog({
        schemaVersion: 1,
        runId: view.jobId,
        harness: 'in-app',
        suite: view.suiteId ?? DEFAULT_SUITE_ID,
        agentKey: view.agentKey,
        datasets: view.datasets,
        model: view.model,
        startedAt: view.startedAt,
        finishedAt: view.finishedAt ?? new Date().toISOString(),
        durationMs:
          new Date(view.finishedAt ?? Date.now()).getTime() -
          new Date(view.startedAt).getTime(),
        totals: {
          cases: view.totalCases,
          passed: cases.filter((c) => c.verdict === 'PASS').length,
          failed: cases.filter((c) => c.verdict === 'FAIL').length,
          errored: cases.filter((c) => c.verdict === 'ERROR').length,
          // Questions the run never reached, because it failed partway.
          skipped: Math.max(view.totalCases - cases.length, 0),
        },
        categories: view.categories ?? tallyCategories(cases),
        usage,
        estimatedCostUsd: view.estimatedCostUsd,
        costIncomplete:
          view.estimatedCostUsd === undefined && usage.calls > 0
            ? true
            : undefined,
        cases,
        comparedToRunId: view.comparison?.previousRunId,
        regressions: view.comparison?.regressions.map((delta) => delta.id),
        improvements: view.comparison?.improvements.map((delta) => delta.id),
      });
      if (!written) {
        this.logger.warn(
          `Eval run ${view.jobId} was not logged: no writable logs directory ` +
            '(set EVAL_LOG_DIR to record runs from a packaged app).',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not write the run log for eval run ${view.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Diff this run's per-case results against the agent's most recent
   * previous completed run with the same data scope, and attach the outcome to `view.comparison` —
   * best-effort, so a repository hiccup here degrades the report (no
   * comparison section) rather than marking an otherwise-successful run
   * failed.
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
