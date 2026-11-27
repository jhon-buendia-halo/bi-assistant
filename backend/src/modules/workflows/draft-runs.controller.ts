import { Body, Controller, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WorkflowRunsService } from './workflow-runs.service';
import { streamPrepared, streamSse } from './workflows.controller';

/**
 * Try it (api.md R12; agents-evals R60): one run of a user agent's saved
 * draft on Elena's conversation engine (ADR-0059), streamed as a workflow
 * run is (3.6) but never stored; a run that waits for the user is answered
 * with 169. The agent routes live in the agents controller; these belong to
 * the runs.
 */
@Controller('agents')
export class DraftRunsController {
  constructor(private readonly runs: WorkflowRunsService) {}

  /**
   * Refusals answer their real status before the stream starts (Style B):
   * 404 `Agent "<id>" not found`, 400 `Select at least one dataset to
   * preview` and `Question is required`.
   */
  @Post(':id/draft-runs/stream')
  @HttpCode(200)
  async stream(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    await streamPrepared(
      this.runs,
      await this.runs.prepareDraft(id, body),
      res,
    );
  }

  /**
   * Answer a waiting draft run and continue it (api.md 169), streamed as
   * 129 and tied to the connection: closing it stops the run. Refusals
   * answer their real status before the stream starts (Style B): 404
   * agent or run, 400 no dataset, 410 expired, 400 answer, 400 step.
   */
  @Post(':id/draft-runs/:runId/resume/stream')
  @HttpCode(200)
  async resume(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.runs.prepareDraftResume(id, runId, body);
    await streamSse(res, (send, signal) =>
      this.runs.resume(prepared, send, signal),
    );
  }
}
