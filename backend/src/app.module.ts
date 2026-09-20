import { Module } from '@nestjs/common';
import { DatabaseModule } from './infrastructure/database/database.module';
import { DatasourcesModule } from './modules/datasources/datasources.module';
import { LlmModule } from './modules/llm/llm.module';
import { SandboxModule } from './modules/sandbox/sandbox.module';
import { MastraModule } from './mastra/mastra.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { VerifiedQueriesModule } from './modules/verified-queries/verified-queries.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { DeepAnalysisModule } from './modules/deep-analysis/deep-analysis.module';

@Module({
  imports: [
    DatabaseModule,
    DatasourcesModule,
    LlmModule,
    SandboxModule,
    MastraModule,
    VerifiedQueriesModule,
    MetricsModule,
    SessionsModule,
    DeepAnalysisModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
