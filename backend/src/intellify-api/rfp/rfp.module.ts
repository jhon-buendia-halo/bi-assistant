import { Module } from '@nestjs/common';
import { RfpController } from './rfp.controller';
import { RfpRepository } from './rfp.repository';
import { RfpService } from './rfp.service';

/**
 * RFP record routes (api.md 2.16.4). `DbService` is globally available;
 * `RfpService` is exported for the package export (2.16.5).
 */
@Module({
  controllers: [RfpController],
  providers: [RfpService, RfpRepository],
  exports: [RfpService],
})
export class RfpModule {}
