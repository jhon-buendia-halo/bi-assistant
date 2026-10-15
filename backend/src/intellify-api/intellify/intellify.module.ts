import { Module } from '@nestjs/common';
import { IntellifyClientsController } from './clients.controller';
import { IntellifyCollectionsController } from './collections.controller';
import { IntellifyReadService } from './intellify-read.service';

/**
 * Read-only routes over the Intellify data (api.md 2.16.2-2.16.3).
 * `DbService` is globally available; the read service is exported for reuse.
 */
@Module({
  controllers: [IntellifyCollectionsController, IntellifyClientsController],
  providers: [IntellifyReadService],
  exports: [IntellifyReadService],
})
export class IntellifyReadModule {}
