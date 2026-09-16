import { Inject, Injectable } from '@nestjs/common';
import { DATASOURCE_INVENTORIES_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { CatalogInfo } from '../entities/datasource.entity';

/**
 * Last inventory fetched from a datasource, keyed by datasource id. A live
 * walk costs minutes on a cold warehouse, so the browser reads this snapshot
 * until the user asks for a refresh.
 */
export interface InventoryCacheDoc {
  id: string;
  catalogs: CatalogInfo[];
  /** ISO timestamp of the live fetch this snapshot came from. */
  fetchedAt: string;
}

@Injectable()
export class InventoryCacheRepository {
  constructor(
    @Inject(DATASOURCE_INVENTORIES_STORE)
    private readonly store: DocStore<InventoryCacheDoc>,
  ) {}

  get(datasourceId: string): Promise<InventoryCacheDoc | null> {
    return this.store.findOne({ id: datasourceId });
  }

  async save(
    datasourceId: string,
    catalogs: CatalogInfo[],
    fetchedAt: string,
  ): Promise<InventoryCacheDoc> {
    const doc: InventoryCacheDoc = { id: datasourceId, catalogs, fetchedAt };
    const saved = await this.store.update({ id: datasourceId }, doc, {
      upsert: true,
    });
    return saved ?? doc;
  }

  delete(datasourceId: string): Promise<number> {
    return this.store.deleteOne({ id: datasourceId });
  }
}
