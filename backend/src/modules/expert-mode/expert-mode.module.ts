import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { ExpertModeController } from './expert-mode.controller';
import { ExpertModeService } from './expert-mode.service';
import { ReasoningFeedbackRepository } from './repositories/reasoning-feedback.repository';

/**
 * Business expert mode: reasoning traces for answers and per-block feedback.
 * Imported by `SessionsModule`, which runs the pass at the end of a chat turn
 * — never the other way round, so there is no dependency cycle.
 */
@Module({
  imports: [MastraModule],
  controllers: [ExpertModeController],
  providers: [ExpertModeService, ReasoningFeedbackRepository],
  exports: [ExpertModeService],
})
export class ExpertModeModule {}
