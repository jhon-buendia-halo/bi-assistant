import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CONNECTIONS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { Datasource } from '../entities/datasource.entity';

/** Pre-refactor shape: one anonymous Databricks connection keyed by kind. */
interface LegacyDatabricksDoc {
  kind: 'databricks';
  host: string;
  token: string;
  warehouseId: string;
  id?: undefined;
  createdAt?: string;
  updatedAt?: string;
}

/** Stable id given to the migrated legacy connection so old sandboxes can bind to it. */
export const LEGACY_DATABRICKS_ID = 'legacy-databricks';

@Injectable()
export class DatasourcesRepository {
  constructor(
    @Inject(CONNECTIONS_STORE)
    private readonly store: DocStore<Datasource | LegacyDatabricksDoc>,
  ) {}

  async list(): Promise<Datasource[]> {
    const docs = await this.store.find({}, { sort: { updatedAt: -1 } });
    const result: Datasource[] = [];
    for (const doc of docs) {
      if (isLegacy(doc)) {
        // Migrate in place: the anonymous connection becomes a named datasource.
        const migrated: Datasource = {
          id: LEGACY_DATABRICKS_ID,
          name: 'Databricks',
          kind: 'databricks',
          config: {
            host: doc.host,
            token: doc.token,
            warehouseId: doc.warehouseId,
          },
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
        await this.store.update(
          { kind: 'databricks', host: doc.host },
          migrated,
        );
        result.push(migrated);
      } else {
        result.push(doc);
      }
    }
    return result;
  }

  async get(id: string): Promise<Datasource | null> {
    return (await this.list()).find((d) => d.id === id) ?? null;
  }

  async save(
    input: Omit<Datasource, 'id'> & { id?: string },
  ): Promise<Datasource> {
    const id = input.id ?? randomUUID();
    const doc: Datasource = { ...input, id };
    const saved = await this.store.update({ id }, doc, { upsert: true });
    return (saved as Datasource) ?? doc;
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}

function isLegacy(
  doc: Datasource | LegacyDatabricksDoc,
): doc is LegacyDatabricksDoc {
  return !('id' in doc && doc.id) && 'host' in doc && doc.kind === 'databricks';
}
