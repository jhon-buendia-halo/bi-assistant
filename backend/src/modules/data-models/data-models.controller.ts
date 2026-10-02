import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { DataModelsService } from './data-models.service';
import { dataModelJsonSchema } from './schema/data-model.schema';

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
