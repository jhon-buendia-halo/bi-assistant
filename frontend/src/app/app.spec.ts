import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

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

  it('should render the sessions navigation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Sessions');
    expect(
      compiled.querySelector('[aria-label="Open system logs"]'),
    ).toBeTruthy();
    expect(compiled.querySelector('[title="Help"]')).toBeFalsy();
  });

  it('should resize and persist the right panel width', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
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
      sandboxes: ['Futbol DB'],
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
