import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App, composerModelLabel } from './app';
import { MonitoringStateService } from './features/monitoring/services/monitoring-state.service';

describe('App', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('lets the user select text anywhere (BA-326)', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement)
      .firstElementChild as HTMLElement;
    expect(root.classList.contains('select-none')).toBeFalse();
    expect(getComputedStyle(root).userSelect).not.toBe('none');
  });

  it('should render the navigation rail', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector(
        '[aria-label="Navigation rail"] button[aria-label="Sessions"]',
      ),
    ).toBeTruthy();
    expect(
      compiled.querySelector('[aria-label="Open system logs"]'),
    ).toBeTruthy();
    expect(compiled.querySelector('[title="Help"]')).toBeFalsy();
  });

  it('opens the Monitoring page with the LLM calls table from the rail (app-shell R3b, roadmap 1.21.14)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    app.selectArea('monitoring');
    fixture.detectChanges();
    expect(app.mainView()).toBe('monitoring');
    expect(app.currentArea()).toBe('monitoring');
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
    app.selectArea('monitoring');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    app.openLlmCall('call-1');
    fixture.detectChanges();
    expect(app.mainView()).toBe('llm-call');
    expect(app.currentArea()).toBe('monitoring');
    expect(app.activeLlmCallId()).toBe('call-1');
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
    expect(app.mainView()).toBe('monitoring');

    // Choosing Monitoring on the rail from a call returns to the table.
    app.openLlmCall('call-2');
    app.selectArea('monitoring');
    expect(app.mainView()).toBe('monitoring');
    // From the table it stays on the table.
    app.selectArea('monitoring');
    expect(app.mainView()).toBe('monitoring');
  });

  it('switches Monitoring between LLM calls and Sessions tabs; the note follows the tab (roadmap 1.21.16)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const state = TestBed.inject(MonitoringStateService);
    app.selectArea('monitoring');
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
    expect(sessions.textContent?.trim()).toBe('Sessions');
    expect(calls.getAttribute('aria-selected')).toBe('true');
    expect(sessions.getAttribute('aria-selected')).toBe('false');
    expect(sessions.getAttribute('tabindex')).toBe('-1');

    // The arrow keys move to the other tab.
    calls.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(state.tab()).toBe('sessions');
    expect(q('monitoring-tab-sessions').getAttribute('aria-selected')).toBe('true');
    expect(q('monitoring-note').textContent?.trim()).toBe(
      'Sessions with recorded agent runs, most recent first.',
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
      'No sessions yet.',
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
    app.selectArea('sessions');
    fixture.detectChanges();
    app.selectArea('monitoring');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('monitoring-tab-sessions').getAttribute('aria-selected')).toBe('true');
  });

  it('opens a session from the Sessions tab with a Monitoring back control to that tab (roadmap 1.21.16)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const state = TestBed.inject(MonitoringStateService);
    app.selectArea('monitoring');
    state.setTab('sessions');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    app.openMonitoringSession('session-1');
    fixture.detectChanges();
    expect(app.mainView()).toBe('monitoring-session');
    expect(app.currentArea()).toBe('monitoring');
    expect(app.activeMonitoringSessionId()).toBe('session-1');
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
    expect(app.mainView()).toBe('monitoring');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      compiled
        .querySelector('[data-testid="monitoring-tab-sessions"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true');

    // The rail returns from a session page to the Monitoring page, tab kept.
    app.openMonitoringSession('session-1');
    app.selectArea('monitoring');
    expect(app.mainView()).toBe('monitoring');
    expect(state.tab()).toBe('sessions');
  });

  it('a call opened from a session page goes back to it with "Session"; from the table with "Monitoring" (roadmap 1.21.16)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.selectArea('monitoring');
    app.openMonitoringSession('session-1');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const back = () =>
      compiled.querySelector('[data-testid="llm-call-back"]') as HTMLButtonElement;

    app.openLlmCallFromSession('gen-1');
    fixture.detectChanges();
    expect(app.mainView()).toBe('llm-call');
    expect(app.activeLlmCallId()).toBe('gen-1');
    expect(back().textContent?.trim()).toBe('Session');
    back().click();
    fixture.detectChanges();
    expect(app.mainView()).toBe('monitoring-session');
    expect(app.activeMonitoringSessionId()).toBe('session-1');

    // From the calls table the back control stays Monitoring.
    app.selectArea('monitoring');
    app.openLlmCall('call-1');
    fixture.detectChanges();
    expect(back().textContent?.trim()).toBe('Monitoring');
    back().click();
    fixture.detectChanges();
    expect(app.mainView()).toBe('monitoring');

    // The rail from a call opened from a session returns to Monitoring.
    app.openMonitoringSession('session-1');
    app.openLlmCallFromSession('gen-1');
    app.selectArea('monitoring');
    expect(app.mainView()).toBe('monitoring');
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
      'Sessions',
      'Monitoring',
    ]);

    // Context opens on one card per section, like the Agent Hub.
    app.selectArea('context');
    fixture.detectChanges();
    expect(app.mainView()).toBe('context');
    expect(app.currentArea()).toBe('context');
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
    expect(app.contextSections.map((s) => s.view)).toEqual([
      'ontologies',
      'personas',
      'visuals',
    ]);
  });

  it('opens Visuals from its Context card, with Context still current (roadmap 1.21.12)', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.selectArea('context');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '[data-testid="context-section-visuals"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(app.mainView()).toBe('visuals');
    expect(app.currentArea()).toBe('context');
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
    expect(app.mainView()).toBe('context');
  });

  it('opens Ontologies from its Context card, with Context still current (roadmap 1.21.11)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.selectArea('context');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '[data-testid="context-section-ontologies"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(app.mainView()).toBe('ontologies');
    expect(app.currentArea()).toBe('context');
    expect(compiled.querySelector('app-ontology-overview')).toBeTruthy();

    (
      compiled.querySelector('[data-testid="context-back"]') as HTMLButtonElement
    ).click();
    expect(app.mainView()).toBe('context');
  });

  it('opens User personas from its Context card, with Context still current (roadmap 1.21.6)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.selectArea('context');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '[data-testid="context-section-personas"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(app.mainView()).toBe('personas');
    expect(app.currentArea()).toBe('context');
    expect(
      compiled
        .querySelector('button[aria-label="Context"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    expect(compiled.querySelector('app-persona-list')).toBeTruthy();

    (
      compiled.querySelector('[data-testid="context-back"]') as HTMLButtonElement
    ).click();
    expect(app.mainView()).toBe('context');
    app.openContextSection('personas');
    app.selectArea('context');
    expect(app.mainView()).toBe('context');
  });

  it('should list sessions on the Sessions page, not in the drawer', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.sessions.set([{ id: 's1', name: 'Alpha', datasets: [], messages: [] }]);
    app.sessionsLoaded.set(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('[aria-label="Sessions navigation"]'),
    ).toBeFalsy();
    expect(compiled.querySelector('[data-testid="session-s1"]')).toBeFalsy();

    app.selectArea('sessions');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(app.mainView()).toBe('sessions');
    // From an open chat, the rail returns to the list.
    app.mainView.set('session-chat');
    app.selectArea('sessions');
    expect(app.mainView()).toBe('sessions');
    expect(
      compiled.querySelector(
        'nav[aria-label="Sessions"] [data-testid="session-s1"]',
      ),
    ).toBeTruthy();
  });

  it('should show the app version in the settings sidebar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="app-version"]')).toBeFalsy();

    fixture.componentInstance.settingsOpen.set(true);
    fixture.detectChanges();
    const version = compiled.querySelector('[data-testid="app-version"]');
    expect(version?.textContent).toContain(
      `v${fixture.componentInstance.appVersion}`,
    );
    expect(fixture.componentInstance.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should resize and persist the right panel width', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    // The details panel is closed on launch (app-shell R2).
    app.rightPanelOpen.set(true);
    fixture.detectChanges();
    const handle = fixture.nativeElement.querySelector(
      '.right-panel-resize-handle',
    ) as HTMLElement;
    const initialWidth = app.rightPanelWidth();

    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 500,
        pointerId: 1,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 600,
        pointerId: 1,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }),
    );

    expect(app.rightPanelWidth()).toBe(initialWidth - 100);
    expect(
      localStorage.getItem('questions-to-insights:right-panel-width'),
    ).toBe(String(initialWidth - 100));
  });

  it('should support keyboard resizing from the separator', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    // The details panel is closed on launch (app-shell R2).
    app.rightPanelOpen.set(true);
    fixture.detectChanges();
    const handle = fixture.nativeElement.querySelector(
      '.right-panel-resize-handle',
    ) as HTMLElement;
    const initialWidth = app.rightPanelWidth();

    handle.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }),
    );

    // The panel is clamped to the viewport (innerWidth - 240), which is narrow
    // in headless Chrome, so the default 572 can already exceed the maximum.
    expect(app.rightPanelWidth()).toBe(
      Math.min(
        app.rightPanelMaxWidth(),
        Math.max(app.rightPanelMinWidth, initialWidth - 24),
      ),
    );
  });

  it('should show the active session datasource in the header', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeSession.set({
      id: 'session-1',
      name: 'World Cup analysis',
      datasets: ['Futbol DB'],
      messages: [],
    });
    app.mainView.set('session-chat');
    app.activeSessionDatasources.set([
      {
        id: 'postgres-1',
        name: 'futbol local',
        kind: 'postgres',
        summary: 'localhost:55432/world_cup',
        config: {
          host: 'localhost',
          port: 55432,
          database: 'world_cup',
          user: 'world_cup',
          password: 'masked',
          ssl: false,
        },
      },
    ]);

    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('header') as HTMLElement;
    expect(header.textContent).toContain('Datasource');
    expect(header.textContent).toContain('futbol local');
    expect(header.textContent).toContain('PostgreSQL');
  });
});

