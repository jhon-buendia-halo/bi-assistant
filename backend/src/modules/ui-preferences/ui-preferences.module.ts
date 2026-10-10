import { Module } from '@nestjs/common';
import { UiPreferencesRepository } from './repositories/ui-preferences.repository';
import { UiPreferencesController } from './ui-preferences.controller';
import { UiPreferencesService } from './ui-preferences.service';

/** The renderer's remembered theme and drawer state (ADR-0009). */
@Module({
  controllers: [UiPreferencesController],
  providers: [UiPreferencesService, UiPreferencesRepository],
})
export class UiPreferencesModule {}
