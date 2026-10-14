import { Module } from '@nestjs/common';
import { RfpModule } from '../rfp/rfp.module';
import { ExhibitsQueries } from './exhibits.queries';
import { PackageController } from './package.controller';
import { PackageService } from './package.service';

/**
 * The RFP package export (api.md 2.16.5). `DbService` is globally available;
 * the record comes from `RfpService`.
 */
@Module({
  imports: [RfpModule],
  controllers: [PackageController],
  providers: [PackageService, ExhibitsQueries],
})
export class PackageModule {}
