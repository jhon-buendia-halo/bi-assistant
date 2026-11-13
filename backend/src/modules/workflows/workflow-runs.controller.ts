import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  FilePanelItem,
  InteractiveVisualization,
} from '../sessions/entities/session.entity';
import type { NodeChatMessage } from './node-chat-context';
import { WorkflowNodeChatsService } from './workflow-node-chats.service';
import type { WorkflowRun, WorkflowRunSummary } from './workflow-run-steps';
import {
  WorkflowRunsService,
  type RunAttachment,
  type RunVisualResult,
} from './workflow-runs.service';
import { streamSse } from './workflows.controller';

/** A positive integer `version` query, else undefined (as api.md 9, 14). */
function parseVersion(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Send a file as an attachment, its name made header-safe. */
function sendAttachment(res: Response, file: RunAttachment): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Length', file.body.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename.replace(/["\\\r\n]/g, '_')}"`,
  );
  res.send(file.body);
}

/**
 * Stored workflow runs (api.md 2.6.3, 120-137; capability workflows): the
 * run history, one run, its deletion, its visuals and panel files, served
 * from its workspace as a session's are (9, 14, 106-107), and the chats
 * with its steps' agents (136, 137). Style B: a refusal answers its real
 * status.
 */
@Controller('workflow-runs')
export class WorkflowRunsController {
  constructor(
    private readonly runs: WorkflowRunsService,
    private readonly nodeChats: WorkflowNodeChatsService,
  ) {}

  /** The run history, newest first (api.md 120). */
  @Get()
  async list(
    @Query('workflowId') workflowId?: string,
  ): Promise<{ runs: WorkflowRunSummary[] }> {
    return {
      runs: await this.runs.list(
        typeof workflowId === 'string' && workflowId ? workflowId : undefined,
      ),
    };
  }

  /** One run (api.md 121). */
  @Get(':id')
  get(@Param('id') id: string): Promise<WorkflowRun> {
    return this.runs.get(id);
  }

  /** Rate the run's answer: a thumbs-up saves a verified query (api.md 128). */
  @Post(':id/answer/feedback')
  async rateAnswer(
    @Param('id') id: string,
    @Body() body: { rating?: string },
  ): Promise<{ ok: true; message: string; run: WorkflowRun }> {
    const run = await this.runs.rateAnswer(id, body?.rating);
    return {
      ok: true,
      message:
        body?.rating === 'up'
          ? 'Answer saved as a verified query'
          : 'Answer marked as wrong',
      run,
    };
  }

  /** Delete a run with its workspace (api.md 122). */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ ok: true; message: string }> {
    await this.runs.delete(id);
    return { ok: true, message: 'Run deleted' };
  }

  /** A step's chat in a run: its messages, oldest first (api.md 136). */
  @Get(':id/node-chats/:stepId')
  async nodeChat(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ): Promise<{ messages: NodeChatMessage[] }> {
    return { messages: await this.nodeChats.messages(id, stepId) };
  }

  /**
   * Chat with a step's agent about the run's data, streamed (api.md 137;
   * agents.md 5.16). Refusals answer their real status before the stream
   * starts (Style B); closing the connection stops the turn.
   */
  @Post(':id/node-chats/:stepId/messages/stream')
  @HttpCode(200)
  async streamNodeChat(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.nodeChats.prepare(id, stepId, body);
    await streamSse(res, (send, signal) =>
      this.nodeChats.stream(prepared, send, signal),
    );
  }

  /** A run's visual (api.md 123). */
  @Get(':id/visualizations/:visualizationId')
  getVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Query('version') version?: string,
  ): Promise<InteractiveVisualization> {
    return this.runs.getVisualization(
      id,
      visualizationId,
      parseVersion(version),
    );
  }

  /** Generate a visual from the run's answer (api.md 130). */
  @Post(':id/visualizations')
  async generateVisualization(
    @Param('id') id: string,
    @Body() body: { sourceMessageAt?: string },
  ): Promise<{ ok: true; message: string } & RunVisualResult> {
    const result = await this.runs.generateVisualization(
      id,
      typeof body?.sourceMessageAt === 'string'
        ? body.sourceMessageAt
        : undefined,
    );
    return { ok: true, message: 'Interactive visual generated', ...result };
  }

  /** Tailor a run's visual from an instruction (api.md 131). */
  @Post(':id/visualizations/:visualizationId/tailor')
  async tailorVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Body() body: { instruction?: string },
  ): Promise<{ ok: true; message: string } & RunVisualResult> {
    const result = await this.runs.tailorVisualization(
      id,
      visualizationId,
      typeof body?.instruction === 'string' ? body.instruction : '',
    );
    return {
      ok: true,
      message: `Updated to version ${result.visualization.version}`,
      ...result,
    };
  }

  /** Move a run's visual to an earlier version (api.md 132). */
  @Post(':id/visualizations/:visualizationId/revert')
  async revertVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Body() body: { version?: number },
  ): Promise<{ ok: true; message: string } & RunVisualResult> {
    const result = await this.runs.revertVisualization(
      id,
      visualizationId,
      Number(body?.version),
    );
    return {
      ok: true,
      message: `Reverted to version ${result.visualization.version}`,
      ...result,
    };
  }

  /** Re-run the SQL behind a run's visual (api.md 133). */
  @Post(':id/visualizations/:visualizationId/refresh')
  async refreshVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
  ): Promise<{ ok: true; message: string } & RunVisualResult> {
    const result = await this.runs.refreshVisualization(id, visualizationId);
    return {
      ok: true,
      message: `Refreshed data for version ${result.visualization.version}`,
      ...result,
    };
  }

  /** Repair a run's failing visual once (api.md 134). */
  @Post(':id/visualizations/:visualizationId/repair')
  async repairVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Body() body: { error?: string; version?: number },
  ): Promise<{ ok: true; message: string } & RunVisualResult> {
    const result = await this.runs.repairVisualization(
      id,
      visualizationId,
      typeof body?.error === 'string' ? body.error : '',
      Number(body?.version),
    );
    return {
      ok: true,
      message: `Repaired as version ${result.visualization.version}`,
      ...result,
    };
  }

  /** A run's visual as a zip (api.md 124). */
  @Get(':id/visualizations/:visualizationId/download')
  async downloadVisualization(
    @Param('id') id: string,
    @Param('visualizationId') visualizationId: string,
    @Res() res: Response,
    @Query('version') version?: string,
  ): Promise<void> {
    const { filename, archive } = await this.runs.downloadVisualization(
      id,
      visualizationId,
      parseVersion(version),
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', archive.length);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(archive);
  }

  /** A run's file item's text (api.md 125). */
  @Get(':id/panel-items/:itemId/file')
  panelItemFile(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<{ item: FilePanelItem; contentType: string; text: string }> {
    return this.runs.panelItemFile(id, itemId);
  }

  /** A run's panel item as an attachment (api.md 126). */
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
    sendAttachment(
      res,
      await this.runs.downloadPanelItem(
        id,
        itemId,
        format as 'pdf' | 'md' | 'csv' | undefined,
      ),
    );
  }
}
