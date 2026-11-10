import { Module } from '@nestjs/common';
import { VisualsController } from './visuals.controller';
import { VisualsService } from './visuals.service';
import { VisualsRepository } from './repositories/visuals.repository';

@Module({
  controllers: [VisualsController],
  providers: [VisualsService, VisualsRepository],
  exports: [VisualsService],
})
export class VisualsModule {}
