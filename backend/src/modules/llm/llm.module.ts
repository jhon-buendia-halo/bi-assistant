import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';

@Module({
  imports: [CryptoModule],
  controllers: [LlmController],
  providers: [LlmService, LlmSettingsRepository],
  exports: [LlmService],
})
export class LlmModule {}
