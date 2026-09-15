import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { LlmService } from './llm.service';
import type {
  LlmSettingsView,
  ReasoningEffort,
  SaveLlmSettingsDto,
} from './llm.types';

@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('settings')
  getSettings(): Promise<LlmSettingsView> {
    return this.llmService.getView();
  }

  @Put('settings')
  async saveSettings(
    @Body() dto: SaveLlmSettingsDto,
  ): Promise<{ ok: boolean; message: string; settings?: LlmSettingsView }> {
    try {
      const settings = await this.llmService.save(dto);
      return { ok: true, message: 'Configuration saved', settings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Put('reasoning')
  async saveReasoning(
    @Body() body: { effort?: ReasoningEffort },
  ): Promise<{ ok: boolean; message: string; settings?: LlmSettingsView }> {
    try {
      const settings = await this.llmService.setReasoningEffort(
        body?.effort as ReasoningEffort,
      );
      return {
        ok: true,
        message: `Reasoning effort set to ${settings.reasoningEffort}`,
        settings,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post('test-connection')
  async testConnection(
    @Body() dto: SaveLlmSettingsDto,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.llmService.testConnection(dto);
      return {
        ok: true,
        message: `Connection successful — ${result.provider}/${result.model} replied "${result.reply}" in ${result.latencyMs}ms`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
