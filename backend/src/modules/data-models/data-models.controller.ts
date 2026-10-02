import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DataModelsService } from './data-models.service';
import { dataModelJsonSchema } from './schema/data-model.schema';
import type { SaveModelMetricDto } from './dto/save-model-metric.dto';
import type { Metric } from './entities/data-model.entity';
import type { DataModelVersion } from './repositories/data-models.repository';

/**
 * The Data model API (roadmap 1.2.1 / BA-85, `gherkin.md` "Feature: Data
 * model"). Routes are spelled out in full rather than nested under a
 * `/datasets` controller prefix: `DatasetsController` already owns
 * `/datasets` (list/create/delete), and `/datasets/:name/model*` only
 * shares a path segment with it, not a method+path pair, so there is no
 * route collision.
 */
@Controller()
export class DataModelsController {
  constructor(private readonly dataModels: DataModelsService) {}

  @Get('data-models/schema.json')
  schema(): Record<string, unknown> {
    return rootedJsonSchema(dataModelJsonSchema());
  }

  @Get('datasets/:name/model')
  async get(@Param('name') name: string) {
    const doc = await this.dataModels.get(name);
    if (!doc) {
      throw new NotFoundException(`No data model for dataset "${name}"`);
    }
    const version = doc.versions.find((v) => v.version === doc.currentVersion);
    return {
      dataset: doc.dataset,
      currentVersion: doc.currentVersion,
      version,
    };
  }

  /**
   * roadmap 1.2.3 — the Versions tab's list view (version, source, note,
   * createdAt — the whole stored `DataModelVersion`, YAML included, so the
   * frontend's line-diff does not need an extra round trip per version).
   * Declared before `.../versions/:version` below only for readability —
   * Nest matches by segment count, so the two never collide regardless of
   * order (same reasoning as this controller's `/metrics` vs
   * `/metrics/candidates`).
   */
  @Get('datasets/:name/model/versions')
  async listVersions(
    @Param('name') name: string,
  ): Promise<{ versions: DataModelVersion[] }> {
    const doc = await this.dataModels.get(name);
    if (!doc) {
      throw new NotFoundException(`No data model for dataset "${name}"`);
    }
    return { versions: doc.versions };
  }

  @Get('datasets/:name/model/versions/:version')
  async getVersion(
    @Param('name') name: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const found = await this.dataModels.getVersion(name, version);
    if (!found) {
      throw new NotFoundException(
        `Version ${version} not found for dataset "${name}"`,
      );
    }
    return found;
  }

  @Put('datasets/:name/model')
  async save(@Param('name') name: string, @Body() body: { yaml?: unknown }) {
    const yaml = typeof body?.yaml === 'string' ? body.yaml : '';
    const result = await this.dataModels.saveYaml(name, yaml);
    return { ok: true, version: result.version };
  }

  @Post('datasets/:name/model/revert')
  @HttpCode(200)
  async revert(
    @Param('name') name: string,
    @Body() body: { version?: unknown },
  ) {
    const result = await this.dataModels.revert(name, Number(body?.version));
    return { ok: true, currentVersion: result.currentVersion };
  }

  @Post('datasets/:name/model/bootstrap')
  async bootstrap(@Param('name') name: string) {
    const doc = await this.dataModels.rebootstrap(name);
    return { ok: true, currentVersion: doc.currentVersion };
  }

  @Get('datasets/:name/model/drift')
  async drift(@Param('name') name: string) {
    return this.dataModels.drift(name);
  }

  @Post('datasets/:name/model/resolve')
  @HttpCode(200)
  async resolve(
    @Param('name') name: string,
    @Body() body: { refs?: unknown; version?: unknown },
  ) {
    const refs = Array.isArray(body?.refs) ? body.refs.map(String) : [];
    const version =
      typeof body?.version === 'number' ? body.version : undefined;
    const results = await this.dataModels.resolve(name, refs, version);
    return { results };
  }

