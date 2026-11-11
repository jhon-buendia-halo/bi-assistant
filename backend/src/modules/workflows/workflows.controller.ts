import { Controller, Get, Param } from '@nestjs/common';
import {
  WorkflowsService,
  type WorkflowDetail,
  type WorkflowSummary,
} from './workflows.service';

/**
 * The workflow catalogue (api.md 2.6.2; capability workflows). Read-only:
 * workflows are defined in code, so there is no write route (workflows R3).
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
}
