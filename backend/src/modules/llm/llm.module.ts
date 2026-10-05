import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { EngineModule } from '../engine/engine.module';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';

@Module({
  // EngineModule has no imports of its own (see its module comment), so
  // importing it here cannot form a cycle with LlmModule.
  imports: [CryptoModule, EngineModule],
  controllers: [LlmController],
  providers: [LlmService, LlmSettingsRepository],
  exports: [LlmService],
})
export class LlmModule {}
