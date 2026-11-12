import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { MonitoringNavState } from '../../../../features/monitoring/services/monitoring-nav-state';
import { MonitoringStateService } from '../../services/monitoring-state.service';

const shellState = () => TestBed.inject(ShellState);
const monitoringNav = () => TestBed.inject(MonitoringNavState);

describe('Monitoring area (app-shell R3b, roadmap 1.21.14-1.21.16)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('opens the Monitoring page with the LLM calls table from the rail (app-shell R3b, roadmap 1.21.14)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    shellState().selectArea('monitoring');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('monitoring');
    expect(shellState().currentArea()).toBe('monitoring');
    expect(
      compiled
        .querySelector('button[aria-label="Monitoring"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    const page = compiled.querySelector('[data-testid="monitoring-page"]');
    expect(page?.querySelector('h2')?.textContent?.trim()).toBe('Monitoring');

    // The note, the tabs and the table are a deferred chunk (kept out of the
    // initial bundle).
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      page?.querySelector('[data-testid="monitoring-note"]')?.textContent?.trim(),
    ).toBe("LLM calls made by the app's agents, newest first.");
    expect(compiled.querySelector('app-llm-calls-page')).toBeTruthy();
    http
      .expectOne((req) => req.url.endsWith('/monitoring/llm-calls'))
      .flush({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        facets: { agents: [], models: [], providers: [], sessions: [] },
      });
    fixture.detectChanges();
    expect(
      compiled.querySelector('[data-testid="llm-calls-empty"]')?.textContent?.trim(),
    ).toBe('No LLM calls yet.');
  });

  it('opens an LLM call with a Monitoring back control; the rail returns to the table (roadmap 1.21.15)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    shellState().selectArea('monitoring');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    monitoringNav().openLlmCall('call-1');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('llm-call');
    expect(shellState().currentArea()).toBe('monitoring');
    expect(monitoringNav().activeLlmCallId()).toBe('call-1');
    expect(
      compiled
        .querySelector('button[aria-label="Monitoring"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    const back = compiled.querySelector(
      '[data-testid="llm-call-back"]',
    ) as HTMLButtonElement;
    expect(back.textContent?.trim()).toBe('Monitoring');
    await fixture.whenStable();
    fixture.detectChanges();
    const detail = compiled.querySelector('app-llm-call-detail');
    expect(detail).toBeTruthy();

    back.click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('monitoring');

    // Choosing Monitoring on the rail from a call returns to the table.
    monitoringNav().openLlmCall('call-2');
    shellState().selectArea('monitoring');
    expect(shellState().mainView()).toBe('monitoring');
    // From the table it stays on the table.
    shellState().selectArea('monitoring');
    expect(shellState().mainView()).toBe('monitoring');
  });

  it('switches Monitoring between LLM calls and Sessions tabs; the note follows the tab (roadmap 1.21.16)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const state = TestBed.inject(MonitoringStateService);
    shellState().selectArea('monitoring');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const q = (id: string) =>
      compiled.querySelector(`[data-testid="${id}"]`) as HTMLElement;

    // The tabs and their tables are a deferred chunk.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('[role="tablist"]')).toBeTruthy();
    const calls = q('monitoring-tab-calls');
    const sessions = q('monitoring-tab-sessions');
    expect(calls.getAttribute('role')).toBe('tab');
    expect(calls.textContent?.trim()).toBe('LLM calls');
    expect(sessions.textContent?.trim()).toBe('Runs');
    expect(calls.getAttribute('aria-selected')).toBe('true');
    expect(sessions.getAttribute('aria-selected')).toBe('false');
    expect(sessions.getAttribute('tabindex')).toBe('-1');

    // The arrow keys move to the other tab.
    calls.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(state.tab()).toBe('sessions');
    expect(q('monitoring-tab-sessions').getAttribute('aria-selected')).toBe('true');
    expect(q('monitoring-note').textContent?.trim()).toBe(
      'Runs with recorded agent calls, most recent first.',
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('app-sessions-page')).toBeTruthy();
    expect(compiled.querySelector('app-llm-calls-page')).toBeNull();
    http
      .expectOne((req) => req.url.endsWith('/monitoring/sessions'))
      .flush({ items: [], total: 0, page: 1, pageSize: 25, facets: { agents: [] } });
    fixture.detectChanges();
    expect(q('monitoring-sessions-empty').textContent?.trim()).toBe(
      'No runs yet.',
    );

    q('monitoring-tab-sessions').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft' }),
    );
    fixture.detectChanges();
    expect(state.tab()).toBe('calls');
    expect(q('monitoring-note').textContent?.trim()).toBe(
      "LLM calls made by the app's agents, newest first.",
    );

    // The chosen tab is kept when Monitoring is left and chosen again.
    q('monitoring-tab-sessions').click();
    shellState().selectArea('runs');
    fixture.detectChanges();
    shellState().selectArea('monitoring');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('monitoring-tab-sessions').getAttribute('aria-selected')).toBe('true');
  });

  it('opens a session from the Sessions tab with a Monitoring back control to that tab (roadmap 1.21.16)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const state = TestBed.inject(MonitoringStateService);
    shellState().selectArea('monitoring');
    state.setTab('sessions');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    monitoringNav().openMonitoringSession('session-1');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('monitoring-session');
    expect(shellState().currentArea()).toBe('monitoring');
    expect(monitoringNav().activeMonitoringSessionId()).toBe('session-1');
    expect(
      compiled
        .querySelector('button[aria-label="Monitoring"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('app-session-flow')).toBeTruthy();

    const back = compiled.querySelector(
      '[data-testid="monitoring-session-back"]',
    ) as HTMLButtonElement;
    expect(back.textContent?.trim()).toBe('Monitoring');
    back.click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('monitoring');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      compiled
        .querySelector('[data-testid="monitoring-tab-sessions"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true');

    // The rail returns from a session page to the Monitoring page, tab kept.
    monitoringNav().openMonitoringSession('session-1');
    shellState().selectArea('monitoring');
    expect(shellState().mainView()).toBe('monitoring');
    expect(state.tab()).toBe('sessions');
  });

  it('a call opened from a session page goes back to it with "Session"; from the table with "Monitoring" (roadmap 1.21.16)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    shellState().selectArea('monitoring');
    monitoringNav().openMonitoringSession('session-1');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const back = () =>
      compiled.querySelector('[data-testid="llm-call-back"]') as HTMLButtonElement;

    monitoringNav().openLlmCallFromSession('gen-1');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('llm-call');
    expect(monitoringNav().activeLlmCallId()).toBe('gen-1');
    expect(back().textContent?.trim()).toBe('Session');
    back().click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('monitoring-session');
    expect(monitoringNav().activeMonitoringSessionId()).toBe('session-1');

    // From the calls table the back control stays Monitoring.
    shellState().selectArea('monitoring');
    monitoringNav().openLlmCall('call-1');
    fixture.detectChanges();
    expect(back().textContent?.trim()).toBe('Monitoring');
    back().click();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('monitoring');

    // The rail from a call opened from a session returns to Monitoring.
    monitoringNav().openMonitoringSession('session-1');
    monitoringNav().openLlmCallFromSession('gen-1');
    shellState().selectArea('monitoring');
    expect(shellState().mainView()).toBe('monitoring');
  });
});
