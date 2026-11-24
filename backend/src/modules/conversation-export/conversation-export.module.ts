import { Global, Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import { CONVERSATION_EXPORTER } from './conversation-export.contract';
import { ConversationExportService } from './conversation-export.service';
import { ConversationExportsController } from './conversation-exports.controller';
import { ConversationExportsRepository } from './conversation-exports.repository';

/**
 * Avery's conversation export (agents.md 3.18; ADR-0056), PDF and
 * PowerPoint. Global: the sessions module's turn engine reaches it by its
 * `CONVERSATION_EXPORTER` token, without importing the workflows module it
 * reads runs from (that module imports the sessions module). It reads the
 * runs through its own `WorkflowRunsRepository` (a stateless reader of
 * `workflow_runs`), the dashboards through `ArtifactsService`, and stores
 * `conversation_exports` (data-model 3.20); api.md 167 serves the files.
 */
@Global()
@Module({
  imports: [ArtifactsModule],
  controllers: [ConversationExportsController],
  providers: [
    ConversationExportService,
    ConversationExportsRepository,
    WorkflowRunsRepository,
    { provide: CONVERSATION_EXPORTER, useExisting: ConversationExportService },
  ],
  exports: [CONVERSATION_EXPORTER],
})
export class ConversationExportModule {}
