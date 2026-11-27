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
} from '@nestjs/common';
import { OntologyService } from './ontology.service';
import type { OntologyQuery } from './ontology.service';
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
 * A dataset's ontology (ADR-0036): listed, created under
 * the dataset, changed and deleted by item id.
 */
@Controller()
export class OntologyController {
  constructor(private readonly ontology: OntologyService) {}

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
