import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  FilePanelItem,
  InteractiveVisualization,
} from '../sessions/entities/session.entity';
import type { WorkflowRun, WorkflowRunSummary } from './workflow-run-steps';
import {
  WorkflowRunsService,
  type RunAttachment,
} from './workflow-runs.service';

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
 * Stored workflow runs (api.md 2.6.3, 120-127; capability workflows): the
 * run history, one run, its deletion, and its visuals, panel files and RFP
 * packages, served from its workspace as a session's are (9, 14, 105-107).
 * Style B: a refusal answers its real status.
 */
@Controller('workflow-runs')
export class WorkflowRunsController {
  constructor(private readonly runs: WorkflowRunsService) {}

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

  /** Delete a run with its workspace (api.md 122). */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ ok: true; message: string }> {
    await this.runs.delete(id);
    return { ok: true, message: 'Run deleted' };
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

  /** A run's RFP package, or one file of it (api.md 127). */
  @Get(':id/rfp-packages/:rfpId/download')
  async downloadRfpPackage(
    @Param('id') id: string,
    @Param('rfpId') rfpId: string,
    @Res() res: Response,
    @Query('file') file?: string,
    @Query('draft') draft?: string,
  ): Promise<void> {
    sendAttachment(
      res,
      await this.runs.downloadRfpPackage(
        id,
        rfpId,
        typeof file === 'string' ? file : undefined,
        draft === 'true',
      ),
    );
  }
}
