import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  evalRunFilename,
  renderEvalRunMarkdown,
} from './eval-report';
import { AgentsService } from './agents.service';
import { EvalRunsService } from './eval-runs.service';
import type { EvalRunView } from './eval-runs.service';
import type {
  AgentDetail,
  AgentEvalSet,
  AgentSummary,
} from './agents.service';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly evalRuns: EvalRunsService,
  ) {}

  @Get()
  async list(): Promise<{ agents: AgentSummary[] }> {
    return { agents: await this.agents.list() };
  }

  /** Start a run against one datasource. Long-running: poll the job below. */
  @Post(':key/evals/run')
  async runEvals(
    @Param('key') key: string,
    @Body() body: { datasourceId?: string; caseIds?: string[] },
  ): Promise<{ ok: boolean; message: string; jobId?: string }> {
    const result = await this.evalRuns.start(
      key,
      body?.datasourceId ?? '',
      Array.isArray(body?.caseIds) ? body.caseIds.map(String) : undefined,
    );
    if ('error' in result) return { ok: false, message: result.error };
    if ('conflictWith' in result) {
      return {
        ok: false,
        message: 'An eval run is already in progress for this agent',
        jobId: result.conflictWith,
      };
    }
    return { ok: true, message: 'Eval run started', jobId: result.jobId };
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

  // Declared before ':key' so the more specific path wins.
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
