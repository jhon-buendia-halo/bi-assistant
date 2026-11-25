import { Injectable, NotFoundException } from '@nestjs/common';
import { isConversationalWorkflow } from '../../mastra/conversational-agents';
import {
  conversationSummaries,
  type ConversationSummary,
} from './conversation-list';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';

/** The conversations of a conversational binding (api.md 168). */
@Injectable()
export class ConversationsService {
  constructor(private readonly repository: WorkflowRunsRepository) {}

  async list(
    workflowId: string,
    archived: boolean,
    q?: string,
  ): Promise<ConversationSummary[]> {
    if (!isConversationalWorkflow(workflowId)) {
      throw new NotFoundException(
        `Workflow "${workflowId}" has no conversations`,
      );
    }
    return conversationSummaries(
      await this.repository.listByWorkflow(workflowId, archived),
      q,
    );
  }
}
