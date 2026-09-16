import { Module } from '@nestjs/common';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsRepository } from './repositories/metrics.repository';

@Module({
  imports: [VerifiedQueriesModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsRepository],
  exports: [MetricsService],
})
export class MetricsModule {}
