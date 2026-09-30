import { Module } from '@nestjs/common';
import { AnswerPinsController } from './answer-pins.controller';
import { AnswerPinsService } from './answer-pins.service';
import { AnswerPinsRepository } from './repositories/answer-pins.repository';

/**
 * Answer pinning: one saved answer per question lineage, replayed while its
 * fingerprint (knowledge/metrics/schema/model) holds and its SQL still
 * returns the same rows. `DatabaseModule` is `@Global()`, so the
 * `ANSWER_PINS_STORE` token the repository injects needs no import here.
 * `SessionsModule` (unit D) imports this module for the service; this module
 * never imports `SessionsModule` back.
 */
@Module({
  controllers: [AnswerPinsController],
  providers: [AnswerPinsService, AnswerPinsRepository],
  exports: [AnswerPinsService],
})
export class AnswerPinsModule {}
