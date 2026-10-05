import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DATASETS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import { DatasourcesService } from '../datasources/datasources.service';
import {
  mapWithConcurrency,
  type ForeignKeyEdge,
} from '../datasources/connectors/connector';
import type {
  DatasourceKind,
  QueryResult,
} from '../datasources/entities/datasource.entity';
import { profileColumns, DEFAULT_TOP_VALUES } from './column-profiles';
import type { ProfileDialect } from './column-profiles';
import { applyReferences, inferRelationships } from './relationships';
import { DatasetsRepository } from './repositories/datasets.repository';
import type {
  ColumnProfile,
  DatasetColumnSnapshot,
  DatasetDoc,
  DatasetEntitySnapshot,
} from './repositories/datasets.repository';

/** Rows read per table to derive sample values, and the per-column budget. */
const SAMPLE_ROW_LIMIT = 50;
const MAX_SAMPLE_VALUES = 5;
const SAMPLE_VALUE_CHARS = 40;
/** Sampling sessions in flight at once (over one shared connection where the
 * datasource kind supports it) — enough to be quick without hammering a
 * warehouse. */
const ENRICHMENT_CONCURRENCY = 4;
/** Operator-written dataset description, shown to the assistant. */
const MAX_DESCRIPTION_CHARS = 2000;

export interface SaveDatasetInput {
  name: string;
  tables: string[];
  entities: DatasetEntitySnapshot[];
  datasourceId: string;
  datasourceKind?: unknown;
}

