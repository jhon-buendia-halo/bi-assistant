import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatasourcesService } from '../datasources/datasources.service';
import type { ForeignKeyEdge } from '../datasources/connectors/connector';
import type { QueryResult } from '../datasources/entities/datasource.entity';
import { applyReferences, inferRelationships } from './relationships';
import { DatasetsRepository } from './repositories/datasets.repository';
import type {
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
  ) {}

  list(): Promise<DatasetDoc[]> {
    return this.repository.list();
  }

  delete(name: string): Promise<number> {
    return this.repository.delete(name);
  }

  /**
   * Validate the selection against its datasource, enrich the schema snapshot
   * with real sample values, and upsert the dataset by name.
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
      input.tables,
      input.entities,
    );
    return this.repository.save(name, input.tables, entities, {
      id: datasource.id,
      kind: datasource.kind,
    });
  }

  /**
   * Add `sampleValues` to each column from a live sample, then attach the join
   * graph. Best effort per table: a sampling failure leaves that snapshot
   * as-is, it never fails the save. Existing datasets are not backfilled —
   * they enrich on re-save.
   */
  private async enrich(
    datasourceId: string,
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
    return this.withJoins(datasourceId, tables, sampled);
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
