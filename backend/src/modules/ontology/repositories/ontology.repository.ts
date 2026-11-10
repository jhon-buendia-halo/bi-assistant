import { Inject, Injectable } from '@nestjs/common';
import { ONTOLOGY_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { OntologyItem } from '../entities/ontology-item.entity';

/**
 * Ontology items, keyed by id. The dataset-or-shared rule needs an OR the
 * `DocStore` filter surface does not express, so filtering lives in
 * `OntologyService` over the full `list()`, the same trade `MetricsService`
 * makes over `MetricsRepository.list()`.
 */
@Injectable()
export class OntologyRepository {
  constructor(
    @Inject(ONTOLOGY_STORE)
    private readonly store: DocStore<OntologyItem>,
  ) {}

  /** Every item, newest `updatedAt` first. */
  list(): Promise<OntologyItem[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  get(id: string): Promise<OntologyItem | null> {
    return this.store.findOne({ id });
  }

  insert(doc: OntologyItem): Promise<OntologyItem> {
    return this.store.insert(doc);
  }

  /**
   * Write `next` as the whole document: its fields are merged over the stored
   * ones (restamping `updatedAt`), then every stored field `next` lacks is
   * removed, so a field dropped by the kind rules does not linger.
   */
  async replace(
    id: string,
    next: Omit<OntologyItem, 'createdAt' | 'updatedAt'>,
  ): Promise<OntologyItem | null> {
    let saved = await this.store.update({ id }, next);
    if (!saved) return null;
    for (const key of Object.keys(saved)) {
      if (key === 'createdAt' || key === 'updatedAt') continue;
      if (!(key in next)) {
        saved = (await this.store.unset({ id }, key)) ?? saved;
      }
    }
    return saved;
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
