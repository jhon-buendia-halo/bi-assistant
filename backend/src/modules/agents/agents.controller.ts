import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
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
import type { SaveAgentDto } from '../user-agents/dto/save-agent.dto';
import type { PinAgentDto } from '../user-agents/dto/pin-agent.dto';
import type { AgentConfigInput } from '../user-agents/user-agents.service';

/** Style A answer of the agent-definition routes (api.md 41-45). */
interface AgentResult {
  ok: boolean;
  message: string;
  agent?: AgentSummary;
}

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

  /** Create a user agent as a draft (R43, R45). */
  @Post()
  create(@Body() dto: SaveAgentDto): Promise<AgentResult> {
    return styleA(async () => {
      const agent = await this.agents.create(toInput(dto));
      return {
        message: `Agent "${agent.name}" saved as draft`,
        agent,
      };
    });
  }

  /** Replace a user agent's draft; its Live version is untouched (R44). */
  @Put(':id/draft')
  saveDraft(
    @Param('id') id: string,
    @Body() dto: SaveAgentDto,
  ): Promise<AgentResult> {
    return styleA(async () => ({
      message: 'Draft saved',
      agent: await this.agents.saveDraft(id, toInput(dto)),
    }));
  }

  @Post(':id/publish')
  publish(@Param('id') id: string): Promise<AgentResult> {
    return styleA(async () => {
      const agent = await this.agents.publish(id);
      return { message: `Agent "${agent.name}" is Live`, agent };
    });
  }

  /** Pin or unpin any agent, built-in or user-built (R47). */
  @Put(':key/pin')
  pin(
    @Param('key') key: string,
    @Body() dto: PinAgentDto,
  ): Promise<AgentResult> {
    const pinned = dto?.pinned === true;
    return styleA(async () => ({
      message: pinned ? 'Pinned' : 'Unpinned',
      agent: await this.agents.setPinned(key, pinned),
    }));
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

  /** Delete a user agent; sessions that used it are not touched (R50). */
  @Delete(':id')
  remove(@Param('id') id: string): Promise<AgentResult> {
    return styleA(async () => {
      const agent = await this.agents.delete(id);
      return { message: `Agent "${agent.name}" deleted` };
    });
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

/** Run a mutation and fold thrown errors into `{ ok: false, message }`. */
async function styleA(
  run: () => Promise<{ message: string; agent?: AgentSummary }>,
): Promise<AgentResult> {
  try {
    return { ok: true, ...(await run()) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Coerce the untyped body into the service's input shape. */
function toInput(dto: SaveAgentDto): AgentConfigInput {
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item)) : undefined;
  const text = (value: unknown) =>
    typeof value === 'string' ? value : undefined;
  return {
    name: text(dto?.name),
    description: text(dto?.description),
    instructions: text(dto?.instructions),
    datasets: strings(dto?.datasets),
    starterQuestions: strings(dto?.starterQuestions),
    model: text(dto?.model),
    reasoningEffort: dto?.reasoningEffort,
  };
}
