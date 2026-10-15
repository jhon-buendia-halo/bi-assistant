import { Module } from '@nestjs/common';
import { DatasourcesModule } from '../datasources/datasources.module';
import { RfpPackagesService } from './rfp-packages.service';

/**
 * The RFP Builder's side of the Intellify RFP API (ADR-0028): the tools'
 * REST target and the package export, installed on the tool-services bridge
 * by `SessionsService`, which also serves the package download (api.md #105).
 */
@Module({
  imports: [DatasourcesModule],
  providers: [RfpPackagesService],
  exports: [RfpPackagesService],
})
export class RfpPackagesModule {}