  /**
   * roadmap 1.2.3 — downloads a version's YAML verbatim (current version by
   * default, `?version=N` for any other). `@Res()` + a manual `send` (same
   * pattern as `SessionsController`'s visualization download) rather than a
   * JSON body, since the point is a file a browser/Electron `<a download>`
   * click saves as-is.
   */
  @Get('datasets/:name/model/export')
  async export(
    @Param('name') name: string,
    @Res() res: Response,
    @Query('version') version?: string,
  ): Promise<void> {
    const parsedVersion = version !== undefined ? Number(version) : undefined;
    const { yaml, version: resolvedVersion } = await this.dataModels.exportYaml(
      name,
      Number.isFinite(parsedVersion) ? parsedVersion : undefined,
    );
    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slugifyDatasetName(name)}.model.v${resolvedVersion}.yaml"`,
    );
    res.send(yaml);
  }

  /** roadmap 1.2.3 — imports a `.yaml` file through the same validation path
   * as `PUT .../model`, recorded as its own `source: 'import'`. */
  @Post('datasets/:name/model/import')
  @HttpCode(200)
  async import(
    @Param('name') name: string,
    @Body() body: { yaml?: unknown },
  ): Promise<{ ok: true; version: number }> {
    const yaml = typeof body?.yaml === 'string' ? body.yaml : '';
    const result = await this.dataModels.importYaml(name, yaml);
    return { ok: true, version: result.version };
  }

  /** roadmap 1.2.3 — the one YAML writer (`serializeDataModel`) exposed so
   * the frontend's structured forms never need their own. Pure: no dataset
   * lookup, `name` is unused beyond keeping the route under
   * `/datasets/:name/model/*`. `serializeModel` validates `body.model`
   * against the full schema and throws `BadRequestException` (400) for a
   * malformed body (review finding 12). */
  @Post('datasets/:name/model/serialize')
  @HttpCode(200)
  serialize(@Body() body: { model?: unknown }): { yaml: string } {
    return { yaml: this.dataModels.serializeModel(body?.model) };
  }

  // --- Model-scoped metrics (roadmap 1.2.3): the metrics panel's new
  // editor of record — see `DataModelsService`'s model-metrics methods. ---

  @Get('datasets/:name/model/metrics')
  async listModelMetrics(
    @Param('name') name: string,
  ): Promise<{ metrics: Metric[] }> {
    return { metrics: await this.dataModels.listModelMetrics(name) };
  }

  @Post('datasets/:name/model/metrics')
  async createModelMetric(
    @Param('name') name: string,
    @Body() dto: SaveModelMetricDto,
  ): Promise<{ ok: true; version: number }> {
    const result = await this.dataModels.createModelMetric(name, toMetric(dto));
    return { ok: true, version: result.version };
  }

  @Put('datasets/:name/model/metrics/:metricName')
  async updateModelMetric(
    @Param('name') name: string,
    @Param('metricName') metricName: string,
    @Body() dto: SaveModelMetricDto,
  ): Promise<{ ok: true; version: number }> {
    const result = await this.dataModels.updateModelMetric(
      name,
      metricName,
      toMetric(dto),
    );
    return { ok: true, version: result.version };
  }

  @Delete('datasets/:name/model/metrics/:metricName')
  async deleteModelMetric(
    @Param('name') name: string,
    @Param('metricName') metricName: string,
  ): Promise<{ ok: true; version: number }> {
    const result = await this.dataModels.deleteModelMetric(name, metricName);
    return { ok: true, version: result.version };
  }
}

/** `World Cup Core` -> `world-cup-core`; the export filename's dataset
 * segment (`<dataset-slug>.model.v<N>.yaml`). */
function slugifyDatasetName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'dataset';
}

/** Coerce the untyped body into a `Metric` — same spirit as
 * `metrics.controller.ts`'s `toInput`, kept to this file since it shapes a
 * `Metric`, not the legacy flat `MetricInput`. Validation (required fields,
 * reference resolution) happens in `DataModelsService` via
 * `validateDataModel`, not here. */
function toMetric(dto: SaveModelMetricDto): Metric {
  return {
    name: typeof dto?.name === 'string' ? dto.name.trim().toLowerCase() : '',
    label: typeof dto?.label === 'string' ? dto.label.trim() : '',
    entity: typeof dto?.entity === 'string' ? dto.entity.trim() : '',
    ...(typeof dto?.description === 'string' && dto.description
      ? { description: dto.description }
      : {}),
    ...(dto?.agg ? { agg: dto.agg } : {}),
    ...(typeof dto?.of === 'string' && dto.of ? { of: dto.of } : {}),
    ...(typeof dto?.numerator === 'string' && dto.numerator
      ? { numerator: dto.numerator }
      : {}),
    ...(typeof dto?.denominator === 'string' && dto.denominator
      ? { denominator: dto.denominator }
      : {}),
    ...(dto?.where ? { where: dto.where } : {}),
    ...(Array.isArray(dto?.dimensions) && dto.dimensions.length
      ? { dimensions: dto.dimensions.map(String) }
      : {}),
    ...(typeof dto?.expressions?.sql === 'string' && dto.expressions.sql
      ? { expressions: { sql: dto.expressions.sql } }
      : {}),
    ...(typeof dto?.sourceVerifiedQueryId === 'string' &&
    dto.sourceVerifiedQueryId
      ? { sourceVerifiedQueryId: dto.sourceVerifiedQueryId }
      : {}),
  };
}

/**
 * `dataModelJsonSchema()` (the frozen `schema/data-model.schema.ts`) emits a
 * `$ref`-rooted document — `{ $ref: "#/$defs/DataModel", $defs: {...} }` —
 * which is the right shape for `z.toJSONSchema` to split every sub-schema
 * into its own named `$defs` entry (what makes `Binding` etc. independently
 * readable), but leaves the root itself with no `properties` of its own.
 * The published endpoint is meant to be read directly (an editor's
 * autocomplete, a docs page), so the root schema's own fields are merged
 * back onto the top level here — `$defs` stays untouched alongside it.
 */
function rootedJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const defs = (schema.$defs ?? schema.definitions) as
    Record<string, unknown> | undefined;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  const rootName = ref?.split('/').pop();
  const root = rootName ? defs?.[rootName] : undefined;
  return root && typeof root === 'object'
    ? { ...schema, ...(root as Record<string, unknown>) }
    : schema;
}
