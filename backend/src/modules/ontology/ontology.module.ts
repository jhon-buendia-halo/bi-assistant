import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OntologyBootstrapService } from './ontology-bootstrap.service';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { OntologyRepository } from './repositories/ontology.repository';

/**
 * Each dataset's ontology (ADR-0036). MastraModule and DatasourcesModule
 * serve the bootstrap agent run, DatasetsModule the dataset checks, and
 * MetricsModule the `measured-by` metric checks and labels.
 */
@Module({
  imports: [MastraModule, DatasetsModule, DatasourcesModule, MetricsModule],
  controllers: [OntologyController],
  providers: [OntologyService, OntologyRepository, OntologyBootstrapService],
  exports: [OntologyService],
})
export class OntologyModule {}
