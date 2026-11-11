import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { entityRefFromKey } from '../data-readiness/data-readiness.service';
import { PROFILE_CONCURRENCY_BY_DIALECT } from '../data-readiness/progress';
import { DatasetsService } from '../datasets/datasets.service';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import { DatabricksProfiler } from '../datasources/connectors/databricks-profiling';
import { PostgresProfiler } from '../datasources/connectors/postgres-profiling';
import type { ProfilingConnector } from '../datasources/connectors/profiling';
import {
  withSamplingSessions,
  type RowSampler,
  type SampleOutcome,
} from '../datasources/connectors/sampling';
import type {
  DatabricksConfig,
  Datasource,
  PostgresConfig,
} from '../datasources/entities/datasource.entity';
import { DatasourcesService } from '../datasources/datasources.service';
import { PROFILE_TABLES_MAX, SAMPLE_SIZE_MAX } from './limits';
import { ProfileCache } from './profile-cache';
import type { buildSampledProfile } from './profile';
import type { SampledProfile, SyntheticDialect } from './types';

export interface ProfileRequest {
  datasetName?: unknown;
  tables?: unknown;
  sampleSize?: unknown;
}

/** The real builder's type (profile/build-sampled-profile.ts). */
export type SampledProfileBuilder = typeof buildSampledProfile;
export const SAMPLED_PROFILE_BUILDER = 'SAMPLED_PROFILE_BUILDER';

export interface ProfileOptions {
  signal?: AbortSignal;
}

const SEED = 7;

@Injectable()
export class SyntheticDataService {
  constructor(
    private readonly datasets: DatasetsService,
    private readonly datasources: DatasourcesService,
    private readonly postgres: PostgresProfiler,
    private readonly databricks: DatabricksProfiler,
    private readonly cache: ProfileCache,
    @Inject(SAMPLED_PROFILE_BUILDER)
    private readonly buildProfile: SampledProfileBuilder,
  ) {}

  /** Cached profile, or undefined when unknown or expired (for scripts). */
  getProfile(profileId: string): SampledProfile | undefined {
    return this.cache.get(profileId);
  }

