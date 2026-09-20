import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { SessionsModule } from '../sessions/sessions.module';
import { DeepAnalysisController } from './deep-analysis.controller';
import { DeepAnalysisService } from './deep-analysis.service';

@Module({
  imports: [MastraModule, SessionsModule],
  controllers: [DeepAnalysisController],
  providers: [DeepAnalysisService],
  exports: [DeepAnalysisService],
})
export class DeepAnalysisModule {}
