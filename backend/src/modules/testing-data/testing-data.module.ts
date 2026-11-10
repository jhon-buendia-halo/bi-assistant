import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OntologyModule } from '../ontology/ontology.module';
import { TestingDataController } from './testing-data.controller';
import { TestingDataService } from './testing-data.service';

@Module({
  // Ontology and metrics: a domain sample's knowledge seed is created
  // through their services when the sample is loaded (testing-data R26).
  imports: [DatasourcesModule, DatasetsModule, OntologyModule, MetricsModule],
  controllers: [TestingDataController],
  providers: [TestingDataService],
  exports: [TestingDataService],
})
export class TestingDataModule {}
