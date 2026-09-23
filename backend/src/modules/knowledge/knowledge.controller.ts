import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeQuery } from './knowledge.service';
import type {
  KnowledgeSnippet,
  KnowledgeSnippetInput,
} from './entities/knowledge-snippet.entity';
import { KNOWLEDGE_SNIPPET_KINDS } from './entities/knowledge-snippet.entity';
import { CreateKnowledgeSnippetDto } from './dto/create-knowledge-snippet.dto';
import { UpdateKnowledgeSnippetDto } from './dto/update-knowledge-snippet.dto';
import { BootstrapKnowledgeDto } from './dto/bootstrap-knowledge.dto';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  async list(
    @Query('datasetId') datasetId?: string,
    @Query('kind') kind?: string,
    @Query('source') source?: string,
    @Query('enabled') enabled?: string,
  ): Promise<KnowledgeSnippet[]> {
    return this.knowledge.list(toQuery({ datasetId, kind, source, enabled }));
  }

  @Post()
  async create(
    @Body() dto: CreateKnowledgeSnippetDto,
  ): Promise<KnowledgeSnippet> {
    return this.knowledge.create(toInput(dto));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeSnippetDto,
  ): Promise<KnowledgeSnippet> {
    return this.knowledge.update(id, toPartialInput(dto));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.knowledge.delete(id);
  }

  @Post('bootstrap')
  async bootstrap(
    @Body() dto: BootstrapKnowledgeDto,
  ): Promise<{ created: KnowledgeSnippet[] }> {
    const datasetId = typeof dto?.datasetId === 'string' ? dto.datasetId : '';
    return { created: await this.knowledge.bootstrap(datasetId) };
  }

  /**
   * Same run as `POST bootstrap`, streamed: a `progress` event per stage
   * (opening the dataset, reading schema, sampling rows, drafting, saving)
   * so the UI can say what is happening during the minute it takes, then a
   * terminal `done` with the created snippets — or `error` with the reason.
   */
  @Post('bootstrap/stream')
  async bootstrapStream(
    @Body() dto: BootstrapKnowledgeDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (data: unknown) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    let closed = false;
    const onClose = () => {
      closed = true;
    };
    res.once('close', onClose);
    const datasetId = typeof dto?.datasetId === 'string' ? dto.datasetId : '';
    try {
      const created = await this.knowledge.bootstrap(datasetId, (progress) => {
        if (!closed) send({ type: 'progress', ...progress });
      });
      if (!closed) send({ type: 'done', created });
    } catch (err) {
      if (!closed) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      }
    }
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}

/** `?datasetId=&kind=&source=&enabled=` — lenient: an unrecognized value is dropped, not rejected. */
function toQuery(raw: {
  datasetId?: string;
  kind?: string;
  source?: string;
  enabled?: string;
}): KnowledgeQuery {
  const kind = KNOWLEDGE_SNIPPET_KINDS.find((k) => k === raw.kind);
  const source =
    raw.source === 'user' || raw.source === 'mined' ? raw.source : undefined;
  const enabled =
    raw.enabled === 'true' || raw.enabled === 'false'
      ? raw.enabled === 'true'
      : undefined;
  return {
    ...(raw.datasetId ? { datasetId: raw.datasetId } : {}),
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  };
}

/** Coerce the untyped create body into the service's input shape. */
function toInput(dto: CreateKnowledgeSnippetDto): KnowledgeSnippetInput {
  return {
    kind: dto?.kind,
    title: typeof dto?.title === 'string' ? dto.title : '',
    body: typeof dto?.body === 'string' ? dto.body : '',
    scope: dto?.scope ?? null,
    ...(Array.isArray(dto?.synonyms)
      ? { synonyms: dto.synonyms.map((s) => String(s)) }
      : {}),
    ...(Array.isArray(dto?.entities)
      ? { entities: dto.entities.map((e) => String(e)) }
      : {}),
    ...(typeof dto?.enabled === 'boolean' ? { enabled: dto.enabled } : {}),
  };
}

/**
 * Coerce the untyped update body into a partial input, preserving which
 * fields were actually present on the body — `KnowledgeService.update`
 * applies exactly those and leaves the rest untouched.
 */
function toPartialInput(
  dto: UpdateKnowledgeSnippetDto,
): Partial<KnowledgeSnippetInput> {
  const patch: Partial<KnowledgeSnippetInput> = {};
  if (dto?.kind !== undefined) patch.kind = dto.kind;
  if (dto?.scope !== undefined) patch.scope = dto.scope;
  if (typeof dto?.title === 'string') patch.title = dto.title;
  if (typeof dto?.body === 'string') patch.body = dto.body;
  if (Array.isArray(dto?.synonyms)) {
    patch.synonyms = dto.synonyms.map((s) => String(s));
  }
  if (Array.isArray(dto?.entities)) {
    patch.entities = dto.entities.map((e) => String(e));
  }
  if (typeof dto?.enabled === 'boolean') patch.enabled = dto.enabled;
  return patch;
}
