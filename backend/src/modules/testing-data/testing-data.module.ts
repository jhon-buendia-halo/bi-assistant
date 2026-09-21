import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { TestingDataController } from './testing-data.controller';
import { TestingDataService } from './testing-data.service';

@Module({
  imports: [DatasourcesModule, DatasetsModule],
  controllers: [TestingDataController],
  providers: [TestingDataService],
  exports: [TestingDataService],
})
export class TestingDataModule {}
