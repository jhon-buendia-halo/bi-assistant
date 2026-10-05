import { Module } from '@nestjs/common';
import { EngineController } from './engine.controller';
import { EngineSettingsService } from './engine-settings.service';
import { EngineSettingsRepository } from './repositories/engine-settings.repository';

/**
 * Engine levers (Settings → Engine levers): persisted production defaults
 * plus the arm/rule-group catalog the Settings UI and the eval runner both
 * read. Depends only on the global `DatabaseModule` — no imports here — so
 * `SessionsModule`, `AgentsModule` and `LlmModule` (Wave 1) can each import
 * `EngineModule` without a cycle.
 */
@Module({
  controllers: [EngineController],
  providers: [EngineSettingsService, EngineSettingsRepository],
  exports: [EngineSettingsService],
})
export class EngineModule {}
