import { RequirePermission } from '../../common/decorators/auth-requirement.decorators';
import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { LlmService } from './llm.service';
import type {
  EffortLevelsView,
  LlmSettingsView,
  ReasoningEffort,
  SaveLlmSettingsDto,
} from './llm.types';

@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('settings')
  @RequirePermission('use-agents')
  getSettings(): Promise<LlmSettingsView> {
    return this.llmService.getView();
  }

  @Get('effort-levels')
  @RequirePermission('use-agents')
  effortLevels(@Query('model') model?: string): EffortLevelsView {
    return this.llmService.effortLevels(model);
  }

  @Put('settings')
  @RequirePermission('manage-llm')
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
  @RequirePermission('manage-llm')
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
  @RequirePermission('manage-llm')
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