  async profile(
    body: ProfileRequest,
    options: ProfileOptions = {},
  ): Promise<SampledProfile> {
    const { signal } = options;
    const name =
      typeof body?.datasetName === 'string' ? body.datasetName.trim() : '';
    if (!name) throw new BadRequestException('datasetName is required');
    const dataset = (await this.datasets.list()).find((d) => d.name === name);
    if (!dataset) throw new NotFoundException(`Dataset "${name}" not found`);
    if (!dataset.datasourceId) {
      throw new BadRequestException(`Dataset "${name}" has no datasource`);
    }
    const kind = dataset.datasourceKind;
    if (kind !== 'postgres' && kind !== 'databricks') {
      throw new BadRequestException(
        'Profiling a sample supports PostgreSQL and Databricks datasets only',
      );
    }
    const keys = requestedKeys(body.tables, dataset);
    const sampleSize = requireSampleSize(body.sampleSize);
    const ds = await this.datasource(dataset.datasourceId);
    throwIfAborted(signal);

    try {
      const sampled =
        kind === 'postgres'
          ? await this.sample(
              this.postgres,
              ds.config as PostgresConfig,
              kind,
              keys,
              sampleSize,
              signal,
              (ds.config as PostgresConfig).database,
            )
          : await this.sample(
              this.databricks,
              ds.config as DatabricksConfig,
              kind,
              keys,
              sampleSize,
              signal,
            );
      throwIfAborted(signal);
      const now = new Date(this.cache.now());
      const built = this.buildProfile({
        dataset: { name },
        datasource: { id: ds.id, name: ds.name, kind },
        tables: sampled.tables,
        keys: sampled.keys,
        foreignKeys: sampled.foreignKeys,
        sampleSize,
        now,
      });
      const profile: SampledProfile = {
        ...built,
        profileId: randomUUID(),
        generatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.cache.ttl).toISOString(),
      };
      this.cache.set(profile);
      return profile;
    } catch (err) {
      if (
        err instanceof HttpException ||
        isProgrammingError(err) ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw err;
      }
      throw new BadGatewayException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async sample<C>(
    profiler: ProfilingConnector<C> & RowSampler<C>,
    config: C,
    kind: SyntheticDialect,
    keys: string[],
    sampleSize: number,
    signal: AbortSignal | undefined,
    database?: string,
  ) {
    const width = PROFILE_CONCURRENCY_BY_DIALECT[kind];
    return withSamplingSessions(profiler, config, width, signal, async (scope) => {
      // A failure here means the datasource cannot be reached: 502.
      const catalog = await scope.tables(config);
      const found = await scope.keys(config);
      const foreignKeys = await scope.foreignKeys(config);
      // A key outside the datasource's database has no ref: it becomes a failed table (R15).
      const resolved = keys.map((k) => entityRefFromKey(kind, k, database));
      const refs = resolved.map(
        (r, i) =>
          r ?? { namespace: foreignNamespace(keys[i]), name: foreignName(keys[i]) },
      );
      const samples: SampleOutcome[] = new Array(refs.length);
      let next = 0;
      const worker = async () => {
        while (next < refs.length) {
          const i = next++;
          throwIfAborted(signal);
          const ref = refs[i];
          if (!resolved[i]) {
            samples[i] = {
              namespace: ref.namespace,
              table: ref.name,
              rowCountEstimate: null,
              method: 'limit',
              columns: [],
              rows: [],
              durationMs: 0,
              error: `Table ${keys[i]} is not in the datasource's database "${database}"`,
            };
            continue;
          }
          try {
            samples[i] = await scope.sampleTable(
              config,
              ref.namespace,
              ref.name,
              {
                sampleSize,
                repeatableSeed: SEED,
              },
            );
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            samples[i] = {
              namespace: ref.namespace,
              table: ref.name,
              rowCountEstimate: null,
              method: 'limit',
              columns: [],
              rows: [],
              durationMs: 0,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(width, refs.length) }, worker),
      );
      return {
        tables: refs.map((r, i) => ({
          key: keys[i],
          // An unresolved key never borrows a same-named table of the current database.
          table: (resolved[i]
            ? catalog.find((t) => t.schema === r.namespace && t.table === r.name)
            : undefined) ?? { schema: r.namespace, table: r.name, columns: [] },
          sample: samples[i],
        })),
        keys: found,
        foreignKeys,
      };
    });
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
}

/** Namespace and name of a key that does not resolve (kept only to label its failed entry). */
function foreignNamespace(key: string): string {
  const parts = key.split('.');
  return parts.length >= 3 ? parts[1] : '';
}
function foreignName(key: string): string {
  const parts = key.split('.');
  return parts.length >= 3 ? parts.slice(2).join('.') : key;
}

function requestedKeys(value: unknown, dataset: DatasetDoc): string[] {
  let out = [...dataset.tables];
  if (value !== undefined && value !== null) {
    if (!Array.isArray(value) || value.some((k) => typeof k !== 'string')) {
      throw new BadRequestException('tables must be an array of entity keys');
    }
    const keys = [...new Set(value as string[])];
    for (const k of keys) {
      if (!dataset.tables.includes(k)) {
        throw new BadRequestException(
          `"${k}" is not a table of dataset "${dataset.name}"`,
        );
      }
    }
    if (keys.length > 0) out = keys;
  }
  if (out.length > PROFILE_TABLES_MAX) {
    throw new BadRequestException(
      `Choose at most ${PROFILE_TABLES_MAX} tables`,
    );
  }
  return out;
}

function requireSampleSize(value: unknown): number {
  if (value === undefined || value === null) return SAMPLE_SIZE_MAX;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > SAMPLE_SIZE_MAX
  ) {
    throw new BadRequestException(
      'sampleSize must be a whole number from 1 to 1,000',
    );
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('The profile was aborted');
    err.name = 'AbortError';
    throw err;
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
