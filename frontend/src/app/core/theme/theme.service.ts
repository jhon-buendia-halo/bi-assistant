import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

/** The Appearance choice (app-shell R39). */
export type ThemePreference = 'system' | 'light' | 'dark';

/** What the app is actually shown in (app-shell R41). */
export type ResolvedTheme = 'light' | 'dark';

/** Must match the boot script in index.html. */
export const THEME_STORAGE_KEY = 'questions-to-insights:theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

interface DesktopThemeBridge {
  setWindowTheme?: (theme: ResolvedTheme) => void;
}

/** Missing or unknown values mean System (app-shell R43). */
export function parseThemePreference(
  value: string | null | undefined,
): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(
  preference: ThemePreference,
  systemIsDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light';
  return preference;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly media = this.window?.matchMedia?.(DARK_QUERY) ?? null;

  readonly preference = signal<ThemePreference>(this.readPreference());
  private readonly systemIsDark = signal(this.media?.matches ?? false);

  readonly resolved = computed<ResolvedTheme>(() =>
    resolveTheme(this.preference(), this.systemIsDark()),
  );

  constructor() {
    if (this.media) {
      const onChange = (event: MediaQueryListEvent) =>
        this.systemIsDark.set(event.matches);
      this.media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() =>
        this.media?.removeEventListener('change', onChange),
      );
    }

    effect(() => {
      const theme = this.resolved();
      this.document.documentElement.setAttribute('data-theme', theme);
      const desktop = (this.window as { desktop?: DesktopThemeBridge } | null)
        ?.desktop;
      desktop?.setWindowTheme?.(theme);
    });
  }

  setPreference(preference: ThemePreference): void {
    this.preference.set(preference);
    try {
      this.window?.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Storage blocked: the choice still applies for this run (R43).
    }
  }

  private readPreference(): ThemePreference {
    try {
      return parseThemePreference(
        this.window?.localStorage.getItem(THEME_STORAGE_KEY),
      );
    } catch {
      return 'system';
    }
  }
}
