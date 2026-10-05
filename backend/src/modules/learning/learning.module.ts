import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LearningService } from './learning.service';

/**
 * Learning from reviewer feedback: distils a block comment into standing
 * knowledge snippets via the `feedback-learner` agent. Imported by
 * `SessionsModule`, which calls it at feedback-save time — never the other
 * way round, so there is no dependency cycle. No controller of its own:
 * `SessionsController`'s existing feedback endpoint is the only door in.
 */
@Module({
  imports: [MastraModule, KnowledgeModule],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
