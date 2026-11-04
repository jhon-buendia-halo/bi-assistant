import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { EMBEDDING_KEY_RESOLVER } from './embedding-key';
import { EmbeddingKeyService } from './embedding-key.service';
import { LEARNING_STORE } from './learning-store.port';
import { LEARNING_STORE_MAINTENANCE } from './learning-store-maintenance';
import { createMastraLearningStore } from './mastra-learning-store.factory';
import { MemoryController } from './memory.controller';
import { MemoryOutboxService } from './memory-outbox.service';
import { MemoryService } from './memory.service';
import { MemorySettingsRepository } from './repositories/memory-settings.repository';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';

/**
 * The memory of past sessions (ADR-0033, knowledge R30 to R43): the
 * `LearningStore` port with its "Mastra only" implementation, the
 * `memory_signals` outbox, the lever and the routes of api.md 108 to 110.
 * Depends on the global `DatabaseModule` and on `LlmModule` (the embedding
 * key); `SessionsModule` and `DatasourcesModule` import it, never the other
 * way round.
 */
@Module({
  imports: [LlmModule],
  controllers: [MemoryController],
  providers: [
    EmbeddingKeyService,
    { provide: EMBEDDING_KEY_RESOLVER, useExisting: EmbeddingKeyService },
    {
      provide: LEARNING_STORE,
      inject: [EMBEDDING_KEY_RESOLVER],
      useFactory: createMastraLearningStore,
    },
    { provide: LEARNING_STORE_MAINTENANCE, useExisting: LEARNING_STORE },
    MemorySettingsRepository,
    MemorySignalsRepository,
    MemoryOutboxService,
    MemoryService,
  ],
  exports: [MemoryService],
})
export class MemoryModule {}
