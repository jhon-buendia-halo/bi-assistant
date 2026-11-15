import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { LlmModule } from '../llm/llm.module';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OntologyModule } from '../ontology/ontology.module';
import { UserAgentsModule } from '../user-agents/user-agents.module';
import { DataReadinessModule } from '../data-readiness/data-readiness.module';
import { SyntheticDataModule } from '../synthetic-data/synthetic-data.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import { QueryEvidenceService } from './query-evidence/query-evidence.service';
import { QUERY_EVIDENCE_SERVICE } from './query-evidence/query-evidence.token';

@Module({
  imports: [
    MastraModule,
    DatasetsModule,
    DatasourcesModule,
    LlmModule,
    VerifiedQueriesModule,
    MetricsModule,
    OntologyModule,
    UserAgentsModule,
    DataReadinessModule,
    SyntheticDataModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionsRepository,
    VisualizationService,
    QueryEvidenceService,
    { provide: QUERY_EVIDENCE_SERVICE, useExisting: QueryEvidenceService },
  ],
  exports: [SessionsService, QueryEvidenceService, QUERY_EVIDENCE_SERVICE],
})
export class SessionsModule {}
