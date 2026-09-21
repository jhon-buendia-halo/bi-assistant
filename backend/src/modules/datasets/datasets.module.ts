import { Module } from '@nestjs/common';
import { DatasourcesModule } from '../datasources/datasources.module';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { DatasetsRepository } from './repositories/datasets.repository';

@Module({
  imports: [DatasourcesModule],
  controllers: [DatasetsController],
  providers: [DatasetsService, DatasetsRepository],
  exports: [DatasetsRepository, DatasetsService],
})
export class DatasetsModule {}
