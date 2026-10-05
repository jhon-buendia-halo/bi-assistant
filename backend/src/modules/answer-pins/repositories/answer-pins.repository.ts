import { Inject, Injectable } from '@nestjs/common';
import { ANSWER_PINS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { AnswerPinDoc } from '../entities/answer-pin.entity';

/**
 * One pin per lineage, keyed on `lineageKey`. `datasets` is an array field,
 * which the doc store's equality/`$exists` filter cannot match against
 * (`matchesFilter` only does `actual === expected`), so dataset-scoped reads
 * and deletes load every pin and filter in-process — fine at this
 * collection's scale (one row per distinct question lineage).
 */
@Injectable()
export class AnswerPinsRepository {
  constructor(
    @Inject(ANSWER_PINS_STORE)
    private readonly store: DocStore<AnswerPinDoc>,
  ) {}

  findByLineageKey(lineageKey: string): Promise<AnswerPinDoc | null> {
    return this.store.findOne({ lineageKey });
  }

  insert(doc: AnswerPinDoc): Promise<AnswerPinDoc> {
    return this.store.insert(doc);
  }

  /** Merge-patch the pin at this lineage; `null` when none exists. */
  patch(
    lineageKey: string,
    patch: Partial<AnswerPinDoc>,
  ): Promise<AnswerPinDoc | null> {
    return this.store.update({ lineageKey }, patch);
  }

  /** Removes one field from the pin at this lineage; `null` when none exists. */
  unset(
    lineageKey: string,
    field: keyof AnswerPinDoc,
  ): Promise<AnswerPinDoc | null> {
    return this.store.unset({ lineageKey }, field);
  }

  /** Deletes the (at most one) pin at this lineage. Returns how many were removed. */
  deleteByLineageKey(lineageKey: string): Promise<number> {
    return this.store.deleteMany({ lineageKey });
  }

  /** Every pin, newest first, optionally scoped to one dataset. */
  async list(datasetId?: string): Promise<AnswerPinDoc[]> {
    const all = await this.store.find({}, { sort: { updatedAt: -1 } });
    return datasetId
      ? all.filter((pin) => pin.datasets.includes(datasetId))
      : all;
  }

  /** Deletes every pin that touches this dataset. Returns how many were removed. */
  async deleteForDataset(datasetId: string): Promise<number> {
    const matches = await this.list(datasetId);
    let deleted = 0;
    for (const pin of matches) {
      deleted += await this.store.deleteMany({ lineageKey: pin.lineageKey });
    }
    return deleted;
  }
}
