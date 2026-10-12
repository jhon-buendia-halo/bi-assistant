import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { CurrentUserService } from '../../auth/current-user.service';
import {
  UI_PREFERENCES_KEY,
  type UiPreferencesDoc,
} from '../entities/ui-preferences.entity';

/**
 * The UI preferences, kept as one more `settings` document beside the LLM and
 * built-in pins ones (data-model 3.2.1). Each reader filters by its own
 * `key`. They are per user, `ui-preferences:<user id>` in both modes; M13
 * renamed local mode's former bare `ui-preferences` to Demo User's.
 */
@Injectable()
export class UiPreferencesRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<UiPreferencesDoc>,
    private readonly users: CurrentUserService,
  ) {}

  /** The current user's preferences document key. */
  private key(): string {
    return `${UI_PREFERENCES_KEY}:${this.users.ownerScope()}`;
  }

  get(): Promise<UiPreferencesDoc | null> {
    return this.store.findOne({ key: this.key() });
  }

  async patch(
    patch: Partial<Pick<UiPreferencesDoc, 'theme' | 'navExpanded'>>,
  ): Promise<UiPreferencesDoc | null> {
    const key = this.key();
    const existing = await this.get();
    await this.store.update(
      { key },
      { ...existing, ...patch, key },
      { upsert: true },
    );
    return this.get();
  }
}
