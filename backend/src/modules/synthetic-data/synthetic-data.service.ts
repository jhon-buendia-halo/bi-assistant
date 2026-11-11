import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
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
import {
  CHAT_SCRIPT_BYTES_MAX,
  PROFILE_TABLES_MAX,
  SAMPLE_SIZE_MAX,
} from './limits';
import { ProfileCache } from './profile-cache';
import type { buildSampledProfile } from './profile';
import { writerFor } from './dialects';
import {
  exportFileName,
  profileCsv,
  sampleToTable,
  writeCsvZip,
  writeProfileXlsx,
  writeXlsx,
} from './exports';
import type {
  ExportDescription,
  GeneratedTable,
  GenerationPlan,
} from './generator/contract';
import { ScriptRequestError } from './generator/contract';
import { generateTables } from './generator/generate';
import { targetNames, validateScriptRequest } from './generator/plan';
import { writeChunks, XLSX_TYPE, type Download } from './http-stream';
import { createScript, describeExport } from './script';
import type { SampledProfile, ScriptRequest, SyntheticDialect } from './types';

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

const SQL_TYPE = 'application/sql; charset=utf-8';
const ERR_PROFILE_ID = 'profileId is required';
const ERR_CONFIRM =
  'confirmRealData must be true: this export contains real rows';

