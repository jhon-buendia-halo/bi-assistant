import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { EngineSettingsDoc } from '../engine-options';

/**
 * Single-document engine settings, upserted in place by key ('engine') — the
 * same settings collection `LlmSettingsRepository` uses for key `'llm'`, not
 * a new collection (see `database.module.ts`).
 */
@Injectable()
export class EngineSettingsRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<EngineSettingsDoc>,
  ) {}

  get(): Promise<EngineSettingsDoc | null> {
    return this.store.findOne({ key: 'engine' });
  }

  /**
   * Full replace of the known fields (mirrors `LlmSettingsRepository.save`).
   * A field explicitly set to `undefined` (e.g. clearing `judgeModel`) is
   * dropped on write — `SqliteDocStore.update` merges this patch onto the
   * existing document, then `JSON.stringify` omits `undefined`-valued keys.
   */
  save(doc: Omit<EngineSettingsDoc, 'key'>): Promise<EngineSettingsDoc | null> {
    return this.store.update(
      { key: 'engine' },
      { key: 'engine', ...doc },
      { upsert: true },
    );
  }
}
