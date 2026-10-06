import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  DeveloperSettingsService,
  type DeveloperSettingsView,
  type ProbeResult,
} from './developer-settings.service';

@Controller('developer-settings')
export class DeveloperSettingsController {
  constructor(private readonly developerSettings: DeveloperSettingsService) {}

  @Get()
  getSettings(): DeveloperSettingsView {
    return this.developerSettings.getView();
  }

  @Put()
  saveSettings(@Body() body: unknown): {
    ok: boolean;
    message: string;
    settings?: DeveloperSettingsView;
  } {
    try {
      const settings = this.developerSettings.save(body);
      return {
        ok: true,
        message: settings.restartRequired
          ? 'Developer settings saved — restart to apply'
          : 'Developer settings saved',
        settings,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post('test-endpoint')
  testEndpoint(@Body() body: { endpoint?: unknown }): Promise<ProbeResult> {
    return this.developerSettings.testEndpoint(body?.endpoint);
  }
}