describe('App without sign-in or permissions (BA-232)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function shell() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return {
      fixture,
      app: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  const rail = (element: HTMLElement) =>
    element.querySelector('[aria-label="Navigation rail"]') as HTMLElement;

  function settingsLabels(element: HTMLElement): string[] {
    return Array.from(
      element.querySelectorAll('[aria-label="Settings navigation"] button'),
    ).map((button) => button.textContent?.trim() ?? '');
  }

  it('renders the shell at once with no account menu and no Admin item', () => {
    const { element } = shell();
    expect(rail(element)).toBeTruthy();
    expect(
      rail(element).querySelector('button[aria-label="Account menu"]'),
    ).toBeNull();
    expect(
      rail(element).querySelector('button[aria-label="Admin"]'),
    ).toBeNull();
  });

  it('offers every Settings section', () => {
    const { fixture, app, element } = shell();
    app.selectArea('settings');
    fixture.detectChanges();
    expect(settingsLabels(element)).toEqual([
      'Datasource Configuration',
      'LLM Configuration',
      'Testing Data',
      'Developer',
      'Appearance',
    ]);
  });

  it('shows the composer Reasoning effort', () => {
    const { fixture, app, element } = shell();
    app.mainView.set('conversation-new');
    fixture.detectChanges();
    expect(
      element.querySelector('main [title="Reasoning effort"]'),
    ).toBeTruthy();
  });
});

