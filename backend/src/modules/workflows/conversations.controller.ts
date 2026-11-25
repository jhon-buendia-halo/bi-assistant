import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { ConversationSummary } from './conversation-list';
import { ConversationsService } from './conversations.service';

/** The conversations list (api.md 168). */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  async list(
    @Query('workflowId') workflowId?: string,
    @Query('archived') archived?: string,
    @Query('q') q?: string,
  ): Promise<{ conversations: ConversationSummary[] }> {
    if (typeof workflowId !== 'string' || !workflowId.trim()) {
      throw new BadRequestException('workflowId is required');
    }
    return {
      conversations: await this.conversations.list(
        workflowId,
        archived === 'true',
        typeof q === 'string' ? q : undefined,
      ),
    };
  }
}
