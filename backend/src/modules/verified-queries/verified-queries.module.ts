import { Module } from '@nestjs/common';
import { VerifiedQueriesService } from './verified-queries.service';
import { VerifiedQueriesRepository } from './repositories/verified-queries.repository';

@Module({
  providers: [VerifiedQueriesService, VerifiedQueriesRepository],
  exports: [VerifiedQueriesService],
})
export class VerifiedQueriesModule {}
