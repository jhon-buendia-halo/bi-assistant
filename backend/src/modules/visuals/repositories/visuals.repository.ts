import { Inject, Injectable } from '@nestjs/common';
import {
  SETTINGS_STORE,
  VISUALS_STORE,
} from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { VisualChart } from '../entities/visual-chart.entity';
import { VISUALS_SEED_KEY } from '../default-visuals';

/** The `settings` document that marks the default charts as seeded. */
interface VisualsSeedDoc {
  key: string;
  seededAt: string;
}

/** Library charts, keyed by id. Ordering and uniqueness live in the service. */
@Injectable()
export class VisualsRepository {
  constructor(
    @Inject(VISUALS_STORE)
    private readonly store: DocStore<VisualChart>,
    @Inject(SETTINGS_STORE)
    private readonly settings: DocStore<VisualsSeedDoc>,
  ) {}

  /** Whether the default charts were already seeded into this data dir. */
  async isSeeded(): Promise<boolean> {
    return (await this.settings.findOne({ key: VISUALS_SEED_KEY })) !== null;
  }

  /** Records that the default charts were seeded. */
  async markSeeded(): Promise<void> {
    const doc = { key: VISUALS_SEED_KEY, seededAt: new Date().toISOString() };
    await this.settings.update({ key: VISUALS_SEED_KEY }, doc, {
      upsert: true,
    });
  }

  list(): Promise<VisualChart[]> {
    return this.store.find({});
  }

  get(id: string): Promise<VisualChart | null> {
    return this.store.findOne({ id });
  }

  insert(doc: VisualChart): Promise<VisualChart> {
    return this.store.insert(doc);
  }

  /** Partial merge: fields absent from `patch` are left untouched. */
  update(id: string, patch: Partial<VisualChart>): Promise<VisualChart | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