describe('composerModelLabel (llm-settings R53)', () => {
  const view = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: null,
    apiKeyMasked: null,
    reasoningEffort: 'high',
    configured: true,
    apiStyle: null,
  } as const;

  it('shows the model alone for a built-in provider', () => {
    expect(composerModelLabel(view)).toBe('gpt-4o-mini');
    expect(
      composerModelLabel({
        ...view,
        provider: 'lenai',
        baseUrl: 'https://lenai.example.com',
      }),
    ).toBe('gpt-4o-mini');
  });

  it('shows <model> · <host:port> for a custom endpoint', () => {
    expect(
      composerModelLabel({
        ...view,
        provider: 'custom',
        apiStyle: 'openai',
        model: 'llama3.1:8b',
        baseUrl: 'http://127.0.0.1:8317/v1',
      }),
    ).toBe('llama3.1:8b · 127.0.0.1:8317');
    expect(
      composerModelLabel({
        ...view,
        provider: 'custom',
        apiStyle: 'anthropic',
        model: 'claude-sonnet-5-5',
        baseUrl: 'https://gateway.example.com',
      }),
    ).toBe('claude-sonnet-5-5 · gateway.example.com');
  });

  it('shows <model> · GitHub Copilot for Copilot (R65)', () => {
    expect(
      composerModelLabel({ ...view, provider: 'copilot', model: 'gpt-5' }),
    ).toBe('gpt-5 · GitHub Copilot');
  });

  it('is null when nothing is configured', () => {
    expect(
      composerModelLabel({ ...view, configured: false, model: null }),
    ).toBeNull();
  });
});

