import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { ShellState } from './core/shell/shell-state';

const shellState = () => TestBed.inject(ShellState);

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
        '[aria-label="Navigation rail"] button[aria-label="Runs"]',
      ),
    ).toBeTruthy();
    expect(
      compiled.querySelector('[aria-label="Open system logs"]'),
    ).toBeTruthy();
    expect(compiled.querySelector('[title="Help"]')).toBeFalsy();
  });

  it('should resize and persist the right panel width', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    // The details panel is closed on launch (app-shell R2).
    shellState().rightPanelOpen.set(true);
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
    shellState().rightPanelOpen.set(true);
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
});

describe('App without sign-in or permissions (BA-232)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });


  it('renders the shell at once with no account menu and no Admin item', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const rail = (el: HTMLElement) =>
      el.querySelector('[aria-label="Navigation rail"]') as HTMLElement;
    expect(rail(element)).toBeTruthy();
    expect(
      rail(element).querySelector('button[aria-label="Account menu"]'),
    ).toBeNull();
    expect(
      rail(element).querySelector('button[aria-label="Admin"]'),
    ).toBeNull();
  });

});
