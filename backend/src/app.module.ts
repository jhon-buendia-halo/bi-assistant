import { Module } from '@nestjs/common';
import { DatabaseModule } from './infrastructure/database/database.module';
import { DatasourcesModule } from './modules/datasources/datasources.module';
import { LlmModule } from './modules/llm/llm.module';
import { SandboxModule } from './modules/sandbox/sandbox.module';
import { MastraModule } from './mastra/mastra.module';
import { ProjectsModule } from './modules/projects/projects.module';

@Module({
  imports: [
    DatabaseModule,
    DatasourcesModule,
    LlmModule,
    SandboxModule,
    MastraModule,
    ProjectsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
