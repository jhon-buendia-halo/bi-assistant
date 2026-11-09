import { Inject, Injectable } from '@nestjs/common';
import { DATASETS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { DatasourceKind } from '../../datasources/entities/datasource.entity';

export interface DatasetColumnSnapshot {
  name: string;
  type: string;
  nullable: boolean;
  /**
   * Distinct values observed in a save-time sample. Lets the assistant match
   * user phrasing to the values actually stored (the #1 NL2SQL error class)
   * without a live round-trip. Absent on datasets saved before enrichment.
   */
  sampleValues?: string[];
  /** Catalog comment for the column, when the datasource exposes one. */
  description?: string;
  /**
   * Where this column joins, when it is a key into another dataset entity.
   * The model is otherwise told which columns exist but never which one joins
   * to which, and guesses — writing `goals.team_id` for `goals.scoring_team_id`.
   * `declared` comes from the datasource's own constraints, `inferred` from
   * naming, so the model knows which to trust.
   */
  references?: {
    entity: string;
    column: string;
    source: 'declared' | 'inferred';
  };
}

export interface DatasetEntitySnapshot {
  /** Fully-qualified `catalog.schema.table`. */
  key: string;
  columns: DatasetColumnSnapshot[];
}

/** Data layer a schema plays in a dataset (BA-318). */
export type SchemaLayer = 'landing' | 'normalized' | 'consumption';

export const SCHEMA_LAYERS: SchemaLayer[] = [
  'landing',
  'normalized',
  'consumption',
];

/** Schema descriptions are trimmed and cut to this many characters. */
export const SCHEMA_DESCRIPTION_MAX = 500;

/**
 * The user's note on one schema of a dataset (BA-318). Per dataset: the same
 * schema can carry different notes in two datasets. Never stored empty: a
 * note has a layer, a description, or both.
 */
export interface DatasetSchemaNote {
  /** `catalog.schema`. */
  key: string;
  layer?: SchemaLayer;
  description?: string;
}

export interface DatasetDoc {
  name: string;
  /** Datasource the entities belong to (absent on pre-datasource datasets). */
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
  /** Fully-qualified included entities: `catalog.schema.table`. */
  tables: string[];
  /**
   * Schema snapshot taken at save time so agent context building and
   * describe_entity don't need a live datasource round-trip.
   */
  entities?: DatasetEntitySnapshot[];
  /** Schema notes (BA-318); absent on datasets without any. */
  schemas?: DatasetSchemaNote[];
  createdAt?: string;
  updatedAt?: string;
}

/** Named datasets, upserted by name. */
@Injectable()
export class DatasetsRepository {
  constructor(
    @Inject(DATASETS_STORE)
    private readonly store: DocStore<DatasetDoc>,
  ) {}

  list(): Promise<DatasetDoc[]> {
    // `$exists` filter skips legacy single-selection docs in the same table.
    return this.store.find(
      { name: { $exists: true } },
      { sort: { updatedAt: -1 } },
    );
  }

  async save(
    name: string,
    tables: string[],
    entities: DatasetEntitySnapshot[],
    datasource?: { id: string; kind: DatasourceKind },
    schemas?: DatasetSchemaNote[],
  ): Promise<DatasetDoc | null> {
    const saved = await this.store.update(
      { name },
      {
        name,
        tables,
        entities,
        ...(datasource
          ? { datasourceId: datasource.id, datasourceKind: datasource.kind }
          : {}),
        ...(schemas?.length ? { schemas } : {}),
      },
      { upsert: true },
    );
    // The store merges the patch, so an empty list must drop a stored key.
    if (!schemas?.length && saved?.schemas !== undefined) {
      return this.store.unset({ name }, 'schemas');
    }
    return saved;
  }

  getByNames(names: string[]): Promise<DatasetDoc[]> {
    return this.list().then((all) => all.filter((s) => names.includes(s.name)));
  }

  delete(name: string): Promise<number> {
    return this.store.deleteOne({ name });
  }
}