function modelChip(el: HTMLElement, text: string): HTMLButtonElement {
  const chip = Array.from(el.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!chip) throw new Error(`no model chip reading ${text}`);
  return chip;
}

describe('Composer model chip (llm-settings R53)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('shows a custom model with its endpoint host', () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    fixture.componentInstance.openComposer();
    http
      .match((r) => r.url.endsWith('/llm/settings'))
      .forEach((r) =>
        r.flush({
          provider: 'custom',
          model: 'llama3.1:8b',
          baseUrl: 'http://localhost:11434/v1',
          apiKeyMasked: null,
          reasoningEffort: 'high',
          configured: true,
          apiStyle: 'openai',
        }),
      );
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'llama3.1:8b · localhost:11434',
    );
    const chip = modelChip(
      fixture.nativeElement as HTMLElement,
      'llama3.1:8b · localhost:11434',
    );
    expect(chip.getAttribute('title')).toBe('http://localhost:11434/v1');
  });

  it('gives a built-in provider chip no base URL title', () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    fixture.componentInstance.openComposer();
    http
      .match((r) => r.url.endsWith('/llm/settings'))
      .forEach((r) =>
        r.flush({
          provider: 'openai',
          model: 'gpt-4o-mini',
          baseUrl: null,
          apiKeyMasked: '****abcd',
          reasoningEffort: 'high',
          configured: true,
          apiStyle: null,
        }),
      );
    fixture.detectChanges();
    const chip = modelChip(fixture.nativeElement as HTMLElement, 'gpt-4o-mini');
    expect(chip.hasAttribute('title')).toBe(false);
  });
});

