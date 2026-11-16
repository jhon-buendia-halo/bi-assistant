import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { SiteReviewService } from './site-review.service';
import { SiteSignInsRepository } from './site-signins.repository';

/**
 * Review a Website's browser work (agents.md 5.19; ADR-0049): the crawl,
 * the capture and measures, and the sites' sign-ins, saved encrypted
 * (data-model 3.19). The sessions module imports it: a run's steps reach it
 * through the turn engine's runtime.
 */
@Module({
  imports: [CryptoModule],
  providers: [SiteReviewService, SiteSignInsRepository],
  exports: [SiteReviewService],
})
export class SiteReviewModule {}
