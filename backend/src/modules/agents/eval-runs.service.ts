import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';
import {
  AssistantEvalCase,
  AssistantEvalCaseResult,
  runAssistantEvalCase,
  selectEvalCases,
} from '../../mastra/evals/assistant.evals';

export type EvalRunStatus = 'running' | 'completed' | 'failed';

export interface EvalRunView {
  jobId: string;
  agentKey: string;
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
  ): Promise<{ jobId: string } | { conflictWith: string } | { error: string }> {
    if (agentKey !== 'assistant') {
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

    const cases = selectEvalCases(caseIds);
    if (cases.length === 0) {
      return { error: 'Pick at least one question to run' };
    }

    const jobId = randomUUID();
    const view: EvalRunView = {
      jobId,
      agentKey,
      datasourceId,
      datasets: bound.map((d) => d.name),
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

    void this.run(view, cases);
    return { jobId };
  }

  async status(jobId: string): Promise<EvalRunView | null> {
    return this.runs.get(jobId) ?? (await this.repository.get(jobId));
  }

  private async run(
    view: EvalRunView,
    cases: AssistantEvalCase[],
  ): Promise<void> {
    try {
      for (const [index, evalCase] of cases.entries()) {
        view.currentQuestion = evalCase.question;
        const result = await runAssistantEvalCase(evalCase, view.datasets);
        view.results.push(result);
        view.currentQuestion = cases[index + 1]?.question;
        // Persist as we go so a crash mid-suite still leaves the finished
        // questions on the run.
        await this.repository.save(view);
      }
      view.status = 'completed';
    } catch (err) {
      view.status = 'failed';
      view.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Eval run ${view.jobId} failed: ${view.error}`);
    } finally {
      view.currentQuestion = undefined;
      view.finishedAt = new Date().toISOString();
      this.active.delete(view.agentKey);
      await this.repository.save(view);
    }
  }
}