describe('New conversation Workflow picker (sessions-chat R64, roadmap 1.23.6)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  const summary = {
    kind: 'agent' as const,
    owner: 'Official' as const,
    stepCount: 1,
    bar: 'agent' as const,
    trigger: 'chat' as const,
    input: [],
    picksDatasets: false,
    datasets: [] as string[],
    missingDatasets: [] as string[],
    starterQuestions: [] as string[],
  };
  const assistant = {
    ...summary,
    id: 'agent:assistant',
    name: 'Assistant',
    description: 'Answers questions over the datasets you pick.',
    agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
    picksDatasets: true,
  };
  const v2 = {
    ...summary,
    id: 'qti-v2-turn',
    name: 'Questions to Insights v2',
    description: 'A slimmed-down data analyst under construction.',
    kind: 'code' as const,
    stepCount: 4,
    bar: 'steps' as const,
    agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    picksDatasets: true,
  };
  const readiness = {
    ...summary,
    id: 'agent:data-readiness',
    name: 'Data Readiness Agent',
    description: 'Checks datasets.',
    agents: [{ key: 'data-readiness', name: 'Data Readiness Agent' }],
    datasets: ['World Cup Core'],
  };
  const rfp = {
    ...summary,
    id: 'agent:rfp',
    name: 'RFP Builder',
    description: 'Builds RFPs.',
    agents: [{ key: 'rfp', name: 'RFP Builder' }],
    datasets: ['Intellify RFP API'],
  };
  const health = {
    ...summary,
    id: 'agent:u-1',
    name: 'Health plan analyst',
    description: 'Answers about the health plan.',
    owner: 'You' as const,
    agents: [{ key: 'u-1', name: 'Health plan analyst' }],
    datasets: ['World Cup Core'],
  };
  const CATALOGUE = [assistant, v2, readiness, rfp, health];

  function open(
    workflows: unknown[] = CATALOGUE,
    start: (app: App) => void = (app) => app.openComposer(),
  ) {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    start(fixture.componentInstance);
    http
      .match((r) => r.url.endsWith('/workflows'))
      .forEach((r) => r.flush({ workflows }));
    fixture.detectChanges();
    return { fixture, http, app: fixture.componentInstance };
  }

  type Fx = { nativeElement: HTMLElement; detectChanges(): void };
  const trigger = (fixture: Fx) =>
    fixture.nativeElement.querySelector(
      '[data-testid="new-session-workflow"]',
    ) as HTMLButtonElement;
  const listbox = (fixture: Fx) =>
    fixture.nativeElement.querySelector(
      '[role="listbox"][aria-label="Workflow"]',
    ) as HTMLElement | null;
  const options = (fixture: Fx) =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
  const optionNames = (fixture: Fx) =>
    options(fixture).map((o) => o.children[0].textContent?.trim());
  const press = (fixture: Fx, key: string) => {
    trigger(fixture).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };
  const createButton = (fixture: Fx) =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Create'),
    ) as HTMLButtonElement;
  const postBody = (http: HttpTestingController) =>
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/sessions'))
      .request.body;

  it('labels the field Workflow, preselects Assistant and keeps the dataset picker', () => {
    const { fixture } = open();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#new-session-workflow-label')?.textContent?.trim()).toBe(
      'Workflow',
    );
    expect(trigger(fixture).textContent).toContain('Assistant');
    expect(trigger(fixture).getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(listbox(fixture)).toBeNull();
    expect(
      el.querySelector('[data-testid="new-session-workflow-description"]')
        ?.textContent,
    ).toContain('Answers questions over the datasets you pick.');
    expect(el.textContent).toContain(
      'Select at least one dataset for this session',
    );
    expect(
      el.querySelector('[data-testid="new-session-workflow-datasets"]'),
    ).toBeNull();
    expect(createButton(fixture).title).toBe(
      'Name the session and select at least one dataset',
    );
    expect(el.querySelector('[data-testid="new-session-agent"]')).toBeNull();
  });

  it('lists the workflows in the catalogue order, each with its name and description', () => {
    const { fixture } = open();
    trigger(fixture).click();
    fixture.detectChanges();
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(optionNames(fixture)).toEqual([
      'Assistant',
      'Questions to Insights v2',
      'Data Readiness Agent',
      'RFP Builder',
      'Health plan analyst',
    ]);
    expect(options(fixture)[0].getAttribute('aria-selected')).toBe('true');
    expect(options(fixture)[3].children[1].textContent).toContain(
      rfp.description,
    );
  });

  it('never lists a run workflow, nor preselects one (roadmap 1.23.9)', () => {
    const seq = {
      ...summary,
      id: 'seq-text-demo',
      name: 'Sequential test workflow',
      description: 'A three-step example.',
      kind: 'code' as const,
      stepCount: 3,
      bar: 'steps' as const,
      trigger: 'run' as const,
      agents: [],
      input: [
        { name: 'text', label: 'Text', type: 'textarea', required: true },
      ],
    };
    const { fixture } = open([assistant, v2, seq, readiness], (app) =>
      app.openComposer('seq-text-demo'),
    );
    expect(trigger(fixture).textContent).toContain('Assistant');
    trigger(fixture).click();
    fixture.detectChanges();
    expect(optionNames(fixture)).toEqual([
      'Assistant',
      'Questions to Insights v2',
      'Data Readiness Agent',
    ]);
  });

  it('lists a workflow that cannot start disabled with its chatRequirement', () => {
    const { fixture, app } = open([
      assistant,
      { ...rfp, chatRequirement: 'Load the sample first' },
    ]);
    trigger(fixture).click();
    fixture.detectChanges();
    const option = options(fixture)[1];
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.children[1].textContent).toContain('Load the sample first');
    option.click();
    fixture.detectChanges();
    expect(app.composerWorkflowId()).toBe('agent:assistant');
    expect(listbox(fixture)).not.toBeNull();
  });

  it('shows the datasets of a workflow that brings its own and creates with workflowId and the typed name', () => {
    const { fixture, http, app } = open();
    trigger(fixture).click();
    fixture.detectChanges();
    options(fixture)[3].click();
    fixture.detectChanges();
    expect(listbox(fixture)).toBeNull();
    expect(trigger(fixture).textContent).toContain('RFP Builder');
    const el = fixture.nativeElement as HTMLElement;
    const datasets = el.querySelector(
      '[data-testid="new-session-workflow-datasets"]',
    ) as HTMLElement;
    expect(datasets.textContent).toContain('Datasets');
    expect(datasets.textContent).toContain('Intellify RFP API');
    expect(el.textContent).not.toContain(
      'Select at least one dataset for this session',
    );
    expect(createButton(fixture).title).toBe(
      'Start a session with this workflow',
    );
    app.composerName.set('Acme');
    app.selectedDatasets.set(new Set(['Ignored']));
    app.createSession();
    expect(postBody(http)).toEqual({ workflowId: 'agent:rfp', name: 'Acme' });
  });

  it('creates a workflow that brings its datasets with no name when none is typed', () => {
    const { http, app } = open();
    app.pickComposerWorkflow('agent:u-1');
    app.createSession();
    expect(postBody(http)).toEqual({ workflowId: 'agent:u-1' });
  });

  it('opens and picks with the keyboard, skipping disabled workflows, and Escape closes', () => {
    const { fixture, app } = open([
      assistant,
      { ...rfp, chatRequirement: 'Load the sample first' },
      health,
    ]);
    press(fixture, 'ArrowDown');
    expect(listbox(fixture)).not.toBeNull();
    press(fixture, 'ArrowDown');
    expect(app.composerWorkflowActive()).toBe(2);
    press(fixture, 'ArrowUp');
    expect(app.composerWorkflowActive()).toBe(0);
    press(fixture, 'ArrowDown');
    press(fixture, 'Enter');
    expect(app.composerWorkflowId()).toBe('agent:u-1');
    expect(listbox(fixture)).toBeNull();
    press(fixture, 'Enter');
    expect(listbox(fixture)).not.toBeNull();
    press(fixture, 'Escape');
    expect(listbox(fixture)).toBeNull();
    expect(app.composerWorkflowId()).toBe('agent:u-1');
  });

  it('forgets the pick on the next visit', () => {
    const { app } = open();
    app.pickComposerWorkflow('agent:rfp');
    expect(app.composerWorkflowId()).toBe('agent:rfp');
    app.openComposer();
    expect(app.composerWorkflowId()).toBe('agent:assistant');
  });

  it('preselects the workflow it is opened with and keeps the dataset picker for v2', () => {
    const { fixture, app } = open(CATALOGUE, (a) =>
      a.openComposer('qti-v2-turn'),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(app.composerWorkflowId()).toBe('qti-v2-turn');
    expect(trigger(fixture).textContent).toContain('Questions to Insights v2');
    expect(
      el.querySelector('[data-testid="new-session-workflow-description"]')
        ?.textContent,
    ).toContain(v2.description);
    expect(el.textContent).toContain(
      'Select at least one dataset for this session',
    );
    // The preselection is not remembered (R64).
    app.openComposer();
    expect(app.composerWorkflowId()).toBe('agent:assistant');
  });

  it('falls back to Assistant when the preselected workflow is not offered', () => {
    const { app } = open([assistant, rfp], (a) => a.openComposer('qti-v2-turn'));
    expect(app.composerWorkflowId()).toBe('agent:assistant');
  });

  it('requires a name and datasets for v2, then creates with its workflowId', () => {
    const { http, app } = open(CATALOGUE, (a) => a.openComposer('qti-v2-turn'));
    app.composerName.set('Q');
    app.createSession();
    http.expectNone((r) => r.method === 'POST' && r.url.endsWith('/sessions'));
    app.selectedDatasets.set(new Set(['Core']));
    app.createSession();
    expect(postBody(http)).toEqual({
      workflowId: 'qti-v2-turn',
      name: 'Q',
      datasets: ['Core'],
    });
  });

  it('creates an Assistant session with the assistant workflow', () => {
    const { http, app } = open();
    app.composerName.set('Q');
    app.selectedDatasets.set(new Set(['Core']));
    app.createSession();
    expect(postBody(http)).toEqual({
      workflowId: 'agent:assistant',
      name: 'Q',
      datasets: ['Core'],
    });
  });

  it('still offers Assistant when the catalogue fails to load', () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    app.openComposer('qti-v2-turn');
    http
      .match((r) => r.url.endsWith('/workflows'))
      .forEach((r) => r.flush('down', { status: 500, statusText: 'Error' }));
    fixture.detectChanges();
    expect(app.composerWorkflowId()).toBe('agent:assistant');
    expect(trigger(fixture).textContent).toContain('Assistant');
  });
});

