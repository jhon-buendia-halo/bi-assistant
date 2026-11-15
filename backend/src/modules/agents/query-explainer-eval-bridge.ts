import { Injectable, OnModuleInit } from '@nestjs/common';
import { installQueryExplainerEvalServices } from '../../mastra/evals/query-explainer-eval-target';
import { QueryEvidenceService } from '../sessions/query-evidence/query-evidence.service';

/**
 * Hands the query evidence service to the `query-explainer` eval target at
 * start-up (agents.md 8.1), as `SessionsService` hands the tools theirs: the
 * eval sets are built before any provider exists. The Agents screen's runs
 * and the CLI both boot the whole app, so both have it.
 */
@Injectable()
export class QueryExplainerEvalBridge implements OnModuleInit {
  constructor(private readonly evidence: QueryEvidenceService) {}

  onModuleInit(): void {
    installQueryExplainerEvalServices(this.evidence);
  }
}
