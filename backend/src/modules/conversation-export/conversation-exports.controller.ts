import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConversationExportService } from './conversation-export.service';

/**
 * The conversation exports (api.md 167): Avery makes them in a run
 * (agents.md 3.18); this route serves their files.
 */
@Controller('conversation-exports')
export class ConversationExportsController {
  constructor(private readonly exports: ConversationExportService) {}

  /**
   * One file of an export as an attachment named after it (api.md 167):
   * `format` is `pdf` or `pptx` (400 otherwise); 404 for an unknown export
   * or a format it does not have.
   */
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('format') format?: unknown,
  ): Promise<void> {
    const file = await this.exports.download(id, format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    res.setHeader('Content-Length', file.data.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.data);
  }
}
