import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TestingDataController } from './testing-data.controller';
import { TestingDataService } from './testing-data.service';

@Module({
  // Knowledge and metrics: a domain sample's knowledge seed is created
  // through their services when the sample is loaded (testing-data R26).
  imports: [DatasourcesModule, DatasetsModule, KnowledgeModule, MetricsModule],
  controllers: [TestingDataController],
  providers: [TestingDataService],
  exports: [TestingDataService],
})
export class TestingDataModule {}
