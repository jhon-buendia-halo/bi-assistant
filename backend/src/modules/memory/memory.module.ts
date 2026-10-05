import { Module } from '@nestjs/common';
import type { HindsightClient } from '@vectorize-io/hindsight-client';
import {
  HINDSIGHT_CLIENT,
  buildHindsightClient,
} from '../../infrastructure/memory/hindsight.client';
import { EngineModule } from '../engine/engine.module';
import { HindsightLearningStore } from './hindsight-learning-store';
import { LEARNING_STORE } from './learning-store.port';
import { MemoryBankService } from './memory-bank.service';
import { MemoryOutboxService } from './memory-outbox.service';
import { NoopLearningStore } from './noop-learning-store';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';

/**
 * The learning memory (ADR-0013): the `LearningStore` port — Hindsight when
 * `HINDSIGHT_URL` is set, a no-op otherwise — the signal outbox and the
 * per-datasource bank set-up. Depends only on the global `DatabaseModule`
 * and `EngineModule` (the production `memory` lever); `SessionsModule` and
 * `KnowledgeModule` import it, never the other way round.
 */
@Module({
  imports: [EngineModule],
  providers: [
    { provide: HINDSIGHT_CLIENT, useFactory: () => buildHindsightClient() },
    {
      provide: LEARNING_STORE,
      inject: [HINDSIGHT_CLIENT],
      useFactory: (client: HindsightClient | null) =>
        client ? new HindsightLearningStore(client) : new NoopLearningStore(),
    },
    MemorySignalsRepository,
    MemoryBankService,
    MemoryOutboxService,
  ],
  exports: [LEARNING_STORE, MemoryOutboxService, MemoryBankService],
})
export class MemoryModule {}
