import { Module } from '@nestjs/common';
import { DatasourcesModule } from '../datasources/datasources.module';
import { DataReadinessController } from './data-readiness.controller';
import { DataReadinessRepository } from './data-readiness.repository';
import { DataReadinessService } from './data-readiness.service';

@Module({
  imports: [DatasourcesModule],
  controllers: [DataReadinessController],
  providers: [DataReadinessService, DataReadinessRepository],
  exports: [DataReadinessService],
})
export class DataReadinessModule {}
