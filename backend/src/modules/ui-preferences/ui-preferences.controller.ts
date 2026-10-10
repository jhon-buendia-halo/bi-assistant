import { Body, Controller, Get, Put } from '@nestjs/common';
import type { UiPreferences } from './entities/ui-preferences.entity';
import { UiPreferencesService } from './ui-preferences.service';

@Controller('ui-preferences')
export class UiPreferencesController {
  constructor(private readonly preferences: UiPreferencesService) {}

  @Get()
  get(): Promise<UiPreferences> {
    return this.preferences.get();
  }

  @Put()
  async save(@Body() body: unknown): Promise<{
    ok: boolean;
    message: string;
    preferences?: UiPreferences;
  }> {
    try {
      const preferences = await this.preferences.save(body);
      return { ok: true, message: 'Preferences saved', preferences };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
