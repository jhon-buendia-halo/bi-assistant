import { HttpClient } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { API_BASE_URL } from '../config/api.config';
import { ThemePreference, ThemeService } from '../theme/theme.service';

/** `GET /ui-preferences`: `null` = never chosen (api.md 56). */
export interface UiPreferences {
  theme: ThemePreference | null;
  navExpanded: boolean | null;
}

/** Browser copy of the drawer state, read before the backend answers. */
export const NAV_EXPANDED_STORAGE_KEY = 'questions-to-insights:nav-expanded';

/** Missing or unknown values mean expanded (app-shell R50). */
export function parseNavExpanded(value: string | null | undefined): boolean {
  return value !== 'false';
}

/**
 * The renderer's remembered theme and drawer state (ADR-0009). The backend
 * document is the source of truth; browser storage holds a copy so the first
 * paint is right, and the backend wins once it answers.
 */
@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly theme = inject(ThemeService);
  private readonly window = inject(DOCUMENT).defaultView;

  /** The navigation drawer (app-shell R48, R50). */
  readonly navExpanded = signal(parseNavExpanded(this.readStorage()));

  // A choice made before the backend answered must not be overwritten by it.
  private themeChosen = false;
  private navChosen = false;

  /** Reconciles with the backend; called once at app start. */
  load(): void {
    this.http.get<UiPreferences>(`${API_BASE_URL}/ui-preferences`).subscribe({
      next: (saved) => {
        if (!this.themeChosen) {
          if (saved.theme) {
            this.theme.setPreference(saved.theme);
          } else if (this.theme.hasStoredChoice()) {
            // A choice saved before the backend kept it moves there once (M12).
            this.save({ theme: this.theme.preference() });
          }
        }
        if (!this.navChosen && saved.navExpanded !== null) {
          this.navExpanded.set(saved.navExpanded);
          this.writeStorage(saved.navExpanded);
        }
      },
      error: () => {
        // Backend unreachable: the browser copies keep working (R43).
      },
    });
  }

  /** The Appearance choice: applied at once and remembered (R40). */
  chooseTheme(preference: ThemePreference): void {
    this.themeChosen = true;
    this.theme.setPreference(preference);
    this.save({ theme: preference });
  }

  /** An Expand / Collapse click; opening via Sessions doesn't call this. */
  setNavExpanded(expanded: boolean): void {
    this.navChosen = true;
    this.navExpanded.set(expanded);
    this.writeStorage(expanded);
    this.save({ navExpanded: expanded });
  }

  private save(patch: Partial<UiPreferences>): void {
    this.http
      .put(`${API_BASE_URL}/ui-preferences`, patch)
      .subscribe({ error: () => undefined });
  }

  private readStorage(): string | null {
    try {
      return this.window?.localStorage.getItem(NAV_EXPANDED_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private writeStorage(expanded: boolean): void {
    try {
      this.window?.localStorage.setItem(
        NAV_EXPANDED_STORAGE_KEY,
        String(expanded),
      );
    } catch {
      // Storage blocked: the state still applies for this run.
    }
  }
}
