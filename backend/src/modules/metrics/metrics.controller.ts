import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';
import type { SaveMetricDto } from './dto/save-metric.dto';
import type { MetricCandidate, MetricDoc } from './entities/metric.entity';

interface MetricResult {
  ok: boolean;
  message: string;
  metric?: MetricDoc;
}

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async list(
    @Query('entities') entities?: string,
  ): Promise<{ metrics: MetricDoc[] }> {
    const scope = splitEntities(entities);
    return {
      metrics: scope.length
        ? await this.metrics.listForEntities(scope)
        : await this.metrics.list(),
    };
  }

  /** Verified queries offered as prefilled metric drafts (promotion path). */
  @Get('candidates')
  async candidates(
    @Query('entities') entities?: string,
  ): Promise<{ candidates: MetricCandidate[] }> {
    return {
      candidates: await this.metrics.candidates(splitEntities(entities)),
    };
  }

  @Post()
  async create(@Body() dto: SaveMetricDto): Promise<MetricResult> {
    try {
      const metric = await this.metrics.create(toInput(dto));
      return { ok: true, message: `Metric "${metric.label}" saved`, metric };
    } catch (err) {
      return { ok: false, message: messageOf(err) };
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: SaveMetricDto,
  ): Promise<MetricResult> {
    try {
      const metric = await this.metrics.update(id, toInput(dto));
      return { ok: true, message: `Metric "${metric.label}" updated`, metric };
    } catch (err) {
      return { ok: false, message: messageOf(err) };
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<MetricResult> {
    try {
      const metric = await this.metrics.delete(id);
      return { ok: true, message: `Metric "${metric.label}" deleted` };
    } catch (err) {
      return { ok: false, message: messageOf(err) };
    }
  }
}

/**
 * roadmap 1.2.3 — the model-metrics panel's promotion path,
 * `GET /datasets/:name/model/metrics/candidates`, scoped to one dataset's
 * model and addressed by logical entity names. A separate, unprefixed
 * controller (not a method on `MetricsController` above, which carries the
 * `@Controller('metrics')` prefix every route there shares, and not on
 * `DataModelsController`, which would need `MetricsService` injected back
 * into `DataModelsModule` — a circular import, since `MetricsModule` already
 * depends on `DataModelsModule`): this one route reuses
 * `MetricsService.candidatesForDataset()` directly, so it has to live where
 * `MetricsService` is already provided, under a path with no prefix.
 */
@Controller()
export class ModelMetricCandidatesController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('datasets/:name/model/metrics/candidates')
  async candidatesForModel(
    @Param('name') name: string,
  ): Promise<{ candidates: MetricCandidate[] }> {
    return { candidates: await this.metrics.candidatesForDataset(name) };
  }
}

/** `?entities=a.b.c,d.e.f` — the caller's scope, empty when absent. */
function splitEntities(entities?: string): string[] {
  return (entities ?? '')
    .split(',')
    .map((entity) => entity.trim())
    .filter(Boolean);
}

/** Coerce the untyped body into the service's input shape. */
function toInput(dto: SaveMetricDto) {
  return {
    name: typeof dto?.name === 'string' ? dto.name : '',
    label: typeof dto?.label === 'string' ? dto.label : '',
    entity: typeof dto?.entity === 'string' ? dto.entity : '',
    expression: typeof dto?.expression === 'string' ? dto.expression : '',
    ...(typeof dto?.description === 'string'
      ? { description: dto.description }
      : {}),
    ...(typeof dto?.datasourceId === 'string'
      ? { datasourceId: dto.datasourceId }
      : {}),
    ...(Array.isArray(dto?.dimensions)
      ? { dimensions: dto.dimensions.map((d) => String(d)) }
      : {}),
    ...(typeof dto?.sourceVerifiedQueryId === 'string'
      ? { sourceVerifiedQueryId: dto.sourceVerifiedQueryId }
      : {}),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
