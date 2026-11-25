import { Injectable, OnModuleInit } from '@nestjs/common';
import { installAveryEvalRuns } from '../../mastra/evals/avery-workflow-target';
import { WorkflowRunsService } from './workflow-runs.service';

/**
 * Hands the workflow run service to the `avery-michael-workflow` eval
 * target at start-up (agents.md 8.1), as `QueryExplainerEvalBridge` hands
 * its target the query evidence service: the eval sets are built before any
 * provider exists. Each case then runs the whole workflow as
 * `POST /workflows/:id/runs` does. The Agents screen's runs and the CLI both
 * boot the whole app, so both have it.
 */
@Injectable()
export class AveryEvalBridge implements OnModuleInit {
  constructor(private readonly runs: WorkflowRunsService) {}

  onModuleInit(): void {
    installAveryEvalRuns(this.runs);
  }
}
