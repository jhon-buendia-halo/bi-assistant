import {
  BadRequestException,
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
import { SessionEvidenceService } from './session-evidence.service';
import type { ChatMessage, SessionDoc } from './entities/session.entity';
import type {
  FilePanelItem,
  InteractiveVisualization,
} from './entities/session.entity';
import { EXPORT_ROWS } from './query-evidence/query-coverage';
import { csvOf, withDerivedEvidence } from './query-evidence/query-evidence';
import type { QueryRerunResult } from './query-evidence/query-evidence.service';
import {
  parseInterpretRequest,
  parsePageRequest,
} from './query-evidence/result-view';
import type {
  FilterInterpretation,
  PageResult,
} from '../datasources/connectors/paged-sql.types';
import type { Response } from 'express';

/** The `:message` of 144-148: a whole number, else the 400 of a message with no answer. */
function parseMessageIndex(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(
      `Message ${value} has no answer with queries`,
    );
  }
  return Number(value);
}

/** The `:index` of 145-148: a whole number, else the 400 of an unknown query. */
function parseQueryIndex(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(
      `Query ${value} not found in the message's answer`,
    );
  }
  return Number(value);
}

/**
 * The stored sessions' read routes (api.md 2.1): since 1.23.22 nothing starts
 * or continues a chat, so a past chat is listed, opened, downloaded from and
 * deleted. Only the query inspector (144-148) writes to it: the evidence and
 * explanations it caches in a message, never the conversation.
 */
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly evidence: SessionEvidenceService,
  ) {}

  @Get()
  async list(): Promise<{ sessions: SessionDoc[] }> {
    return {
      sessions: await this.sessionsService.toViews(
        await this.sessionsService.list(),
      ),
    };
  }

  /**
   * One session (api.md 2). An assistant message with `data` and no stored
   * `evidence` reads with the evidence derived from its data: no query,
   * nothing stored.
   */
  @Get(':id')
  async get(@Param('id') id: string): Promise<SessionDoc> {
    const view = await this.sessionsService.toView(
      await this.sessionsService.get(id),
    );
    return { ...view, messages: view.messages.map(withDerivedEvidence) };
  }

  /** Build a message's evidence and size its tables (api.md 144). */
  @Post(':id/messages/:message/answer/evidence')
  async prepareEvidence(
    @Param('id') id: string,
    @Param('message') message: string,
  ): Promise<{ ok: true; message: ChatMessage }> {
    return {
      ok: true,
      message: await this.evidence.prepare(id, parseMessageIndex(message)),
    };
  }

  /** Explain one query of a message step by step (api.md 145). */
  @Post(':id/messages/:message/answer/queries/:index/explanation')
  async explainQuery(
    @Param('id') id: string,
    @Param('message') message: string,
    @Param('index') index: string,
  ): Promise<{ ok: true; message: ChatMessage }> {
    const at = parseMessageIndex(message);
    return {
      ok: true,
      message: await this.evidence.explain(id, at, parseQueryIndex(index)),
    };
  }

  /** Count the rows after each step of an explained query (api.md 146). */
  @Post(':id/messages/:message/answer/queries/:index/stage-counts')
  async countQuerySteps(
    @Param('id') id: string,
    @Param('message') message: string,
    @Param('index') index: string,
  ): Promise<{ ok: true; message: ChatMessage }> {
    const at = parseMessageIndex(message);
    return {
      ok: true,
      message: await this.evidence.countSteps(id, at, parseQueryIndex(index)),
    };
  }

  /** Run one of a message's queries again; nothing is stored (api.md 147). */
  @Post(':id/messages/:message/answer/queries/:index/rerun')
  async rerunQuery(
    @Param('id') id: string,
    @Param('message') message: string,
    @Param('index') index: string,
  ): Promise<{ ok: true; result: QueryRerunResult }> {
    const at = parseMessageIndex(message);
    return {
      ok: true,
      result: await this.evidence.rerun(id, at, parseQueryIndex(index)),
    };
  }

  /**
   * One page of one of a message's queries, filtered and sorted (api.md
   * 153); the body is a `PageRequest`. Nothing is stored.
   */
  @Post(':id/messages/:message/answer/queries/:index/page')
  async pageQuery(
    @Param('id') id: string,
    @Param('message') message: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; result: PageResult }> {
    const at = parseMessageIndex(message);
    const query = parseQueryIndex(index);
    return {
      ok: true,
      result: await this.evidence.page(id, at, query, parsePageRequest(body)),
    };
  }

  /**
   * The user's words read as a view of one of a message's queries (api.md
   * 154); the body is `{ text, view? }`. Nothing is stored.
   */
  @Post(':id/messages/:message/answer/queries/:index/interpret-filter')
  async interpretFilter(
    @Param('id') id: string,
    @Param('message') message: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; interpretation: FilterInterpretation }> {
    const { text, view } = parseInterpretRequest(body);
    const at = parseMessageIndex(message);
    const query = parseQueryIndex(index);
    return {
      ok: true,
      interpretation: await this.evidence.interpretFilter(
        id,
        at,
        query,
        text,
        view,
      ),
    };
  }

  /**
   * One query's rows as CSV, up to 50,000 (api.md 148); `X-Rows-Cut:
   * 50000` when more existed. Checks answer before any header is written.
   */
  @Get(':id/messages/:message/answer/queries/:index/csv')
  async queryCsv(
    @Param('id') id: string,
    @Param('message') message: string,
    @Param('index') index: string,
    @Res() res: Response,
  ): Promise<void> {
    const at = parseMessageIndex(message);
    const file = await this.evidence.queryCsv(id, at, parseQueryIndex(index));
    const body = Buffer.from(csvOf(file.columns, file.rows), 'utf8');
    if (file.cut) res.setHeader('X-Rows-Cut', String(EXPORT_ROWS));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Length', body.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/["\\\r\n]/g, '_')}"`,
    );
    res.send(body);
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
