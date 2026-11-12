import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { By } from '@angular/platform-browser';
import { ContextArea } from './context-area';

const contextArea = (fixture: { debugElement: import('@angular/core').DebugElement }) =>
  fixture.debugElement.query(By.directive(ContextArea)).componentInstance as ContextArea;

const shellState = () => TestBed.inject(ShellState);

describe('Context area (app-shell R3a, roadmap 1.21.6, 1.21.11, 1.21.12)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('offers Context with Ontologies, User personas then Visuals; Knowledge is gone (app-shell R3a, BA-320)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const labels = Array.from(
      compiled.querySelectorAll('nav[aria-label="Workspace navigation"] button'),
    ).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Datasets',
      'Workflows',
      'Agents',
      'Context',
      'Runs',
      'Monitoring',
    ]);

    // Context opens on one card per section, like the Agent Hub.
    shellState().selectArea('context');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('context');
    expect(shellState().currentArea()).toBe('context');
    expect(
      compiled
        .querySelector('button[aria-label="Context"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    const cards = Array.from(
      compiled.querySelectorAll('[data-testid="context-sections"] button'),
    );
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'context-section-ontologies',
      'context-section-personas',
      'context-section-visuals',
    ]);
    expect(cards[0].textContent).toContain('Ontologies');
    expect(cards[1].textContent).toContain('User personas');
    expect(cards[2].textContent).toContain('Visuals');
    expect(cards[2].textContent).toContain(
      'Chart types for data visualization, grouped by category, with when to use each.',
    );
    expect(
      compiled.querySelector('[data-testid="context-section-knowledge"]'),
    ).toBeNull();
    expect(contextArea(fixture).contextSections.map((s) => s.view)).toEqual([
      'ontologies',
      'personas',
      'visuals',
    ]);
  });

  it('opens Visuals from its Context card, with Context still current (roadmap 1.21.12)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    shellState().selectArea('context');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '[data-testid="context-section-visuals"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('visuals');
    expect(shellState().currentArea()).toBe('context');
    expect(
      compiled
        .querySelector('button[aria-label="Context"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    // The library is a deferred chunk (kept out of the initial bundle).
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('app-visual-library')).toBeTruthy();

    (
      compiled.querySelector('[data-testid="context-back"]') as HTMLButtonElement
    ).click();
    expect(shellState().mainView()).toBe('context');
  });

  it('opens Ontologies from its Context card, with Context still current (roadmap 1.21.11)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    shellState().selectArea('context');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '[data-testid="context-section-ontologies"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('ontologies');
    expect(shellState().currentArea()).toBe('context');
    expect(compiled.querySelector('app-ontology-overview')).toBeTruthy();

    (
      compiled.querySelector('[data-testid="context-back"]') as HTMLButtonElement
    ).click();
    expect(shellState().mainView()).toBe('context');
  });

  it('opens User personas from its Context card, with Context still current (roadmap 1.21.6)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    shellState().selectArea('context');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '[data-testid="context-section-personas"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('personas');
    expect(shellState().currentArea()).toBe('context');
    expect(
      compiled
        .querySelector('button[aria-label="Context"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    expect(compiled.querySelector('app-persona-list')).toBeTruthy();

    (
      compiled.querySelector('[data-testid="context-back"]') as HTMLButtonElement
    ).click();
    expect(shellState().mainView()).toBe('context');
    shellState().mainView.set('personas');
    shellState().selectArea('context');
    expect(shellState().mainView()).toBe('context');
  });
});
