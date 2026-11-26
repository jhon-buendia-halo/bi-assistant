import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { OntologyRepository } from './repositories/ontology.repository';

/**
 * Each dataset's ontology (ADR-0036). DatasetsModule serves the dataset
 * checks, and MetricsModule the `measured-by` metric checks and labels.
 */
@Module({
  imports: [DatasetsModule, MetricsModule],
  controllers: [OntologyController],
  providers: [OntologyService, OntologyRepository],
  exports: [OntologyService],
})
export class OntologyModule {}
