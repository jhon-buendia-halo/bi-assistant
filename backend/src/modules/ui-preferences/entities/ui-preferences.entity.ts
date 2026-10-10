/** The Appearance choice (app-shell R39). */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

export const UI_PREFERENCES_KEY = 'ui-preferences';

/**
 * The `settings` document holding the renderer's remembered choices
 * (data-model 3.2.1, ADR-0009). Absent fields were never chosen.
 */
export interface UiPreferencesDoc {
  key: typeof UI_PREFERENCES_KEY;
  theme?: ThemePreference;
  navExpanded?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** API view: `null` = never chosen, so the renderer uses its default. */
export interface UiPreferences {
  theme: ThemePreference | null;
  navExpanded: boolean | null;
}