@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name);

  constructor(
    private readonly repository: DatasetsRepository,
    private readonly datasources: DatasourcesService,
    @Inject(DATASETS_STORE)
    private readonly store: DocStore<DatasetDoc>,
  ) {}

  list(): Promise<DatasetDoc[]> {
    return this.repository.list();
  }

  delete(name: string): Promise<number> {
    return this.repository.delete(name);
  }

  /**
   * Validate the selection against its datasource, enrich the schema snapshot
   * with real sample values and column profiles, and upsert the dataset by
   * name.
   */
  async save(input: SaveDatasetInput): Promise<DatasetDoc | null> {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Dataset name is required');
    if (!input.tables.length) {
      throw new BadRequestException('Include at least one entity');
    }
    if (!input.datasourceId) {
      throw new BadRequestException('datasourceId is required');
    }
    const datasource = await this.datasources.get(input.datasourceId);
    if (
      input.datasourceKind !== undefined &&
      input.datasourceKind !== datasource.kind
    ) {
      throw new BadRequestException(
        `Datasource kind must be ${datasource.kind}`,
      );
    }
    const entities = await this.enrich(
      datasource.id,
      datasource.kind,
      input.tables,
      input.entities,
    );
    await this.repository.save(name, input.tables, entities, {
      id: datasource.id,
      kind: datasource.kind,
    });
    return this.touchProfiledAt(name, entities);
  }

  /**
   * Recompute column profiles for an already-saved dataset (its schema
   * snapshot, sample values and join graph are left untouched) and persist
   * them. Used by the `POST /datasets/:name/profile` re-profile action.
   */
  async reprofile(name: string): Promise<DatasetDoc | null> {
    const dataset = (await this.repository.getByNames([name]))[0];
    if (!dataset) throw new NotFoundException(`Dataset "${name}" not found`);
    if (!dataset.datasourceId) {
      throw new BadRequestException(
        `Dataset "${name}" has no datasource to profile`,
      );
    }
    const datasource = await this.datasources.get(dataset.datasourceId);
    const entities = await this.profileEntities(
      datasource.id,
      datasource.kind,
      dataset.entities ?? [],
    );
    await this.repository.save(name, dataset.tables, entities, {
      id: datasource.id,
      kind: datasource.kind,
    });
    return this.touchProfiledAt(name, entities);
  }

  /**
   * Set (or, given an empty string, clear) the operator-written description
   * shown to the assistant. `DatasetsRepository.save` has no room for a field
   * outside `tables`/`entities`/`datasource`, so this goes through the shared
   * `DATASETS_STORE` doc store directly — the same table the repository owns,
   * patching only this one field.
   */
  async updateDescription(
    name: string,
    description: string | undefined,
  ): Promise<DatasetDoc | null> {
    const trimmed = (description ?? '').trim();
    if (trimmed.length > MAX_DESCRIPTION_CHARS) {
      throw new BadRequestException(
        `Description must be ${MAX_DESCRIPTION_CHARS} characters or fewer`,
      );
    }
    const exists = (await this.repository.getByNames([name])).length > 0;
    if (!exists) throw new NotFoundException(`Dataset "${name}" not found`);
    if (!trimmed) return this.store.unset({ name }, 'description');
    return this.store.update({ name }, { description: trimmed });
  }

  /**
   * Add `sampleValues` and column profiles to each column from a live sample,
   * then attach the join graph — profiling runs before the join graph so
   * `applyReferences` can read `distinctCount`/`sampledRows` off the columns
   * it just profiled to infer `cardinality`. Best effort per table: a
   * sampling or profiling failure leaves that snapshot as-is (profiling
   * itself never throws — see `profileColumns`), it never fails the save.
   * Existing datasets are not backfilled — they enrich on re-save.
   */
  private async enrich(
    datasourceId: string,
    kind: DatasourceKind,
    tables: string[],
    entities: DatasetEntitySnapshot[],
  ): Promise<DatasetEntitySnapshot[]> {
    const included = new Set(tables);
    const targets = entities.filter(
      (entity) => entity?.key && included.has(entity.key),
    );
    let samples = new Map<string, QueryResult | Error>();
    try {
      samples = await this.datasources.sampleRowsMany(
        datasourceId,
        targets.map((entity) => entity.key),
        SAMPLE_ROW_LIMIT,
        ENRICHMENT_CONCURRENCY,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Sample-value enrichment skipped: ${message}`);
    }
    const enriched = new Map<string, DatasetEntitySnapshot>();
    for (const entity of targets) {
      const result = samples.get(entity.key);
      if (!result || result instanceof Error) {
        this.logger.warn(
          `Sample-value enrichment skipped for ${entity.key}: ${result?.message ?? 'no sample returned'}`,
        );
        continue;
      }
      enriched.set(entity.key, {
        ...entity,
        columns: withSampleValues(entity.columns ?? [], result.rows),
      });
    }
    const sampled = entities.map(
      (entity) => enriched.get(entity?.key) ?? entity,
    );
    const profiled = await this.profileEntities(
      datasourceId,
      kind,
      sampled,
      included,
    );
    return this.withJoins(datasourceId, tables, profiled);
  }

  /**
   * Attach a `ColumnProfile` to every column of every entity in `scope`
   * (default: all of them) that has profileable columns. One aggregate SQL
   * round-trip per table via `profileColumns` — best-effort, so a table that
   * fails or times out simply keeps its columns unprofiled.
   */
  private async profileEntities(
    datasourceId: string,
    kind: DatasourceKind,
    entities: DatasetEntitySnapshot[],
    scope?: Set<string>,
  ): Promise<DatasetEntitySnapshot[]> {
    const dialect = profileDialectFor(kind);
    // A REST datasource re-fetches every endpoint per statement and speaks
    // SQLite over `api.*` names the profiling SQL does not write, so its
    // columns keep their sample values and go unprofiled.
    if (!dialect) return entities;
    const targets = entities.filter(
      (entity) =>
        entity?.key &&
        Array.isArray(entity.columns) &&
        entity.columns.length > 0 &&
        (!scope || scope.has(entity.key)),
    );
    const profiled = new Map<string, DatasetEntitySnapshot>();
    const run = (sql: string) =>
      this.datasources.runReadOnlySql(datasourceId, sql, DEFAULT_TOP_VALUES);
    await mapWithConcurrency(
      targets,
      ENRICHMENT_CONCURRENCY,
      async (entity) => {
        try {
          const profiles: Record<string, ColumnProfile> = await profileColumns(
            run,
            entity.key,
            entity.columns,
            dialect,
          );
          if (!Object.keys(profiles).length) return;
          profiled.set(entity.key, {
            ...entity,
            columns: entity.columns.map((column) =>
              profiles[column.name]
                ? { ...column, profile: profiles[column.name] }
                : column,
            ),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Profiling skipped for ${entity.key}: ${message}`);
        }
      },
    );
    return entities.map((entity) => profiled.get(entity?.key) ?? entity);
  }

  /** Latest `profiledAt` across every column that has a profile, if any. */
  private latestProfiledAt(
    entities: DatasetEntitySnapshot[],
  ): string | undefined {
    let latest: string | undefined;
    for (const entity of entities) {
      for (const column of entity.columns ?? []) {
        const at = column.profile?.profiledAt;
        if (at && (!latest || at > latest)) latest = at;
      }
    }
    return latest;
  }

  /**
   * Stamp `DatasetDoc.profiledAt` from the columns' own `profile.profiledAt`
   * once `repository.save` has persisted `entities` — same doc-store reason
   * as `updateDescription`: the repository's `save` patch has no room for it.
   */
  private async touchProfiledAt(
    name: string,
    entities: DatasetEntitySnapshot[],
  ): Promise<DatasetDoc | null> {
    const profiledAt = this.latestProfiledAt(entities);
    if (!profiledAt)
      return (await this.repository.getByNames([name]))[0] ?? null;
    return this.store.update({ name }, { profiledAt });
  }

  /**
   * Attach where each key column joins. Declared constraints win; naming
   * inference fills the rest, which is what most lakehouse tables need since
   * they declare no foreign keys at all. Without this the model is told which
   * columns exist but never which one joins to which, and guesses.
   */
  private async withJoins(
    datasourceId: string,
    tables: string[],
    entities: DatasetEntitySnapshot[],
  ): Promise<DatasetEntitySnapshot[]> {
    const inScope = entities.filter((entity) =>
      new Set(tables).has(entity?.key),
    );
    let declared: ForeignKeyEdge[] = [];
    try {
      declared = await this.datasources.foreignKeys(datasourceId, tables);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Declared foreign keys unavailable: ${message}`);
    }
    let inferred: ForeignKeyEdge[] = [];
    try {
      inferred = inferRelationships(inScope);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Relationship inference failed: ${message}`);
    }
    return applyReferences(entities, declared, inferred);
  }
}

/** The profiling SQL dialect for a datasource kind; none for REST (SQLite over fetched endpoints). */
export function profileDialectFor(
  kind: DatasourceKind,
): ProfileDialect | undefined {
  return kind === 'postgres' || kind === 'databricks' ? kind : undefined;
}

/** Attach up to `MAX_SAMPLE_VALUES` distinct stored values per column. */
export function withSampleValues(
  columns: DatasetColumnSnapshot[],
  rows: Record<string, unknown>[],
): DatasetColumnSnapshot[] {
  return columns.map((column) => {
    const sampleValues = distinctValues(rows, column.name);
    return sampleValues.length ? { ...column, sampleValues } : column;
  });
}

function distinctValues(
  rows: Record<string, unknown>[],
  column: string,
): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    if (values.size >= MAX_SAMPLE_VALUES) break;
    const text = stringifyValue(row?.[column]).trim();
    if (!text) continue;
    values.add(
      text.length > SAMPLE_VALUE_CHARS
        ? `${text.slice(0, SAMPLE_VALUE_CHARS)}…`
        : text,
    );
  }
  return Array.from(values);
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return '';
    }
  }
  return '';
}
