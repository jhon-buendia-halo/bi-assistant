import { Inject, Injectable } from '@nestjs/common';
import { SANDBOX_SELECTIONS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';

export interface SandboxEntitySnapshot {
  /** Fully-qualified `catalog.schema.table`. */
  key: string;
  columns: { name: string; type: string; nullable: boolean }[];
}

export interface SandboxDoc {
  name: string;
  /** Fully-qualified included entities: `catalog.schema.table`. */
  tables: string[];
  /**
   * Schema snapshot taken at save time so agent context building and
   * describe_entity don't need a live Databricks round-trip.
   */
  entities?: SandboxEntitySnapshot[];
  createdAt?: string;
  updatedAt?: string;
}

/** Named sandboxes, upserted by name. */
@Injectable()
export class SandboxRepository {
  constructor(
    @Inject(SANDBOX_SELECTIONS_STORE)
    private readonly store: DocStore<SandboxDoc>,
  ) {}

  list(): Promise<SandboxDoc[]> {
    // `$exists` filter skips legacy single-selection docs in the same table.
    return this.store.find(
      { name: { $exists: true } },
      { sort: { updatedAt: -1 } },
    );
  }

  save(
    name: string,
    tables: string[],
    entities: SandboxEntitySnapshot[],
  ): Promise<SandboxDoc | null> {
    return this.store.update(
      { name },
      { name, tables, entities },
      { upsert: true },
    );
  }

  getByNames(names: string[]): Promise<SandboxDoc[]> {
    return this.list().then((all) =>
      all.filter((s) => names.includes(s.name)),
    );
  }

  delete(name: string): Promise<number> {
    return this.store.deleteOne({ name });
  }
}