let cachedVersion: string | undefined;
/** `version` of the backend package, the one the CLI reports. */
function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    cachedVersion = pkg.version ?? 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

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

  /** The cached profile, or the 400 / 404 every export endpoint shares. */
  private requireProfile(
    body: { profileId?: unknown } | undefined,
  ): SampledProfile {
    const id = body?.profileId;
    if (typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException(ERR_PROFILE_ID);
    }
    const profile = this.cache.get(id);
    if (!profile) {
      throw new NotFoundException(
        `Profile "${id}" expired or not found: profile the tables again`,
      );
    }
    return profile;
  }

  private plan(profile: SampledProfile, request: unknown): GenerationPlan {
    try {
      return validateScriptRequest(profile, request);
    } catch (err) {
      if (err instanceof ScriptRequestError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** The attachment of one format over any tables (shared by 112 and 114). */
  private tableDownload(
    profile: SampledProfile,
    plan: GenerationPlan,
    content: 'synthetic' | 'sample',
    tables: () => Iterable<GeneratedTable>,
    notes: string[],
    totalRows: number,
  ): Download {
    const description: ExportDescription = {
      content,
      datasetName: profile.datasetName,
      datasourceKind: profile.dialect,
      appVersion: appVersion(),
      generatedAt: new Date(this.cache.now()),
      profile,
      plan,
      notes,
    };
    const fileName = exportFileName(
      profile.datasetName,
      content,
      plan.format,
      profile.dialect,
      plan.seed,
    );
    if (plan.format === 'sql') {
      const script = createScript({
        description,
        writer: writerFor(profile.dialect),
        tables,
      });
      return {
        contentType: SQL_TYPE,
        fileName,
        headers: {
          'X-Script-Sha256': script.sha256,
          'X-Script-Rows': String(script.rows),
        },
        write: (out) => writeChunks(out, script.chunks()),
      };
    }
    const readme = describeExport(description);
    const headers = { 'X-Export-Rows': String(totalRows) };
    return plan.format === 'csv'
      ? {
          contentType: 'application/zip',
          fileName,
          headers,
          write: async (out) => void (await writeCsvZip(tables(), readme, out)),
        }
      : {
          contentType: XLSX_TYPE,
          fileName,
          headers,
          write: async (out) => void (await writeXlsx(tables(), readme, out)),
        };
  }

  /** 112. Everything is validated here, before any header is written. */
  synthetic(body: Record<string, unknown> | undefined): Download {
    const profile = this.requireProfile(body);
    const plan = this.plan(profile, body);
    const total = plan.tables.reduce((n, t) => n + t.rows, 0);
    return this.tableDownload(
      profile,
      plan,
      'synthetic',
      () => generateTables(profile, plan),
      [],
      total,
    );
  }

  /**
   * The whole `.sql` script of a synthetic copy, for the agent tool
   * (agents.md 3.14): validated like 112, built in memory and refused past
   * `maxBytes` (the chat limit, 256 KB) with the text the model sees.
   */
  scriptText(
    profile: SampledProfile,
    request: Omit<ScriptRequest, 'profileId' | 'format'>,
    maxBytes = CHAT_SCRIPT_BYTES_MAX,
  ): {
    fileName: string;
    text: string;
    bytes: number;
    sha256: string;
    plan: GenerationPlan;
  } {
    const plan = this.plan(profile, {
      ...request,
      profileId: profile.profileId,
      format: 'sql',
    });
    const fileName = exportFileName(
      profile.datasetName,
      'synthetic',
      'sql',
      profile.dialect,
      plan.seed,
    );
    const script = createScript({
      description: {
        content: 'synthetic',
        datasetName: profile.datasetName,
        datasourceKind: profile.dialect,
        appVersion: appVersion(),
        generatedAt: new Date(this.cache.now()),
        profile,
        plan,
        notes: [],
      },
      writer: writerFor(profile.dialect),
      tables: () => generateTables(profile, plan),
    });
    // Count every byte, but stop keeping text once past the limit.
    let parts: string[] | undefined = [];
    let bytes = 0;
    for (const chunk of script.chunks()) {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) parts = undefined;
      else parts?.push(chunk);
    }
    if (!parts) {
      throw new BadRequestException(
        `The script would be ${Math.ceil(bytes / 1024)} KB; the chat limit is ${Math.round(maxBytes / 1024)} KB. Ask for fewer rows or use Profile & synthesize on the dataset.`,
      );
    }
    return {
      fileName,
      text: parts.join(''),
      bytes,
      sha256: script.sha256,
      plan,
    };
  }

  /** 113. */
  profileExport(body: Record<string, unknown> | undefined): Download {
    const profile = this.requireProfile(body);
    const format = body?.format;
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format must be csv or xlsx');
    }
    const fileName = exportFileName(
      profile.datasetName,
      'profile',
      format,
      profile.dialect,
    );
    return format === 'csv'
      ? {
          contentType: 'text/csv; charset=utf-8',
          fileName,
          headers: {},
          write: (out) => writeChunks(out, [profileCsv(profile)]),
        }
      : {
          contentType: XLSX_TYPE,
          fileName,
          headers: {},
          write: (out) => writeProfileXlsx(profile, out),
        };
  }

  /**
   * 114. Re-reads the profile's tables (real rows), then builds the attachment.
   * The rows live only in this call's closure; nothing logs or caches them, and
   * they are dropped once the body is written.
   */
  async sampleExport(
    body: Record<string, unknown> | undefined,
    options: ProfileOptions = {},
  ): Promise<Download> {
    const { signal } = options;
    const profile = this.requireProfile(body);
    if (body?.confirmRealData !== true) {
      throw new BadRequestException(ERR_CONFIRM);
    }
    const format = body.format;
    if (format !== 'sql' && format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format must be sql, csv or xlsx');
    }
    const plan = this.plan(profile, {
      profileId: profile.profileId,
      format,
      targetSchema: body.targetSchema ?? 'sample',
      includeConstraints: false,
    });
    throwIfAborted(signal);

    const ds = await this.datasource(profile.datasourceId);
    const keys = profile.tables.map((t) => t.key);
    let sampled: { tables: { key: string; sample: SampleOutcome }[] };
    try {
      sampled =
        profile.dialect === 'postgres'
          ? await this.sample(
              this.postgres,
              ds.config as PostgresConfig,
              'postgres',
              keys,
              profile.sampleSize,
              signal,
              (ds.config as PostgresConfig).database,
            )
          : await this.sample(
              this.databricks,
              ds.config as DatabricksConfig,
              'databricks',
              keys,
              profile.sampleSize,
              signal,
            );
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
    throwIfAborted(signal);

    const names = targetNames(profile);
    const notes = [
      "Real rows read again on export with the profile's sampling; a changed table or a first-rows read can differ from the profile.",
      "Keys and constraints are not included: the sample's foreign keys may point to rows that were not sampled.",
    ];
    const built: GeneratedTable[] = sampled.tables.map((t) => {
      const target = names.get(t.key) ?? t.key;
      if (t.sample.error) {
        notes.push(`${t.key}: ${t.sample.error}`);
        return sampleToTable(profile, t.key, target, { columns: [], rows: [] });
      }
      return sampleToTable(profile, t.key, target, t.sample);
    });
    let tables: GeneratedTable[] | undefined = built;
    const counts = built.map((t) => t.rows.length);
    const exportPlan: GenerationPlan = {
      ...plan,
      tables: plan.tables.map((t, i) => ({
        key: t.key,
        targetName: t.targetName,
        rows: counts[i],
      })),
    };
    const total = counts.reduce((n, c) => n + c, 0);
    const download = this.tableDownload(
      profile,
      exportPlan,
      'sample',
      () => tables ?? [],
      notes,
      total,
    );
    return {
      ...download,
      write: async (out) => {
        try {
          await download.write(out);
        } finally {
          tables = undefined;
        }
      },
    };
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
    return withSamplingSessions(
      profiler,
      config,
      width,
      signal,
      async (scope) => {
        // A failure here means the datasource cannot be reached: 502.
        const catalog = await scope.tables(config);
        const found = await scope.keys(config);
        const foreignKeys = await scope.foreignKeys(config);
        // A key outside the datasource's database has no ref: it becomes a failed table (R15).
        const resolved = keys.map((k) => entityRefFromKey(kind, k, database));
        const refs = resolved.map(
          (r, i) =>
            r ?? {
              namespace: foreignNamespace(keys[i]),
              name: foreignName(keys[i]),
            },
        );
        const samples: SampleOutcome[] = new Array<SampleOutcome>(refs.length);
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
              ? catalog.find(
                  (t) => t.schema === r.namespace && t.table === r.name,
                )
              : undefined) ?? {
              schema: r.namespace,
              table: r.name,
              columns: [],
            },
            sample: samples[i],
          })),
          keys: found,
          foreignKeys,
        };
      },
    );
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
