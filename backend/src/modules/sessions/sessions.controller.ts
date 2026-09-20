import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { SessionDoc } from './entities/session.entity';
import type {
  InteractiveVisualization,
  MessageFeedback,
} from './entities/session.entity';
import type { Response } from 'express';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  async list(): Promise<{ sessions: SessionDoc[] }> {
    return { sessions: await this.sessionsService.list() };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<SessionDoc> {
    return this.sessionsService.get(id);
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

  @Post(':id/visualizations/:visualizationId/revert')
  async revertVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Body() body: { version?: number },
  ): Promise<{
    ok: boolean;
    message: string;
    session?: SessionDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.sessionsService.revertVisualization(
        id,
        visualizationId,
        Number(body?.version),
      );
      return {
        ok: true,
        message: `Reverted to version ${result.visualization.version}`,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post(':id/visualizations/:visualizationId/repair')
  async repairVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Body() body: { error?: string; version?: number },
  ): Promise<{
    ok: boolean;
    message: string;
    session?: SessionDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.sessionsService.repairVisualization(
        id,
        visualizationId,
        body?.error ?? '',
        Number(body?.version),
      );
      return {
        ok: true,
        message: `Repaired as version ${result.visualization.version}`,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post(':id/visualizations/:visualizationId/tailor')
  async tailorVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Body() body: { instruction?: string },
  ): Promise<{
    ok: boolean;
    message: string;
    session?: SessionDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.sessionsService.tailorVisualization(
        id,
        visualizationId,
        body?.instruction ?? '',
      );
      return {
        ok: true,
        message: `Updated to version ${result.visualization.version}`,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post(':id/visualizations/:visualizationId/refresh')
  async refreshVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
  ): Promise<{
    ok: boolean;
    message: string;
    session?: SessionDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.sessionsService.refreshVisualizationData(
        id,
        visualizationId,
      );
      return {
        ok: true,
        message: `Refreshed data for version ${result.visualization.version}`,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
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
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(archive);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const session = await this.sessionsService.delete(id);
      return { ok: true, message: `Session "${session.name}" deleted` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post()
  async create(
    @Body() body: { name?: string; sandboxes?: string[] },
  ): Promise<{ ok: boolean; message: string; session?: SessionDoc }> {
    try {
      const session = await this.sessionsService.create(
        body?.name ?? '',
        body?.sandboxes ?? [],
      );
      return {
        ok: true,
        message: `Session "${session.name}" created`,
        session,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post(':id/visualizations')
  async generateVisualization(
    @Param('id') id: string,
    @Body() body: { sourceMessageAt?: string },
  ): Promise<{
    ok: boolean;
    message: string;
    session?: SessionDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.sessionsService.generateVisualization(
        id,
        body?.sourceMessageAt ?? '',
      );
      return {
        ok: true,
        message: 'Interactive visual generated',
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  // Server-sent events: reasoning/text deltas while the agent thinks, then
  // `done` with the persisted session.
  @Post(':id/messages/stream')
  async streamMessage(
    @Param('id') id: string,
    @Body()
    body: {
      content?: string;
      activeVisualizationId?: string;
      /** Careful mode: cross-check the answer before finishing the turn. */
      careful?: boolean;
    },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (data: unknown) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      await this.sessionsService.streamMessage(
        id,
        body?.content ?? '',
        send,
        controller.signal,
        typeof body?.activeVisualizationId === 'string'
          ? body.activeVisualizationId
          : undefined,
        body?.careful === true,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', content: message });
      }
    }
    res.off('close', abort);
    if (!res.writableEnded) res.end();
  }

  @Post(':id/messages/feedback')
  async rateMessage(
    @Param('id') id: string,
    @Body() body: { messageAt?: string; rating?: string },
  ): Promise<{ ok: boolean; message: string; session?: SessionDoc }> {
    try {
      const session = await this.sessionsService.recordFeedback(
        id,
        body?.messageAt ?? '',
        body?.rating as MessageFeedback,
      );
      return {
        ok: true,
        message:
          body?.rating === 'up'
            ? 'Answer saved as a verified query'
            : 'Answer marked as wrong',
        session,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { content?: string },
  ): Promise<{ ok: boolean; message: string; session?: SessionDoc }> {
    try {
      const session = await this.sessionsService.sendMessage(
        id,
        body?.content ?? '',
      );
      return { ok: true, message: 'Message sent', session };
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
