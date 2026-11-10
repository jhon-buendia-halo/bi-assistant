import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App, composerModelLabel } from './app';

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

  it('offers Context with Ontologies, User personas then Visuals; Knowledge is gone (app-shell R3a, BA-320)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const labels = Array.from(
      compiled.querySelectorAll('nav[aria-label="Workspace navigation"] button'),
    ).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Datasets', 'Agents', 'Context', 'Sessions']);

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

describe('New conversation Agent picker (BA-230)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  const rfp = {
    key: 'rfp',
    id: 'rfp',
    name: 'RFP Builder',
    description: 'Builds RFPs.',
    tools: [],
    kind: 'official',
    status: 'builtin',
    datasets: ['Intellify RFP API'],
    missingDatasets: [],
    chatRequirement: 'Load the sample first',
  };

  const v2 = {
    key: 'assistant-v2',
    id: 'questions-to-insights-v2',
    name: 'Questions to Insights v2',
    description: 'A slimmed-down data analyst under construction.',
    tools: [],
    kind: 'official',
    status: 'builtin',
    datasets: [],
    missingDatasets: [],
  };

  function open(
    agents: unknown[] = [rfp],
    start: (app: App) => void = (app) => app.openComposer(),
  ) {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    start(fixture.componentInstance);
    http
      .match((r) => r.url.endsWith('/agents'))
      .forEach((r) => r.flush({ agents }));
    fixture.detectChanges();
    return { fixture, http, app: fixture.componentInstance };
  }

  type Fx = { nativeElement: HTMLElement; detectChanges(): void };
  const trigger = (fixture: Fx) =>
    fixture.nativeElement.querySelector(
      '[data-testid="new-session-agent"]',
    ) as HTMLButtonElement;
  const listbox = (fixture: Fx) =>
    fixture.nativeElement.querySelector(
      '[role="listbox"][aria-label="Agent"]',
    ) as HTMLElement | null;
  const options = (fixture: Fx) =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
  const press = (fixture: Fx, key: string) => {
    trigger(fixture).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };

  it('preselects Assistant and keeps the dataset picker', () => {
    const { fixture } = open();
    const el = fixture.nativeElement as HTMLElement;
    expect(trigger(fixture).textContent).toContain('Assistant');
    expect(trigger(fixture).getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(listbox(fixture)).toBeNull();
    expect(el.textContent).toContain(
      'Answers questions over the datasets you pick.',
    );
    expect(el.textContent).toContain(
      'Select at least one dataset for this session',
    );
    expect(
      el.querySelector('[data-testid="new-session-agent-datasets"]'),
    ).toBeNull();
  });

  it('lists each agent with its name and description', () => {
    const { fixture } = open();
    trigger(fixture).click();
    fixture.detectChanges();
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(
      options(fixture).map((o) => o.children[0].textContent?.trim()),
    ).toEqual(['Assistant', 'RFP Builder']);
    expect(options(fixture)[0].getAttribute('aria-selected')).toBe('true');
    expect(options(fixture)[1].children[1].textContent).toContain(
      rfp.description,
    );
  });

  it('lists an agent that cannot start disabled with its reason', () => {
    const { fixture, app } = open([
      { ...rfp, missingDatasets: ['Intellify RFP API'] },
    ]);
    trigger(fixture).click();
    fixture.detectChanges();
    const option = options(fixture)[1];
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.children[1].textContent).toContain('Load the sample first');
    option.click();
    fixture.detectChanges();
    expect(app.composerAgentKey()).toBe('assistant');
    expect(listbox(fixture)).not.toBeNull();
  });

  it('shows the agent datasets read-only and creates from the agent with the name', () => {
    const { fixture, http, app } = open();
    trigger(fixture).click();
    fixture.detectChanges();
    options(fixture)[1].click();
    fixture.detectChanges();
    expect(listbox(fixture)).toBeNull();
    expect(trigger(fixture).textContent).toContain('RFP Builder');
    const el = fixture.nativeElement as HTMLElement;
    const datasets = el.querySelector(
      '[data-testid="new-session-agent-datasets"]',
    ) as HTMLElement;
    expect(datasets.textContent).toContain('Intellify RFP API');
    expect(el.textContent).not.toContain(
      'Select at least one dataset for this session',
    );
    app.composerName.set('Acme');
    app.createSession();
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/sessions'),
    );
    expect(req.request.body).toEqual({ agentId: 'rfp', name: 'Acme' });
  });

  it('opens and picks with the keyboard, skipping disabled agents, and Escape closes', () => {
    const { fixture, app } = open([
      { ...rfp, missingDatasets: ['Intellify RFP API'] },
      { ...rfp, key: 'rfp2', id: 'rfp2', name: 'Second' },
    ]);
    press(fixture, 'ArrowDown');
    expect(listbox(fixture)).not.toBeNull();
    press(fixture, 'ArrowDown');
    expect(app.composerAgentActive()).toBe(2);
    press(fixture, 'ArrowUp');
    expect(app.composerAgentActive()).toBe(0);
    press(fixture, 'ArrowDown');
    press(fixture, 'Enter');
    expect(app.composerAgentKey()).toBe('rfp2');
    expect(listbox(fixture)).toBeNull();
    press(fixture, 'Enter');
    expect(listbox(fixture)).not.toBeNull();
    press(fixture, 'Escape');
    expect(listbox(fixture)).toBeNull();
    expect(app.composerAgentKey()).toBe('rfp2');
  });

  it('forgets the pick on the next visit', () => {
    const { app } = open();
    app.pickComposerAgent('rfp');
    expect(app.composerAgentKey()).toBe('rfp');
    app.openComposer();
    expect(app.composerAgentKey()).toBe('assistant');
  });

  it('lists Questions to Insights v2 right after Assistant (BA-321)', () => {
    const { fixture } = open([rfp, v2]);
    trigger(fixture).click();
    fixture.detectChanges();
    expect(
      options(fixture).map((o) => o.children[0].textContent?.trim()),
    ).toEqual(['Assistant', 'Questions to Insights v2', 'RFP Builder']);
    expect(options(fixture)[1].children[1].textContent).toContain(
      v2.description,
    );
  });

  it('preselects v2 from its Start chat and keeps the dataset picker (BA-321)', () => {
    const { fixture, app } = open([rfp, v2], (a) =>
      a.startChatWithAgent(v2 as never),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(app.composerAgentKey()).toBe('assistant-v2');
    expect(trigger(fixture).textContent).toContain('Questions to Insights v2');
    expect(
      el.querySelector('[data-testid="new-session-agent-description"]')
        ?.textContent,
    ).toContain(v2.description);
    expect(el.textContent).toContain(
      'Select at least one dataset for this session',
    );
    expect(
      el.querySelector('[data-testid="new-session-agent-datasets"]'),
    ).toBeNull();
    // The preselection is not remembered (R64).
    app.openComposer();
    expect(app.composerAgentKey()).toBe('assistant');
  });

  it('falls back to Assistant when v2 is not offered', () => {
    const { app } = open([rfp], (a) => a.startChatWithAgent(v2 as never));
    expect(app.composerAgentKey()).toBe('assistant');
  });

  it('requires a name and datasets for v2, then creates with its agentId (BA-321)', () => {
    const { http, app } = open([rfp, v2], (a) =>
      a.startChatWithAgent(v2 as never),
    );
    app.composerName.set('Q');
    app.createSession();
    http.expectNone((r) => r.method === 'POST' && r.url.endsWith('/sessions'));
    app.selectedDatasets.set(new Set(['Core']));
    app.createSession();
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/sessions'),
    );
    expect(req.request.body).toEqual({
      name: 'Q',
      datasets: ['Core'],
      agentId: 'assistant-v2',
    });
  });

  it('creates an Assistant session without an agentId', () => {
    const { http, app } = open([rfp, v2]);
    app.composerName.set('Q');
    app.selectedDatasets.set(new Set(['Core']));
    app.createSession();
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/sessions'),
    );
    expect(req.request.body).toEqual({ name: 'Q', datasets: ['Core'] });
  });
});
