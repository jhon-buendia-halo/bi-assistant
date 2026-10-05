import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { evalRunFilename, renderEvalRunMarkdown } from './eval-report';
import { AgentsService } from './agents.service';
import { EvalRunsService } from './eval-runs.service';
import type {
  EvalLoopView,
  EvalRunRequest,
  EvalRunView,
} from './eval-runs.service';
import { EvalLogsService } from './eval-logs.service';
import type { TrendPoint } from './eval-logs.service';
import type { RunLogSummary } from './eval-run-log';
import type { RunLogDiff } from './eval-diff';
import type { EvalRunLogRecordV2 } from './eval-telemetry';
import type { EngineOptions } from '../engine/engine-options';
import type {
  AgentDetail,
  AgentEvalSet,
  AgentSummary,
} from './agents.service';

/** Untrusted body arrays → strings, or `undefined` when absent. */
function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function engineBody(value: unknown): Partial<EngineOptions> | undefined {
  // Sanitised by the service (`mergeEngineOverrides`); only the shape is
  // checked here.
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

/**
 * Route order matters: Express matches in declaration order, so every
 * literal segment is declared before the parameter that would swallow it —
 * `evals/logs/compare` before `evals/logs/:file`, and `:key/evals` before
 * `:key`. `agents.controller.spec.ts` pins the first one.
 */
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly evalRuns: EvalRunsService,
    private readonly evalLogs: EvalLogsService,
  ) {}

  @Get()
  async list(): Promise<{ agents: AgentSummary[] }> {
    return { agents: await this.agents.list() };
  }

  /**
   * Queue a run against one datasource. Long-running: poll the job below.
   * A run started while another is going waits in the queue ("Eval run
   * queued") instead of being refused.
   */
  @Post(':key/evals/run')
  async runEvals(
    @Param('key') key: string,
    @Body()
    body: {
      datasourceId?: string;
      caseIds?: string[];
      suiteId?: string;
      datasets?: string[];
      repeat?: number;
      label?: string;
      arm?: string;
      engine?: Partial<EngineOptions>;
      includeVariants?: boolean;
      categories?: string[];
    },
  ): Promise<{ ok: boolean; message: string; jobId?: string }> {
    const request: EvalRunRequest = {
      datasourceId: String(body?.datasourceId ?? ''),
      caseIds: stringList(body?.caseIds),
      suiteId: optionalString(body?.suiteId),
      datasets: stringList(body?.datasets),
      repeat: optionalNumber(body?.repeat),
      label: optionalString(body?.label),
      arm: optionalString(body?.arm),
      engine: engineBody(body?.engine),
      includeVariants: body?.includeVariants === true,
      categories: stringList(body?.categories),
    };
    const result = await this.evalRuns.start(key, request);
    if ('error' in result) return { ok: false, message: result.error };
    return {
      ok: true,
      message: result.queued ? 'Eval run queued' : 'Eval run started',
      jobId: result.jobId,
    };
  }

  /** Queue one run per suite × arm; they run one after another. */
  @Post(':key/evals/loop')
  async runLoop(
    @Param('key') key: string,
    @Body()
    body: {
      datasourceId?: string;
      suiteIds?: string[];
      repeat?: number;
      arms?: string[];
      label?: string;
      includeVariants?: boolean;
      categories?: string[];
    },
  ): Promise<{
    ok: boolean;
    message: string;
    loopId?: string;
    jobIds?: string[];
  }> {
    const result = await this.evalRuns.startLoop(key, {
      datasourceId: String(body?.datasourceId ?? ''),
      suiteIds: stringList(body?.suiteIds) ?? [],
      repeat: optionalNumber(body?.repeat),
      arms: stringList(body?.arms) ?? [],
      label: optionalString(body?.label),
      includeVariants: body?.includeVariants === true,
      categories: stringList(body?.categories),
    });
    if ('error' in result) return { ok: false, message: result.error };
    const skipped = result.skipped.length
      ? ` (skipped ${result.skipped.join(', ')}: no question in the selected categories)`
      : '';
    return {
      ok: true,
      message: `Queued ${result.jobIds.length} eval run${result.jobIds.length === 1 ? '' : 's'}${skipped}`,
      loopId: result.loopId,
      jobIds: result.jobIds,
    };
  }

  /** A loop's jobs and its suite × arm summary matrix. */
  @Get(':key/evals/loops/:loopId')
  async loopStatus(
    @Param('loopId') loopId: string,
  ): Promise<{ ok: boolean; message?: string } & Partial<EvalLoopView>> {
    const loop = await this.evalRuns.getLoop(loopId);
    if (!loop) return { ok: false, message: `Eval loop "${loopId}" not found` };
    return { ok: true, ...loop };
  }

  /** Past and in-flight runs for the agent, newest first. */
  @Get(':key/evals/runs')
  async evalRuns_list(
    @Param('key') key: string,
  ): Promise<{ runs: EvalRunView[] }> {
    return { runs: await this.evalRuns.list(key) };
  }

  @Get(':key/evals/runs/:jobId')
  async evalRunStatus(
    @Param('jobId') jobId: string,
  ): Promise<{ ok: boolean; message: string } & Partial<EvalRunView>> {
    const view = await this.evalRuns.status(jobId);
    if (!view) return { ok: false, message: `Eval run "${jobId}" not found` };
    return { ok: true, message: view.status, ...view };
  }

  /** Abort a running run (its log is still written) or unqueue a waiting one. */
  @Post(':key/evals/runs/:jobId/stop')
  async evalRunStop(
    @Param('jobId') jobId: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.evalRuns.stop(jobId);
  }

  /** The run as a Markdown report — summary, failures, traces, answers. */
  @Get(':key/evals/runs/:jobId/download')
  async evalRunDownload(
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const view = await this.evalRuns.status(jobId);
    if (!view) throw new NotFoundException(`Eval run "${jobId}" not found`);

    const markdown = renderEvalRunMarkdown(
      view,
      await this.evalRuns.datasourceName(view.datasourceId),
    );
    const filename = evalRunFilename(view);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(markdown));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(markdown);
  }

  @Delete(':key/evals/runs/:jobId')
  async evalRunDelete(
    @Param('jobId') jobId: string,
  ): Promise<{ ok: boolean; message: string }> {
    const removed = await this.evalRuns.remove(jobId);
    return removed
      ? { ok: true, message: 'Run deleted' }
      : { ok: false, message: 'Cannot delete a run that is still going' };
  }

  /** The run-log history (CLI and in-app runs), newest first. */
  @Get(':key/evals/logs')
  evalLogs_list(
    @Query('suite') suite?: string,
    @Query('limit') limit?: string,
  ): { logs: RunLogSummary[]; dirs: string[] } {
    return this.evalLogs.list({ suite, limit: optionalNumber(limit) });
  }

  /**
   * Diff two logged runs (`a` = before, `b` = after). MUST stay declared
   * before `evals/logs/:file`, or `compare` is read as a file name.
   */
  @Get(':key/evals/logs/compare')
  evalLogsCompare(
    @Query('a') a?: string,
    @Query('b') b?: string,
  ): { ok: boolean; message?: string; diff?: RunLogDiff; markdown?: string } {
    return this.evalLogs.compare(a ?? '', b ?? '');
  }

  /** Draft (and optionally append) a change-log entry from two runs. */
  @Post(':key/evals/logs/changelog-draft')
  evalLogsChangelogDraft(
    @Body()
    body: {
      a?: string;
      b?: string;
      lever?: string;
      change?: string;
      why?: string;
      append?: boolean;
    },
  ): { ok: boolean; message?: string; markdown?: string; appendedTo?: string } {
    return this.evalLogs.changelogDraft({
      a: String(body?.a ?? ''),
      b: String(body?.b ?? ''),
      lever: String(body?.lever ?? ''),
      change: String(body?.change ?? ''),
      why: String(body?.why ?? ''),
      append: body?.append === true,
    });
  }

  /** One logged run, in full, as schema v2. */
  @Get(':key/evals/logs/:file')
  evalLogRead(@Param('file') file: string): {
    ok: boolean;
    message?: string;
    record?: EvalRunLogRecordV2;
  } {
    return this.evalLogs.read(file);
  }

  /** pass^k over time for a suite and/or arm, oldest first. */
  @Get(':key/evals/trend')
  evalTrend(
    @Query('suite') suite?: string,
    @Query('arm') arm?: string,
  ): { points: TrendPoint[] } {
    return this.evalLogs.trend({ suite, arm });
  }

  /**
   * The agent's eval catalog: every question set (one per suite file) with
   * its questions.
   *
   * Declared before ':key' so the more specific path wins.
   */
  @Get(':key/evals')
  evals(@Param('key') key: string): { sets: AgentEvalSet[] } {
    return { sets: this.agents.evalSets(key) };
  }

  @Get(':key')
  async get(@Param('key') key: string): Promise<AgentDetail> {
    const agent = await this.agents.get(key);
    if (!agent) throw new NotFoundException(`Agent "${key}" not found`);
    return agent;
  }
}
