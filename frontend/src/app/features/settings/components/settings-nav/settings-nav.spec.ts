import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { APP_VERSION } from '../../../../core/config/app-version';

const shellState = () => TestBed.inject(ShellState);

describe('Settings area', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should show the app version in the settings sidebar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="app-version"]')).toBeFalsy();

    shellState().settingsOpen.set(true);
    fixture.detectChanges();
    const version = compiled.querySelector('[data-testid="app-version"]');
    expect(version?.textContent).toContain(
      `v${APP_VERSION}`,
    );
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('Settings without sign-in or permissions (BA-232)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });


  function settingsLabels(element: HTMLElement): string[] {
    return Array.from(
      element.querySelectorAll('[aria-label="Settings navigation"] button'),
    ).map((button) => button.textContent?.trim() ?? '');
  }

  it('offers every Settings section', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    shellState().selectArea('settings');
    fixture.detectChanges();
    expect(settingsLabels(element)).toEqual([
      'Datasource Configuration',
      'LLM Configuration',
      'Testing Data',
      'Developer',
      'Appearance',
    ]);
  });
});
