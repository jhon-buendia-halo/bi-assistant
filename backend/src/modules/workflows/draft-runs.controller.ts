import { Body, Controller, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WorkflowRunsService } from './workflow-runs.service';
import { streamPrepared } from './workflows.controller';

/**
 * Try it (api.md R12; agents-evals R60): one run of a user agent's saved
 * draft, streamed as a workflow run is (3.6) but never stored. The agent
 * routes live in the agents controller; this one belongs to the runs.
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
}
