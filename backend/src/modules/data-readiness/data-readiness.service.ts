import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatasourcesService } from '../datasources/datasources.service';
import { PostgresProfiler } from '../datasources/connectors/postgres-profiling';
import { DatabricksProfiler } from '../datasources/connectors/databricks-profiling';
import type {
  DatabricksConfig,
  Datasource,
  PostgresConfig,
} from '../datasources/entities/datasource.entity';
import { DataReadinessRepository } from './data-readiness.repository';
import type { AssessDto } from './dto/assess.dto';
import { profilePostgres } from './adapters/postgres.adapter';
import { profileDatabricks } from './adapters/databricks.adapter';
import { runAssessment } from './engine/check-engine';
import { DEFAULT_THRESHOLDS } from './engine/types';
import type {
  AssessScope,
  ReadinessReport,
  ReadinessReportSummary,
  SourceProfile,
} from './engine/types';

type ReadinessKind = ReadinessReport['datasourceKind'];

/** One entity of the profile, as (namespace, name). */
interface EntityRef {
  namespace: string;
  name: string;
}

const UNSUPPORTED_KIND =
  'Data readiness supports PostgreSQL and Databricks datasources only';
const NONE_EXIST = 'None of the entities to assess exist';
const ID_REQUIRED = 'datasourceId is required';
const ENTITIES_INVALID = 'entities must be an array of entity keys';

const refKey = (r: EntityRef): string => `${r.namespace}\u0000${r.name}`;

/**
 * Map an inventory key (api.md 108) to the profile's (namespace, name).
 * PostgreSQL `database.schema.table` → (schema, table); Databricks
 * `catalog.schema.table` → (`catalog.schema`, table), as the profilers flatten
 * namespaces. Null for a key that cannot name a table, or (PostgreSQL) one
 * naming another database than the connection's `database`.
 */
export function entityRefFromKey(
  kind: ReadinessKind,
  key: unknown,
  database?: string,
): EntityRef | null {
  if (typeof key !== 'string') return null;
  const parts = key.split('.').map((p) => p.trim());
  if (parts.length < 3 || parts.some((p) => !p)) return null;
  const [catalog, schema, ...table] = parts;
  if (kind === 'postgres' && database && catalog !== database) return null;
  return {
    namespace: kind === 'postgres' ? schema : `${catalog}.${schema}`,
    name: table.join('.'),
  };
}

/**
 * The adapter scope for the requested entities: the exact (deduplicated) set,
 * in one adapter call, so only those tables are profiled while every table
 * stays a join target and the inferred-join cap applies once (R11).
 */
export function scopeFor(refs: EntityRef[]): AssessScope {
  const seen = new Map<string, EntityRef>();
  for (const r of refs) seen.set(refKey(r), r);
  return {
    entities: [...seen.values()].map(({ namespace, name }) => ({
      namespace,
      name,
    })),
  };
}

function summarise(report: ReadinessReport): ReadinessReportSummary {
  const summary: ReadinessReportSummary = {
    id: report.id,
    datasourceId: report.datasourceId,
    datasourceName: report.datasourceName,
    datasourceKind: report.datasourceKind,
    generatedAt: report.generatedAt,
    overallScore: report.overallScore,
    maturity: report.maturity,
    entityCount: report.entityCount,
  };
  if (report.sessionId) summary.sessionId = report.sessionId;
  return summary;
}

/**
 * Orchestrates an assessment: datasource → profiler → adapter → engine → store
 * (unit 8, BA-259). Throws NotFoundException for an unknown datasource or
 * report and BadRequestException for an unsupported datasource kind.
 */
@Injectable()
export class DataReadinessService {
  constructor(
    private readonly datasources: DatasourcesService,
    private readonly postgres: PostgresProfiler,
    private readonly databricks: DatabricksProfiler,
    private readonly repository: DataReadinessRepository,
  ) {}

  /** `now` is injectable for tests; defaults to the current time. */
  async assess(
    input: AssessDto,
    now: Date = new Date(),
  ): Promise<ReadinessReport> {
    const datasourceId = requireId(input?.datasourceId);
    // Omitted (or empty) `entities` means the whole datasource.
    const keys = requireKeys(input.entities);
    const ds = await this.datasource(datasourceId);
    if (ds.kind !== 'postgres' && ds.kind !== 'databricks') {
      throw new BadRequestException(UNSUPPORTED_KIND);
    }
    const kind: ReadinessKind = ds.kind;

    let refs: EntityRef[] | undefined;
    if (keys.length > 0) {
      const database =
        kind === 'postgres'
          ? (ds.config as PostgresConfig).database
          : undefined;
      refs = keys
        .map((k) => entityRefFromKey(kind, k, database))
        .filter((r): r is EntityRef => r !== null);
      if (refs.length === 0) throw new BadRequestException(NONE_EXIST);
    }

    // Keys that no longer exist are dropped (api.md 108); a scope left with
    // no entity, or a datasource with none, is refused (Edge cases).
    const profile = await this.profile(
      ds,
      kind,
      refs ? scopeFor(refs) : undefined,
    );
    if (profile.entities.length === 0) {
      throw new BadRequestException(NONE_EXIST);
    }

    const result = runAssessment(profile, {
      thresholds: DEFAULT_THRESHOLDS,
      now,
    });
    const report: ReadinessReport = {
      id: randomUUID(),
      datasourceId: ds.id,
      datasourceName: ds.name,
      datasourceKind: kind,
      generatedAt: now.toISOString(),
      ...result,
    };
    const sessionId =
      typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    if (sessionId) report.sessionId = sessionId;
    return this.repository.insert(report);
  }

  /** api.md 109: newest first; unknown datasource gives an empty list. */
  async list(
    datasourceId: string,
  ): Promise<{ reports: ReadinessReportSummary[] }> {
    const id = requireId(datasourceId);
    const reports = await this.repository.listByDatasource(id);
    return { reports: reports.map(summarise) };
  }

  async get(id: string): Promise<ReadinessReport> {
    const found = await this.repository.get(id);
    if (!found) {
      throw new NotFoundException(`Readiness report "${id}" not found`);
    }
    return found;
  }

  private async datasource(id: string): Promise<Datasource> {
    try {
      return await this.datasources.get(id);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(`Datasource "${id}" not found`);
      }
      throw err;
    }
  }

  /**
   * One adapter call. The adapters record a failing statement and carry on,
   * so a connector error they throw means the datasource cannot be reached at
   * all: 502 with the connector's message. Programming errors stay 500.
   */
  private async profile(
    ds: Datasource,
    kind: ReadinessKind,
    scope: AssessScope | undefined,
  ): Promise<SourceProfile> {
    try {
      return kind === 'postgres'
        ? await profilePostgres(
            this.postgres,
            ds.config as PostgresConfig,
            ds.id,
            scope,
          )
        : await profileDatabricks(
            this.databricks,
            ds.config as DatabricksConfig,
            ds.id,
            scope,
          );
    } catch (err) {
      if (err instanceof HttpException || isProgrammingError(err)) throw err;
      throw new BadGatewayException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

function isProgrammingError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof RangeError ||
    err instanceof SyntaxError
  );
}

/** `entities`: omitted (or null), or an array of strings (api.md 108). */
function requireKeys(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((k) => typeof k !== 'string')) {
    throw new BadRequestException(ENTITIES_INVALID);
  }
  return value as string[];
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(ID_REQUIRED);
  }
  return value.trim();
}
