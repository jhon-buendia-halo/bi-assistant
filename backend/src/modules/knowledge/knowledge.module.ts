import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeRepository } from './repositories/knowledge.repository';

@Module({
  // MemoryModule: curated edits become `knowledge` memory signals.
  imports: [MastraModule, DatasetsModule, DatasourcesModule, MemoryModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeRepository],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
