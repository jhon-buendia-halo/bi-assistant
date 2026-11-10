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
import { OntologyService } from './ontology.service';
import type { OntologyQuery } from './ontology.service';
import { OntologyBootstrapService } from './ontology-bootstrap.service';
import { ONTOLOGY_KINDS } from './entities/ontology-item.entity';
import type {
  OntologyItem,
  OntologyItemInput,
} from './entities/ontology-item.entity';
import { CreateOntologyItemDto } from './dto/create-ontology-item.dto';
import { UpdateOntologyItemDto } from './dto/update-ontology-item.dto';

/** The keys a create or update body may carry; anything else is ignored. */
const INPUT_KEYS: (keyof OntologyItemInput)[] = [
  'kind',
  'name',
  'description',
  'enabled',
  'synonyms',
  'mappings',
  'predicate',
  'conceptId',
  'entities',
  'from',
  'type',
  'to',
  'metricId',
];

/**
 * A dataset's ontology (ADR-0036): listed, created and bootstrapped under
 * the dataset, changed and deleted by item id.
 */
@Controller()
export class OntologyController {
  constructor(
    private readonly ontology: OntologyService,
    private readonly bootstrapper: OntologyBootstrapService,
  ) {}

  @Get('datasets/:name/ontology')
  async list(
    @Param('name') name: string,
    @Query('kind') kind?: string,
    @Query('source') source?: string,
    @Query('enabled') enabled?: string,
  ): Promise<OntologyItem[]> {
    return this.ontology.list(name, toQuery({ kind, source, enabled }));
  }

  @Post('datasets/:name/ontology')
  async create(
    @Param('name') name: string,
    @Body() dto: CreateOntologyItemDto,
  ): Promise<OntologyItem> {
    return this.ontology.create(name, {
      ...toInput(dto),
      ...(dto?.shared !== undefined ? { shared: dto.shared } : {}),
    });
  }

  @Patch('ontology/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOntologyItemDto,
  ): Promise<OntologyItem> {
    return this.ontology.update(id, toInput(dto));
  }

  @Delete('ontology/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.ontology.delete(id);
  }

  @Post('datasets/:name/ontology/bootstrap')
  async bootstrap(
    @Param('name') name: string,
  ): Promise<{ created: OntologyItem[] }> {
    return { created: await this.bootstrapper.bootstrap(name) };
  }

  /**
   * Same run as `POST …/bootstrap`, streamed: a `progress` event per stage
   * (opening the dataset, reading schema, sampling rows, drafting, saving)
   * so the UI can say what is happening during the minute it takes, then a
   * terminal `done` with the created items, or `error` with the reason.
   */
  @Post('datasets/:name/ontology/bootstrap/stream')
  @HttpCode(200)
  async bootstrapStream(
    @Param('name') name: string,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
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
    try {
      const created = await this.bootstrapper.bootstrap(name, (progress) => {
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

/** `?kind=&source=&enabled=`, lenient: an unrecognized value is dropped, not rejected. */
function toQuery(raw: {
  kind?: string;
  source?: string;
  enabled?: string;
}): OntologyQuery {
  const kind = ONTOLOGY_KINDS.find((k) => k === raw.kind);
  const source =
    raw.source === 'user' || raw.source === 'mined' ? raw.source : undefined;
  const enabled =
    raw.enabled === 'true' || raw.enabled === 'false'
      ? raw.enabled === 'true'
      : undefined;
  return {
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  };
}

/**
 * The known keys present on the body, so an update applies exactly those and
 * leaves the rest of the item untouched.
 */
function toInput(
  dto: CreateOntologyItemDto | UpdateOntologyItemDto | undefined,
): OntologyItemInput {
  const body = (dto ?? {}) as Record<string, unknown>;
  const input: OntologyItemInput = {};
  for (const key of INPUT_KEYS) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  return input;
}
