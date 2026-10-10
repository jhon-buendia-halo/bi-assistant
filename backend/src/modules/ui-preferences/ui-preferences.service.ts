import { BadRequestException, Injectable } from '@nestjs/common';
import {
  THEME_PREFERENCES,
  type ThemePreference,
  type UiPreferences,
  type UiPreferencesDoc,
} from './entities/ui-preferences.entity';
import { UiPreferencesRepository } from './repositories/ui-preferences.repository';

function isTheme(value: unknown): value is ThemePreference {
  return (THEME_PREFERENCES as unknown[]).includes(value);
}

/** A stored value that isn't valid reads as never chosen (api.md 56). */
function toView(doc: UiPreferencesDoc | null): UiPreferences {
  return {
    theme: isTheme(doc?.theme) ? doc.theme : null,
    navExpanded: typeof doc?.navExpanded === 'boolean' ? doc.navExpanded : null,
  };
}

@Injectable()
export class UiPreferencesService {
  constructor(private readonly repository: UiPreferencesRepository) {}

  async get(): Promise<UiPreferences> {
    return toView(await this.repository.get());
  }

  /** Changes only the fields sent (api.md 57). */
  async save(body: unknown): Promise<UiPreferences> {
    const input = (body ?? {}) as Record<string, unknown>;
    const patch: Partial<Pick<UiPreferencesDoc, 'theme' | 'navExpanded'>> = {};
    if (input.theme !== undefined) {
      if (!isTheme(input.theme)) {
        throw new BadRequestException(
          `theme must be one of: ${THEME_PREFERENCES.join(', ')}`,
        );
      }
      patch.theme = input.theme;
    }
    if (input.navExpanded !== undefined) {
      if (typeof input.navExpanded !== 'boolean') {
        throw new BadRequestException('navExpanded must be true or false');
      }
      patch.navExpanded = input.navExpanded;
    }
    if (!Object.keys(patch).length) return this.get();
    return toView(await this.repository.patch(patch));
  }
}
