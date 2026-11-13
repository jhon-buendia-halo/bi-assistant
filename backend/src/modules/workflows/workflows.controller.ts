import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { WorkflowRun } from './workflow-run-steps';
import { WorkflowRunsService, type PreparedRun } from './workflow-runs.service';
import {
  WorkflowsService,
  type WorkflowDetail,
  type WorkflowSummary,
} from './workflows.service';

/**
 * Answer as an SSE stream with the chat stream's framing (api.md 3.1):
 * `work` sends its events through `send`, and closing the connection aborts
 * its signal. A throw before the connection closed is sent as `error {
 * content }`. Used by 119, 137 and R12.
 */
export async function streamSse(
  res: Response,
  work: (
    send: (data: unknown) => void,
    signal: AbortSignal,
  ) => Promise<unknown>,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (data: unknown) =>
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    await work(send, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'error', content: message });
    }
  }
  res.off('close', abort);
  if (!res.writableEnded) res.end();
}

/**
 * Answer a prepared run as the SSE stream of api.md 3.6: the chat stream's
 * framing, and closing the connection stops the run. Used by 119 and R12.
 */
export function streamPrepared(
  runs: WorkflowRunsService,
  prepared: PreparedRun,
  res: Response,
): Promise<void> {
  return streamSse(res, (send, signal) => runs.stream(prepared, send, signal));
}

/**
 * The workflow catalogue (api.md 2.6.2; capability workflows). Workflows
 * are defined in code, so there is no write route (workflows R3); a
 * workflow with input fields can be run (118) and run streamed (119). The
 * catalogue holds only `qti-v2-turn` (1.23.35); any other id, such as a
 * former `agent:assistant`, answers 404. Clients send ids URL-encoded and
 * NestJS decodes `:id`.
 */
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
  ) {}

  @Get()
  async list(): Promise<{ workflows: WorkflowSummary[] }> {
    return { workflows: await this.workflows.list() };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<WorkflowDetail> {
    return this.workflows.get(id);
  }

  /**
   * Run a workflow once (api.md 118); the run is stored. Style B: a refusal
   * answers its real status (400, 404); a run whose step failed still
   * answers 200.
   */
  @Post(':id/runs')
  @HttpCode(200)
  run(@Param('id') id: string, @Body() body: unknown): Promise<WorkflowRun> {
    return this.runs.run(id, body);
  }

  /**
   * Run a workflow once, streamed (api.md 119; workflows R14). A refusal
   * answers its real status before the stream starts (Style B); once it
   * starts, the stream is SSE with the chat stream's framing (api.md 3.1).
   * Closing the connection stops the run.
   */
  @Post(':id/runs/stream')
  @HttpCode(200)
  async stream(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    await streamPrepared(this.runs, await this.runs.prepare(id, body), res);
  }
}
