import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import {
  UI_PREFERENCES_KEY,
  type UiPreferencesDoc,
} from '../entities/ui-preferences.entity';

/**
 * The UI preferences, kept as one more `settings` document beside the LLM and
 * built-in pins ones (data-model 3.2). Each reader filters by its own `key`.
 */
@Injectable()
export class UiPreferencesRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<UiPreferencesDoc>,
  ) {}

  get(): Promise<UiPreferencesDoc | null> {
    return this.store.findOne({ key: UI_PREFERENCES_KEY });
  }

  async patch(
    patch: Partial<Pick<UiPreferencesDoc, 'theme' | 'navExpanded'>>,
  ): Promise<UiPreferencesDoc | null> {
    const existing = await this.get();
    await this.store.update(
      { key: UI_PREFERENCES_KEY },
      { ...existing, ...patch, key: UI_PREFERENCES_KEY },
      { upsert: true },
    );
    return this.get();
  }
}
