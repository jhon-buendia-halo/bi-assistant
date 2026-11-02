import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import type { MemorySettingsView } from './entities/memory-settings.entity';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  /** The lever and where the embedding key comes from (api.md 108). */
  @Get('settings')
  settings(): Promise<MemorySettingsView> {
    return this.memory.view();
  }

  /** Style A (api.md 109): the view's fields beside `ok` and `message`. */
  @Put('settings')
  async saveSettings(
    @Body() body: { enabled?: unknown },
  ): Promise<{ ok: boolean; message: string } & Partial<MemorySettingsView>> {
    try {
      const view = await this.memory.setEnabled(body?.enabled);
      return {
        ok: true,
        message: view.enabled ? 'Memory turned on' : 'Memory turned off',
        ...view,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  /**
   * Forget one signal (api.md 110). Style B, as `DELETE /knowledge/:id`:
   * 204 once done, 400 for an id that is not a signal's. Express has
   * already decoded the client's `encodeURIComponent`.
   */
  @Delete('signals/:documentId')
  @HttpCode(204)
  async forget(@Param('documentId') documentId: string): Promise<void> {
    await this.memory.forgetSignal(documentId);
  }
}
