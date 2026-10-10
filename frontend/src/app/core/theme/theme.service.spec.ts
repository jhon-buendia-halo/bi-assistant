import { TestBed } from '@angular/core/testing';
import {
  THEME_STORAGE_KEY,
  ThemeService,
  parseThemePreference,
  resolveTheme,
} from './theme.service';

describe('parseThemePreference', () => {
  it('keeps system, light and dark', () => {
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('treats missing or unknown values as light', () => {
    for (const value of [null, undefined, '', 'Dark', 'blue']) {
      expect(parseThemePreference(value)).toBe('light');
    }
  });
});

describe('resolveTheme', () => {
  it('follows the operating system only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('ThemeService', () => {
  afterEach(() => localStorage.removeItem(THEME_STORAGE_KEY));

  it('reads the remembered choice and applies it to the root element', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const service = TestBed.inject(ThemeService);
    TestBed.tick();

    expect(service.preference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('remembers a new choice and applies it at once', () => {
    const service = TestBed.inject(ThemeService);
    service.setPreference('light');
    TestBed.tick();

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(service.resolved()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('suppresses transitions only for the frame of a theme change', async () => {
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    const next = service.resolved() === 'dark' ? 'light' : 'dark';
    service.setPreference(next);
    TestBed.tick();

    const root = document.documentElement;
    expect(root.classList.contains('theme-switching')).toBeTrue();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.classList.contains('theme-switching')).toBeFalse();
  });
});
