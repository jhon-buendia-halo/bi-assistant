import { Module } from '@nestjs/common';
import { DatabaseModule } from './infrastructure/database/database.module';
import { DatasourcesModule } from './modules/datasources/datasources.module';
import { LlmModule } from './modules/llm/llm.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { MastraModule } from './mastra/mastra.module';
import { AgentsModule } from './modules/agents/agents.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { VerifiedQueriesModule } from './modules/verified-queries/verified-queries.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { TestingDataModule } from './modules/testing-data/testing-data.module';
import { DeveloperSettingsModule } from './modules/developer-settings/developer-settings.module';
import { UiPreferencesModule } from './modules/ui-preferences/ui-preferences.module';
import { SkillsModule } from './modules/skills/skills.module';
import { SyntheticDataModule } from './modules/synthetic-data/synthetic-data.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ConversationExportModule } from './modules/conversation-export/conversation-export.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    DatabaseModule,
    // Global: Avery's conversation export, which the sessions' turn engine
    // reaches by token (agents.md 3.18).
    ConversationExportModule,
    DatasourcesModule,
    LlmModule,
    DatasetsModule,
    MastraModule,
    AgentsModule,
    WorkflowsModule,
    SkillsModule,
    VerifiedQueriesModule,
    MetricsModule,
    OntologyModule,
    SessionsModule,
    TestingDataModule,
    DeveloperSettingsModule,
    UiPreferencesModule,
    SyntheticDataModule,
    MonitoringModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