describe('Chat header Workflow chip (sessions-chat R57, R59, roadmap 1.23.6)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function header(workflowRef: {
    id: string;
    name: string;
    kind: 'code' | 'agent';
    deleted: boolean;
  }): HTMLElement {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeSession.set({
      id: 'session-1',
      name: 'World Cup analysis',
      datasets: ['World Cup Core'],
      messages: [],
      workflowRef,
    });
    app.mainView.set('session-chat');
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('header') as HTMLElement;
  }

  it('names the workflow of a plain Assistant chat', () => {
    const el = header({
      id: 'agent:assistant',
      name: 'Assistant',
      kind: 'agent',
      deleted: false,
    });
    expect(el.textContent).toContain('Workflow');
    expect(
      el.querySelector('[data-testid="session-workflow"]')?.textContent?.trim(),
    ).toBe('Assistant');
    expect(el.querySelector('[data-testid="session-agent"]')).toBeNull();
  });

  it('names a code-defined workflow', () => {
    const el = header({
      id: 'qti-v2-turn',
      name: 'Questions to Insights v2',
      kind: 'code',
      deleted: false,
    });
    expect(
      el.querySelector('[data-testid="session-workflow"]')?.textContent?.trim(),
    ).toBe('Questions to Insights v2');
  });

  it('marks a deleted agent\'s workflow', () => {
    const el = header({
      id: 'agent:u-1',
      name: 'Cup historian',
      kind: 'agent',
      deleted: true,
    });
    expect(
      el.querySelector('[data-testid="session-workflow"]')?.textContent?.trim(),
    ).toBe('Cup historian · agent deleted');
  });
});

