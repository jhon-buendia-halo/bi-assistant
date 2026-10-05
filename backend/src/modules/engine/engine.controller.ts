import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  EngineSettingsService,
  type EngineSettingsView,
  type SaveEngineSettingsInput,
} from './engine-settings.service';

@Controller('engine')
export class EngineController {
  constructor(private readonly engineSettings: EngineSettingsService) {}

  @Get('settings')
  getSettings(): Promise<EngineSettingsView> {
    return this.engineSettings.view();
  }

  @Put('settings')
  async saveSettings(
    @Body() body: SaveEngineSettingsInput,
  ): Promise<{ ok: boolean; message: string; settings?: EngineSettingsView }> {
    try {
      const settings = await this.engineSettings.save(body);
      return { ok: true, message: 'Engine settings saved', settings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
