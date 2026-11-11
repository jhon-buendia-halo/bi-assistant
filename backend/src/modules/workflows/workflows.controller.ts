import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { WorkflowRunResult } from '../../mastra/workflows/workflow-run';
import {
  WorkflowsService,
  type WorkflowDetail,
  type WorkflowSummary,
} from './workflows.service';

/**
 * The workflow catalogue (api.md 2.6.2; capability workflows). Workflows
 * are defined in code, so there is no write route (workflows R3); a run
 * workflow can be run (118), and the run is never stored (R11).
 * Ids contain `:` (`agent:rfp`); clients send them URL-encoded and NestJS
 * decodes `:id`.
 */
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  async list(): Promise<{ workflows: WorkflowSummary[] }> {
    return { workflows: await this.workflows.list() };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<WorkflowDetail> {
    return this.workflows.get(id);
  }

  /**
   * Run a run workflow once (api.md 118). Style B: a refusal answers its
   * real status (400, 404); a run whose step failed still answers 200.
   */
  @Post(':id/runs')
  @HttpCode(200)
  run(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WorkflowRunResult> {
    return this.workflows.run(id, body);
  }
}