describe('Workflows area (workflows R5-R8, app-shell R3)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  const summary = {
    description: '',
    kind: 'agent' as const,
    owner: 'Official' as const,
    stepCount: 1,
    bar: 'agent' as const,
    trigger: 'chat' as const,
    input: [],
    datasets: [] as string[],
    missingDatasets: [] as string[],
    starterQuestions: [] as string[],
  };
  const assistant = {
    ...summary,
    id: 'agent:assistant',
    name: 'Assistant',
    agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
    picksDatasets: true,
  };
  const v2 = {
    ...summary,
    id: 'qti-v2-turn',
    name: 'Questions to Insights v2',
    kind: 'code' as const,
    stepCount: 4,
    bar: 'steps' as const,
    agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    picksDatasets: true,
  };
  const health = {
    ...summary,
    id: 'agent:u-1',
    name: 'Health plan analyst',
    owner: 'You' as const,
    agents: [{ key: 'u-1', name: 'Health plan analyst' }],
    picksDatasets: false,
    datasets: ['World Cup Core'],
  };

  function setup() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return {
      fixture,
      app: fixture.componentInstance,
      http: TestBed.inject(HttpTestingController),
      el: fixture.nativeElement as HTMLElement,
    };
  }

  it('keeps Workflows current on a workflow page, and the rail returns to the list', () => {
    const { app, fixture, el } = setup();
    app.selectArea('workflows');
    fixture.detectChanges();
    expect(app.mainView()).toBe('workflows');
    expect(el.querySelector('[data-testid="workflows-page"]')).toBeTruthy();
    app.openWorkflow('agent:rfp');
    fixture.detectChanges();
    expect(app.mainView()).toBe('workflow-detail');
    expect(app.activeWorkflowId()).toBe('agent:rfp');
    expect(app.currentArea()).toBe('workflows');
    expect(
      el
        .querySelector('button[aria-label="Workflows"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    app.selectArea('workflows');
    expect(app.mainView()).toBe('workflows');
  });

  it('opens a workflow page with the right panel open on its configuration (ui.md 4.4b)', async () => {
    const { app, fixture, el } = setup();
    expect(app.rightPanelOpen()).toBe(false);
    app.openWorkflow('qti-v2-turn');
    fixture.detectChanges();
    // Both are deferred blocks.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(app.rightPanelOpen()).toBe(true);
    const panel = el.querySelector('aside[aria-label="Details panel"]');
    expect(panel?.querySelector('app-workflow-panel')).toBeTruthy();
    expect(panel?.querySelector('app-entity-details')).toBeNull();
    expect(el.querySelector('main app-workflow-detail')).toBeTruthy();
  });

  it('Start chat on a workflow that picks datasets opens the composer preselected', () => {
    const { app } = setup();
    app.startChatWithWorkflow(v2);
    expect(app.mainView()).toBe('conversation-new');
    expect(app.composerWorkflowId()).toBe('qti-v2-turn');

    app.startChatWithWorkflow(assistant);
    expect(app.mainView()).toBe('conversation-new');
    expect(app.composerWorkflowId()).toBe('agent:assistant');
  });

  it('Start chat on any other workflow creates the session from the workflow and opens it', () => {
    const { app, http } = setup();
    app.startChatWithWorkflow(health);
    expect(app.startingWorkflowId()).toBe('agent:u-1');
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/sessions'),
    );
    expect(req.request.body).toEqual({ workflowId: 'agent:u-1' });
    req.flush({
      ok: true,
      message: 'Session "Health plan analyst" created',
      session: {
        id: 's-1',
        name: 'Health plan analyst',
        datasets: ['World Cup Core'],
        messages: [],
      },
    });
    expect(app.startingWorkflowId()).toBeNull();
    expect(app.mainView()).toBe('session-chat');
    expect(app.activeSession()?.id).toBe('s-1');
  });

  it('a refused Start chat stays put', () => {
    const { app, http } = setup();
    app.openWorkflow(health.id);
    app.startChatWithWorkflow(health);
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/sessions'))
      .flush({ ok: false, message: "None of this agent's datasets exist" });
    expect(app.mainView()).toBe('workflow-detail');
    expect(app.startingWorkflowId()).toBeNull();
  });
});
