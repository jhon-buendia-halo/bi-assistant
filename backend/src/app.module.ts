import { Module } from '@nestjs/common';
import { DatabaseModule } from './infrastructure/database/database.module';
import { DatasourcesModule } from './modules/datasources/datasources.module';
import { LlmModule } from './modules/llm/llm.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { MastraModule } from './mastra/mastra.module';
import { AgentsModule } from './modules/agents/agents.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { RfpPackagesModule } from './modules/rfp-packages/rfp-packages.module';
import { VerifiedQueriesModule } from './modules/verified-queries/verified-queries.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { PersonasModule } from './modules/personas/personas.module';
import { VisualsModule } from './modules/visuals/visuals.module';
import { DeepAnalysisModule } from './modules/deep-analysis/deep-analysis.module';
import { TestingDataModule } from './modules/testing-data/testing-data.module';
import { DeveloperSettingsModule } from './modules/developer-settings/developer-settings.module';
import { UiPreferencesModule } from './modules/ui-preferences/ui-preferences.module';
import { SkillsModule } from './modules/skills/skills.module';
import { DataReadinessModule } from './modules/data-readiness/data-readiness.module';
import { SyntheticDataModule } from './modules/synthetic-data/synthetic-data.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    DatabaseModule,
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
    PersonasModule,
    VisualsModule,
    SessionsModule,
    RfpPackagesModule,
    DeepAnalysisModule,
    TestingDataModule,
    DeveloperSettingsModule,
    UiPreferencesModule,
    DataReadinessModule,
    SyntheticDataModule,
    MonitoringModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
