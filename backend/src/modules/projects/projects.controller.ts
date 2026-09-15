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
    @Query('version') version?: string,
  ): Promise<InteractiveVisualization> {
    return this.projectsService.getVisualization(
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
    project?: ProjectDoc;
    visualization?: InteractiveVisualization;
  }> {
    try {
      const result = await this.projectsService.revertVisualization(
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

  @Get(':id/visualizations/:visualizationId/download')
  async downloadVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Res() res: Response,
    @Query('version') version?: string,
  ): Promise<void> {
    const { filename, archive } =
      await this.projectsService.downloadVisualization(
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
    @Body() body: { content?: string; activeVisualizationId?: string },
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
        typeof body?.activeVisualizationId === 'string'
          ? body.activeVisualizationId
          : undefined,
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

function parseVersion(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
