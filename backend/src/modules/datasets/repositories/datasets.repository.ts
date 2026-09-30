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

  save(
    name: string,
    tables: string[],
    entities: DatasetEntitySnapshot[],
    datasource?: { id: string; kind: DatasourceKind },
  ): Promise<DatasetDoc | null> {
    return this.store.update(
      { name },
      {
        name,
        tables,
        entities,
        ...(datasource
          ? { datasourceId: datasource.id, datasourceKind: datasource.kind }
          : {}),
      },
      { upsert: true },
    );
  }

  getByNames(names: string[]): Promise<DatasetDoc[]> {
    return this.list().then((all) => all.filter((s) => names.includes(s.name)));
  }

  delete(name: string): Promise<number> {
    return this.store.deleteOne({ name });
  }
}
