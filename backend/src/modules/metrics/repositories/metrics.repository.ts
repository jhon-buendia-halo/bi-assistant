import { Inject, Injectable } from '@nestjs/common';
import { METRICS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { MetricDoc } from '../entities/metric.entity';

/** Curated metric definitions, keyed by id and unique by `name`. */
@Injectable()
export class MetricsRepository {
  constructor(
    @Inject(METRICS_STORE) private readonly store: DocStore<MetricDoc>,
  ) {}

  list(): Promise<MetricDoc[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  get(id: string): Promise<MetricDoc | null> {
    return this.store.findOne({ id });
  }

  /** The metric holding this name, if any — the uniqueness check. */
  findByName(name: string): Promise<MetricDoc | null> {
    return this.store.findOne({ name });
  }

  insert(doc: MetricDoc): Promise<MetricDoc> {
    return this.store.insert(doc);
  }

  /**
   * Patch a metric. `clear` removes optional fields the edit dropped — a patch
   * alone would leave a stale description or dimension list behind.
   */
  async update(
    id: string,
    patch: Partial<MetricDoc>,
    clear: (keyof MetricDoc)[] = [],
  ): Promise<MetricDoc | null> {
    let saved = await this.store.update({ id }, patch);
    for (const field of clear) {
      saved = (await this.store.unset({ id }, field)) ?? saved;
    }
    return saved;
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
