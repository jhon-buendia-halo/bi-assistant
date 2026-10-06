import { Module } from '@nestjs/common';
import { DeveloperSettingsController } from './developer-settings.controller';
import { DeveloperSettingsService } from './developer-settings.service';

@Module({
  controllers: [DeveloperSettingsController],
  providers: [DeveloperSettingsService],
  exports: [DeveloperSettingsService],
})
export class DeveloperSettingsModule {}
