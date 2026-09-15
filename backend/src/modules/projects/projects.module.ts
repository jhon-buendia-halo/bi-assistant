import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { DatabricksModule } from '../databricks/databricks.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './repositories/projects.repository';

@Module({
  imports: [MastraModule, SandboxModule, DatabricksModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
