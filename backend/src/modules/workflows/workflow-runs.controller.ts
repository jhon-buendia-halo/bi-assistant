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
import { EXPORT_ROWS } from '../sessions/query-evidence/query-coverage';
import { csvOf } from '../sessions/query-evidence/query-evidence';
import type { QueryRerunResult } from '../sessions/query-evidence/query-evidence.service';
import {
  parseInterpretRequest,
  parsePageRequest,
} from '../sessions/query-evidence/result-view';
import type {
  FilterInterpretation,
  PageResult,
} from '../datasources/connectors/paged-sql.types';
import type { NodeChatMessage } from './node-chat-context';
import { WorkflowNodeChatsService } from './workflow-node-chats.service';
import type { WorkflowRun, WorkflowRunSummary } from './workflow-run-steps';
import {
  WorkflowRunsService,
  type RunAttachment,
  type RunVisualResult,
} from './workflow-runs.service';
import { followSse, streamSse } from './workflows.controller';

/** A positive integer `version` query, else undefined (as api.md 9, 14). */
function parseVersion(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** The `after` query of 149: a whole number of at least 0, else 0. */
function parseAfter(value?: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The `:index` of the evidence routes (api.md 139-143): a whole number, else
 * the same 400 as an index the answer does not have.
 */
function parseQueryIndex(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(
      `Query ${value} not found in the run's answer`,
    );
  }
  return Number(value);
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
    @Query('archived') archived?: string,
  ): Promise<{ runs: WorkflowRunSummary[] }> {
    return {
      runs: await this.runs.list(
        typeof workflowId === 'string' && workflowId ? workflowId : undefined,
        // Archived conversations only when asked for (api.md 120, 159).
        archived === 'true',
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

  /**
   * Build the evidence of an answer stored before the query inspector and
   * size the tables its queries read (api.md 139).
   */
  @Post(':id/answer/evidence')
  async prepareEvidence(
    @Param('id') id: string,
  ): Promise<{ ok: true; run: WorkflowRun }> {
    return { ok: true, run: await this.runs.prepareEvidence(id) };
  }

  /** Explain one query step by step (api.md 140). */
  @Post(':id/answer/queries/:index/explanation')
  async explainQuery(
    @Param('id') id: string,
    @Param('index') index: string,
  ): Promise<{ ok: true; run: WorkflowRun }> {
    return {
      ok: true,
      run: await this.runs.explainQuery(id, parseQueryIndex(index)),
    };
  }

  /** Count the rows after each step of an explained query (api.md 141). */
  @Post(':id/answer/queries/:index/stage-counts')
  async countQuerySteps(
    @Param('id') id: string,
    @Param('index') index: string,
  ): Promise<{ ok: true; run: WorkflowRun }> {
    return {
      ok: true,
      run: await this.runs.countQuerySteps(id, parseQueryIndex(index)),
    };
  }

  /** Run one of the answer's queries again; nothing is stored (api.md 142). */
  @Post(':id/answer/queries/:index/rerun')
  async rerunQuery(
    @Param('id') id: string,
    @Param('index') index: string,
  ): Promise<{ ok: true; result: QueryRerunResult }> {
    return {
      ok: true,
      result: await this.runs.rerunQuery(id, parseQueryIndex(index)),
    };
  }

  /**
   * One page of one of the answer's queries, filtered and sorted (api.md
   * 152); the body is a `PageRequest`. Nothing is stored.
   */
  @Post(':id/answer/queries/:index/page')
  async pageQuery(
    @Param('id') id: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; result: PageResult }> {
    const at = parseQueryIndex(index);
    return {
      ok: true,
      result: await this.runs.pageQuery(id, at, parsePageRequest(body)),
    };
  }

  /**
   * The user's words read as a view of one of the answer's queries (api.md
   * 153); the body is `{ text, view? }`. Nothing is stored.
   */
  @Post(':id/answer/queries/:index/interpret-filter')
  async interpretFilter(
    @Param('id') id: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; interpretation: FilterInterpretation }> {
    const { text, view } = parseInterpretRequest(body);
    const at = parseQueryIndex(index);
    return {
      ok: true,
      interpretation: await this.runs.interpretFilter(id, at, text, view),
    };
  }

  /**
   * One query's rows as CSV, up to 50,000 (api.md 143); `X-Rows-Cut:
   * 50000` when more existed. Checks answer before any header is written.
   */
  @Get(':id/answer/queries/:index/csv')
  async queryCsv(
    @Param('id') id: string,
    @Param('index') index: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.runs.queryCsv(id, parseQueryIndex(index));
    const body = Buffer.from(csvOf(file.columns, file.rows), 'utf8');
    if (file.cut) res.setHeader('X-Rows-Cut', String(EXPORT_ROWS));
    sendAttachment(res, {
      filename: file.filename,
      contentType: 'text/csv; charset=utf-8',
      body,
    });
  }

  /**
   * Answer a run that waits for the user and continue it, streamed (api.md
   * 138; ADR-0043): the same run's events as 119. Refusals answer their
   * real status before the stream starts (Style B). The run is detached
   * from the connection as 119's (ADR-0048): closing it stops only the
   * stream.
   */
  @Post(':id/resume/stream')
  @HttpCode(200)
  async resume(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.runs.prepareResume(id, body);
    const runId = this.runs.resumeDetached(prepared);
    await followSse(res, this.runs.live, runId);
  }

  /**
   * Follow a live run again (api.md 149; ADR-0048): its events after
   * `after` (a frame's `seq`; 0 or absent for all), then the live ones,
   * ending with the run. 404 before any frame for an unknown run or one no
   * longer held (read it with 121).
   */
  @Get(':id/events/stream')
  async events(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('after') after?: string,
  ): Promise<void> {
    await this.runs.checkLive(id);
    await followSse(res, this.runs.live, id, parseAfter(after));
  }

  /**
   * Stop a run (api.md 150): stored `stopped` with any partial answer, and
   * answered as stored. Idempotent: a run that already ended answers as it
   * is.
   */
  /** Archive the run's conversation with Avery (api.md 159; workflows R45). */
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string): Promise<{
    ok: true;
    conversationId: string;
    archived: number;
  }> {
    return this.runs.archive(id);
  }

  /** Bring an archived conversation back (api.md 160; workflows R45). */
  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@Param('id') id: string): Promise<{
    ok: true;
    conversationId: string;
    unarchived: number;
  }> {
    return this.runs.unarchive(id);
  }

  @Post(':id/stop')
  @HttpCode(200)
  async stop(
    @Param('id') id: string,
  ): Promise<{ ok: true; message: string; run: WorkflowRun }> {
    const run = await this.runs.stop(id);
    return {
      ok: true,
      message: run.status === 'stopped' ? 'Run stopped' : 'Run already ended',
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

  /** One reference image of a run's input, by its stored path (api.md 151). */
  @Get(':id/input-image')
  async inputImage(
    @Param('id') id: string,
    @Query('path') path: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.runs.inputImage(id, path ?? '');
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Content-Length', image.data.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(image.data);
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
