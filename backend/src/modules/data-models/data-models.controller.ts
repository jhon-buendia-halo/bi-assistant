import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { DataModelsService } from './data-models.service';
import { dataModelJsonSchema } from './schema/data-model.schema';
import { composeSessionModel, type SessionModel } from './session-model';
import {
  compileLogicalQuery,
  LogicalQueryError,
  type SqlDialect,
} from './query/compile-sql';
import {
  parseLogicalQuery,
  resolveLogicalQuery,
  type LogicalQueryIssue,
} from './query/logical-query';
import {
  dialectForDatasourceKind,
  getSqlFixerBridge,
  isRepairableSqlError,
  runSqlWithRepair,
} from './query/sql-repair';
import { DatasourcesService } from '../datasources/datasources.service';
import type { ModelIssue } from './entities/data-model.entity';

const SQL_DIALECTS: SqlDialect[] = ['postgres', 'databricks', 'sqlite'];

function isSqlDialect(value: unknown): value is SqlDialect {
  return (
    typeof value === 'string' && (SQL_DIALECTS as string[]).includes(value)
  );
}

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
  private readonly logger = new Logger(DataModelsController.name);

  constructor(
    private readonly dataModels: DataModelsService,
    private readonly datasources: DatasourcesService,
  ) {}

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

  /**
   * Logical query compiler, exposed for the editor (1.2.3) and for e2e
   * (ADR-0007 / roadmap 1.2.2): pure — resolves the query against the
   * dataset's current model and emits SQL, with no database call. `dialect`
   * defaults to `postgres` when omitted (there is no live datasource to ask
   * here, unlike `/model/query` below).
   */
  @Post('datasets/:name/model/compile')
  @HttpCode(200)
  async compile(
    @Param('name') name: string,
    @Body() body: { query?: unknown; dialect?: unknown },
  ) {
    const sessionModel = await this.sessionModelFor(name);
    const dialect = isSqlDialect(body?.dialect) ? body.dialect : 'postgres';
    const query = this.parseQueryOrThrow(body?.query);
    try {
      const compiled = compileLogicalQuery(sessionModel, query, dialect);
      return {
        sql: compiled.sql,
        entities: compiled.entities,
        notes: compiled.notes,
      };
    } catch (err) {
      if (err instanceof LogicalQueryError) {
        throw new BadRequestException({ ok: false, errors: err.issues });
      }
      throw err;
    }
  }

  /**
   * Runs a logical query on the dataset's own datasource. The dialect is
   * resolved from the datasource actually bound to the query's root entity
   * (`postgres`/`databricks` as configured, `rest` compiles as `sqlite`,
   * matching the materialisation path), never from a parameter — unlike
   * `/model/compile`, this one does call the database. A runtime error from
   * the compiled statement goes through the same execution-guided
   * `sql-fixer` repair pass as the chat `query_entities` tool
   * (`SessionsService.runSqlWithRepair`) rather than failing on the first
   * engine error — API/CLI callers get the same self-correction a chat turn
   * does.
   */
  @Post('datasets/:name/model/query')
  @HttpCode(200)
  async runQuery(
    @Param('name') name: string,
    @Body() body: { query?: unknown; limit?: unknown },
  ) {
    const sessionModel = await this.sessionModelFor(name);
    const query = this.parseQueryOrThrow({
      ...(typeof body?.query === 'object' && body.query ? body.query : {}),
      ...(typeof body?.limit === 'number' ? { limit: body.limit } : {}),
    });

    const resolution = resolveLogicalQuery(sessionModel, query);
    if (!resolution.ok) {
      throw new BadRequestException({ ok: false, errors: resolution.issues });
    }
    const dialect = await this.dialectFor(
      resolution.query.root.entity.datasourceId,
    );

    try {
      const compiled = compileLogicalQuery(sessionModel, query, dialect);
      const result = await runSqlWithRepair(compiled.sql, {
        runSql: (sql) =>
          this.datasources.runReadOnlySql(
            compiled.datasourceId,
            sql,
            query.limit,
          ),
        isRepairable: isRepairableSqlError,
        repair: (sql, errorMessage) =>
          this.repairSql(
            sql,
            errorMessage,
            dialect,
            sessionModel,
            compiled.entities,
          ),
        logWarn: (message) => this.logger.warn(message),
      });
      return { ...result, sql: compiled.sql, notes: compiled.notes };
    } catch (err) {
      if (err instanceof LogicalQueryError) {
        throw new BadRequestException({ ok: false, errors: err.issues });
      }
      throw err;
    }
  }

  /** One `sql-fixer` pass via the runtime `SqlFixerBridge`
   * (`query/sql-repair.ts`) `SessionsService.onModuleInit` installs — not a
   * direct `MastraService` call, so this module never needs to import
   * `MastraModule` (see `data-models.module.ts`'s header comment). Schema
   * context is built from the session model already in hand (no
   * `DatasetsRepository` needed here, unlike `SessionsService.sqlFixerContext`,
   * which also folds in sample values for the chat path). Returns undefined
   * when no bridge is installed, or the fixer produced nothing usable. */
  private async repairSql(
    sql: string,
    errorMessage: string,
    dialect: SqlDialect,
    sessionModel: SessionModel,
    entityNames: string[],
  ): Promise<string | undefined> {
    const bridge = getSqlFixerBridge();
    if (!bridge) return undefined;
    const schema = sessionModel.entities
      .filter((e) => entityNames.includes(e.name))
      .map(
        (e) =>
          `${e.name}(${e.attributes.map((a) => `${a.name} ${a.type}`).join(', ')})`,
      )
      .join('\n');
    try {
      return await bridge.repair(sql, errorMessage, dialect, schema);
    } catch (err) {
      this.logger.warn(
        `SQL repair attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  private parseQueryOrThrow(rawQuery: unknown) {
    try {
      return parseLogicalQuery(rawQuery);
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        errors: zodIssuesToQueryIssues(err),
      });
    }
  }

  private async sessionModelFor(name: string): Promise<SessionModel> {
    const doc = await this.dataModels.get(name);
    if (!doc) {
      throw new NotFoundException(`No data model for dataset "${name}"`);
    }
    const current = doc.versions.find(
      (v) => v.version === doc.currentVersion,
    );
    if (!current) {
      throw new NotFoundException(
        `Current version missing for dataset "${name}"`,
      );
    }
    return composeSessionModel([{ dataset: name, model: current.model }]);
  }

  /** `sql` bindings compile for the datasource's actual kind (postgres or
   * databricks); `rest` always compiles as sqlite, matching the
   * materialise-to-SQLite path (ADR-0007). The kind->dialect mapping itself
   * is `dialectForDatasourceKind` (`query/sql-repair.ts`), shared with
   * `SessionsService.dialectForEntity` — this method keeps only the
   * datasource lookup/fallback, which differs per caller. */
  private async dialectFor(datasourceId: string): Promise<SqlDialect> {
    try {
      const datasource = await this.datasources.get(datasourceId);
      return dialectForDatasourceKind(datasource.kind);
    } catch {
      // Fall through to the default below — a query against an unresolvable
      // datasource will fail at execution with a clearer error anyway.
      return 'postgres';
    }
  }
}

/** `ZodError.issues` carry no `code`/`path`-string the way a
 * `LogicalQueryIssue` does — mapped once here so a malformed query body
 * (wrong shape, not just an unresolved reference) reports the same `{ ok,
 * errors }` envelope as every other rejection from this controller. */
function zodIssuesToQueryIssues(
  err: unknown,
): (ModelIssue | LogicalQueryIssue)[] {
  if (!(err instanceof ZodError)) {
    return [
      { path: '', message: err instanceof Error ? err.message : String(err) },
    ];
  }
  return err.issues.map((issue) => ({
    code: 'invalid_select' as const,
    path: issue.path.join('.'),
    message: issue.message,
  }));
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
