import { Controller, Get, Query } from '@nestjs/common';
import { ExpertModeService } from './expert-mode.service';
import type { ReasoningFeedbackDoc } from './entities/reasoning-trace.entity';

/**
 * Read side of business expert mode's block ratings. Ratings are written
 * through `POST /sessions/:id/expert/feedback` (the session owns the message
 * the rating is mirrored onto); this lists what was collected, for the
 * improvement loop.
 */
@Controller('expert')
export class ExpertModeController {
  constructor(private readonly expertMode: ExpertModeService) {}

  /** Every block rating, newest first; `?sessionId=` narrows to one session. */
  @Get('feedback')
  async listFeedback(
    @Query('sessionId') sessionId?: string,
  ): Promise<{ feedback: ReasoningFeedbackDoc[] }> {
    return { feedback: await this.expertMode.listFeedback(sessionId) };
  }
}
