import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { SessionDoc } from './entities/session.entity';
import type {
  FilePanelItem,
  InteractiveVisualization,
} from './entities/session.entity';
import type { Response } from 'express';

/**
 * The stored sessions' read routes (api.md 2.1): since 1.23.22 nothing starts
 * or continues a chat, so a past chat is listed, opened, downloaded from and
 * deleted, and nothing writes to it.
 */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  async list(): Promise<{ sessions: SessionDoc[] }> {
    return {
      sessions: await this.sessionsService.toViews(
        await this.sessionsService.list(),
      ),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<SessionDoc> {
    return this.sessionsService.toView(await this.sessionsService.get(id));
  }

  @Get(':id/visualizations/:visualizationId')
  getVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Query('version') version?: string,
  ): Promise<InteractiveVisualization> {
    return this.sessionsService.getVisualization(
      id,
      visualizationId,
      parseVersion(version),
    );
  }

  @Get(':id/visualizations/:visualizationId/download')
  async downloadVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Res() res: Response,
    @Query('version') version?: string,
  ): Promise<void> {
    const { filename, archive } =
      await this.sessionsService.downloadVisualization(
        id,
        visualizationId,
        parseVersion(version),
      );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', archive.length);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(archive);
  }

  /** An RFP package the session's RFP Builder exported, or one file of it (api.md #105). */
  @Get(':id/rfp-packages/:rfpId/download')
  async downloadRfpPackage(
    @Param('id') id: string,
    @Param('rfpId') rfpId: string,
    @Res() res: Response,
    @Query('file') file?: string,
    @Query('draft') draft?: string,
  ): Promise<void> {
    const { filename, contentType, body } =
      await this.sessionsService.downloadRfpPackage(
        id,
        rfpId,
        typeof file === 'string' ? file : undefined,
        draft === 'true',
      );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`,
    );
    res.send(body);
  }

  /** A file item's text from the session workspace (api.md #106). */
  @Get(':id/panel-items/:itemId/file')
  panelItemFile(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<{ item: FilePanelItem; contentType: string; text: string }> {
    return this.sessionsService.panelItemFile(id, itemId);
  }

  /** A panel item as an attachment: file, document (.md) or table (.csv) (api.md #107). */
  @Get(':id/panel-items/:itemId/download')
  async downloadPanelItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Res() res: Response,
    @Query('format') format?: string,
  ): Promise<void> {
    if (format !== undefined && !['pdf', 'md', 'csv'].includes(format)) {
      throw new BadRequestException(
        `Unknown download format "${format}": use pdf, md or csv`,
      );
    }
    const { filename, contentType, body } =
      await this.sessionsService.downloadPanelItem(
        id,
        itemId,
        format as 'pdf' | 'md' | 'csv' | undefined,
      );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`,
    );
    res.send(body);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const session = await this.sessionsService.delete(id);
      return {
        ok: true,
        message: `Session "${session.name}" deleted`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}

function parseVersion(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
