import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { LlmSettingsDoc } from '../llm.types';

/** Single-document LLM settings, upserted in place by key ('llm'). */
@Injectable()
export class LlmSettingsRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<LlmSettingsDoc>,
  ) {}

  get(): Promise<LlmSettingsDoc | null> {
    return this.store.findOne({ key: 'llm' });
  }

  save(doc: Omit<LlmSettingsDoc, 'key'>): Promise<LlmSettingsDoc | null> {
    return this.store.update(
      { key: 'llm' },
      { key: 'llm', ...doc },
      { upsert: true },
    );
  }

  /** Patch fields on the existing settings doc; null when none exists. */
  patch(fields: Partial<LlmSettingsDoc>): Promise<LlmSettingsDoc | null> {
    return this.store.update({ key: 'llm' }, fields);
  }
}
