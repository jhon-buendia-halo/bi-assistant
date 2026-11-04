import { Inject, Injectable } from '@nestjs/common';
import {
  DOC_STORE_TRANSACTIONS,
  SETTINGS_STORE,
} from '../../../infrastructure/database/doc-store';
import type {
  DocStore,
  DocStoreTransactions,
} from '../../../infrastructure/database/doc-store';
import { LlmSettingsDoc } from '../llm.types';

/** The settings fields a save may leave out (BA-281). */
export type OptionalLlmSettingsField = 'apiKeyCiphertext' | 'apiStyle';

const OPTIONAL_FIELDS: OptionalLlmSettingsField[] = [
  'apiKeyCiphertext',
  'apiStyle',
];

/** Single-document LLM settings, upserted in place by key ('llm'). */
@Injectable()
export class LlmSettingsRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<LlmSettingsDoc>,
    @Inject(DOC_STORE_TRANSACTIONS)
    private readonly transactions: DocStoreTransactions,
  ) {}

  get(): Promise<LlmSettingsDoc | null> {
    return this.store.findOne({ key: 'llm' });
  }

  /**
   * Replace the settings with `doc`, as one unit. The store's update merges,
   * so an optional field `doc` leaves out (a keyless custom endpoint's
   * `apiKeyCiphertext`, the `apiStyle` of a non-custom provider) is unset in
   * the same transaction: no reader ever sees the new provider paired with
   * the previous provider's key.
   */
  save(doc: Omit<LlmSettingsDoc, 'key'>): Promise<LlmSettingsDoc | null> {
    const absent = OPTIONAL_FIELDS.filter((field) => doc[field] === undefined);
    return this.transactions.run(async () => {
      const saved = await this.store.update(
        { key: 'llm' },
        { key: 'llm', ...doc },
        { upsert: true },
      );
      return absent.length ? this.unsetFields(absent) : saved;
    });
  }

  /** Patch fields on the existing settings doc; null when none exists. */
  patch(fields: Partial<LlmSettingsDoc>): Promise<LlmSettingsDoc | null> {
    return this.store.update({ key: 'llm' }, fields);
  }

  /** Remove optional fields from the settings doc; null when none exists. */
  unset(...fields: OptionalLlmSettingsField[]): Promise<LlmSettingsDoc | null> {
    return this.transactions.run(() => this.unsetFields(fields));
  }

  private async unsetFields(
    fields: OptionalLlmSettingsField[],
  ): Promise<LlmSettingsDoc | null> {
    let doc: LlmSettingsDoc | null = null;
    for (const field of fields) {
      doc = await this.store.unset({ key: 'llm' }, field);
    }
    return doc;
  }
}
