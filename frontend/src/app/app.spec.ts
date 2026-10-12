import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { ALL_PERMISSIONS, MeView } from './core/auth/auth.models';
import { AuthService } from './core/auth/auth.service';
import { LOCAL_UMA, localMe, orgMe } from './core/auth/auth.testing';

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

    expect(app.rightPanelWidth()).toBe(initialWidth - 24);
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

describe('App in local and org server mode', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  /** The shell as `me` sees it (the root shows it once signed in). */
  function shellAs(me: MeView) {
    const auth = TestBed.inject(AuthService);
    auth.me.set(me);
    auth.status.set('signed-in');
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

  it("shows Demo User's initials, account menu and Admin in local mode (admin R10, R34)", () => {
    const { element } = shellAs(localMe());
    const avatar = rail(element).querySelector(
      'button[aria-label="Account menu"]',
    ) as HTMLButtonElement;
    expect(avatar.textContent?.trim()).toBe('DU');
    expect(avatar.title).toBe('Demo User');
    expect(
      rail(element).querySelector('button[aria-label="Admin"]'),
    ).toBeTruthy();
  });

  it('offers no Admin to a local persona without Manage users', () => {
    const { element } = shellAs(LOCAL_UMA);
    const avatar = rail(element).querySelector(
      'button[aria-label="Account menu"]',
    ) as HTMLButtonElement;
    expect(avatar.textContent?.trim()).toBe('UU');
    expect(
      rail(element).querySelector('button[aria-label="Admin"]'),
    ).toBeNull();
  });

  it("shows the signed-in user's initials on an org server (admin R10)", () => {
    const { element } = shellAs(orgMe(['use-agents']));
    const avatar = rail(element).querySelector(
      'button[aria-label="Account menu"]',
    ) as HTMLButtonElement;
    expect(avatar.textContent?.trim()).toBe('AL');
    expect(avatar.title).toBe('Ada Lovelace');
    expect(avatar.getAttribute('aria-haspopup')).toBe('menu');
    expect(rail(element).querySelector('[title="Demo User"]')).toBeNull();
  });

  it('offers Admin only with Manage users on an org server (admin R34)', () => {
    const { element: user } = shellAs(orgMe(['use-agents']));
    expect(rail(user).querySelector('button[aria-label="Admin"]')).toBeNull();
  });

  it('opens the Admin area from the rail and marks it current', () => {
    const { fixture, app, element } = shellAs(orgMe([...ALL_PERMISSIONS]));
    const admin = rail(element).querySelector(
      'button[aria-label="Admin"]',
    ) as HTMLButtonElement;
    admin.click();
    fixture.detectChanges();

    expect(app.mainView()).toBe('admin');
    expect(admin.getAttribute('aria-current')).toBe('page');
    expect(element.querySelector('main h2')?.textContent?.trim()).toBe('Admin');
  });

  it('offers every Settings section to Demo User in local mode', () => {
    const { fixture, app, element } = shellAs(localMe());
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

  it('offers only the Settings sections the user may open (app-shell R50)', () => {
    const { fixture, app, element } = shellAs(
      orgMe(['use-agents', 'manage-llm']),
    );
    app.selectArea('settings');
    fixture.detectChanges();
    expect(settingsLabels(element)).toEqual([
      'LLM Configuration',
      'Appearance',
    ]);
  });

  it('falls back to "Choose a settings section." when the chosen one is hidden', () => {
    const { fixture, app, element } = shellAs(orgMe(['use-agents']));
    app.selectArea('settings');
    app.settingsSection.set('developer');
    fixture.detectChanges();
    expect(element.textContent).toContain('Choose a settings section.');
    expect(element.querySelector('app-developer-settings')).toBeNull();
  });

  it('hides the composer Reasoning effort without Manage LLM configuration (admin R26)', () => {
    const { fixture, app, element } = shellAs(orgMe(['use-agents']));
    app.mainView.set('conversation-new');
    fixture.detectChanges();
    expect(element.querySelector('main [title="Reasoning effort"]')).toBeNull();
  });

  it('shows the composer Reasoning effort to Demo User', () => {
    const { fixture, app, element } = shellAs(localMe());
    app.mainView.set('conversation-new');
    fixture.detectChanges();
    expect(
      element.querySelector('main [title="Reasoning effort"]'),
    ).toBeTruthy();
  });
});
