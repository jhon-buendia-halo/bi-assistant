import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { ProjectDoc } from './entities/project.entity';
import type { InteractiveVisualization } from './entities/project.entity';
import type { Response } from 'express';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async list(): Promise<{ projects: ProjectDoc[] }> {
    return { projects: await this.projectsService.list() };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProjectDoc> {
    return this.projectsService.get(id);
  }

  @Get(':id/visualizations/:visualizationId')
  getVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
  ): Promise<InteractiveVisualization> {
    return this.projectsService.getVisualization(id, visualizationId);
  }

  @Get(':id/visualizations/:visualizationId/download')
  async downloadVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, archive } =
      await this.projectsService.downloadVisualization(id, visualizationId);
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
      const project = await this.projectsService.delete(id);
      return { ok: true, message: `Project "${project.name}" deleted` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post()
  async create(
    @Body() body: { name?: string; sandboxes?: string[] },
  ): Promise<{ ok: boolean; message: string; project?: ProjectDoc }> {
    try {
      const project = await this.projectsService.create(
        body?.name ?? '',
        body?.sandboxes ?? [],
      );
      return {
        ok: true,
        message: `Project "${project.name}" created`,
        project,
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
    project?: ProjectDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.projectsService.generateVisualization(
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
  // `done` with the persisted project.
  @Post(':id/messages/stream')
  async streamMessage(
    @Param('id') id: string,
    @Body() body: { content?: string },
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
      await this.projectsService.streamMessage(
        id,
        body?.content ?? '',
        send,
        controller.signal,
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

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { content?: string },
  ): Promise<{ ok: boolean; message: string; project?: ProjectDoc }> {
    try {
      const project = await this.projectsService.sendMessage(
        id,
        body?.content ?? '',
      );
      return { ok: true, message: 'Message sent', project };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
