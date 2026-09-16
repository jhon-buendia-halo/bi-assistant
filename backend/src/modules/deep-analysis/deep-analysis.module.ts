import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { ProjectsModule } from '../projects/projects.module';
import { DeepAnalysisController } from './deep-analysis.controller';
import { DeepAnalysisService } from './deep-analysis.service';

@Module({
  imports: [MastraModule, ProjectsModule],
  controllers: [DeepAnalysisController],
  providers: [DeepAnalysisService],
  exports: [DeepAnalysisService],
})
export class DeepAnalysisModule {}
