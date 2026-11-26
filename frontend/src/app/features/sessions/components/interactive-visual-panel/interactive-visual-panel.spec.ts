import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import {
  InteractiveVisualization,
  Session,
  SessionActionResult,
} from '../../models/session.model';
import { ThemeService } from '../../../../core/theme/theme.service';
import {
  InteractiveVisualPanel,
  withVisualTheme,
} from './interactive-visual-panel';

const session: Session = {
  id: 'session-1',
  name: 'Analysis',
  datasets: [],
  messages: [],
};

function visual(
  overrides: Partial<InteractiveVisualization> = {},
): InteractiveVisualization {
  return {
    id: 'visual-1',
    title: 'Claims by month',
    description: 'A chart',
    path: 'visuals/visual-1',
    sourceMessageAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    currentVersion: 2,
    versions: [
      {
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceMessageAt: '2026-01-01T00:00:00.000Z',
      },
      {
        version: 2,
        createdAt: '2026-01-02T00:00:00.000Z',
        sourceMessageAt: '2026-01-01T00:00:00.000Z',
        instruction: 'make it a line chart',
      },
    ],
    document: '<html></html>',
    version: 2,
    ...overrides,
  };
}

function errorMessage(message: string): MessageEvent {
  return { data: { type: 'visual-error', message } } as MessageEvent;
}

describe('InteractiveVisualPanel runtime errors', () => {
  let fixture: ComponentFixture<InteractiveVisualPanel>;
  let panel: InteractiveVisualPanel;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InteractiveVisualPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(InteractiveVisualPanel);
    panel = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('runId', session.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows the banner and asks the server for nothing (the designer is gone)', () => {
    panel.onFrameMessage(errorMessage('x is not defined'));
    fixture.detectChanges();

    http.expectNone(() => true);
    expect(panel.runtimeError()).toBe('x is not defined');
    expect(fixture.nativeElement.textContent).toContain(
      'This visual hit a runtime error.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Fixing the visual');
  });

  it('clears the banner when another document opens', () => {
    panel.onFrameMessage(errorMessage('boom'));
    fixture.componentRef.setInput(
      'visualization',
      visual({ version: 1, currentVersion: 2 }),
    );
    fixture.detectChanges();
    expect(panel.runtimeError()).toBeNull();
  });

  it('emits clicked data marks as selections', () => {
    const selections: { value: string; label?: string }[] = [];
    panel.dataPointSelected.subscribe((selection) =>
      selections.push(selection),
    );

    panel.onFrameMessage({
      data: {
        type: 'visual-select',
        value: 'Cardiology',
        label: 'Cardiology (312)',
      },
    } as MessageEvent);
    panel.onFrameMessage({
      data: { type: 'visual-select', value: 'Oncology' },
    } as MessageEvent);

    expect(selections).toEqual([
      { value: 'Cardiology', label: 'Cardiology (312)' },
      { value: 'Oncology', label: undefined },
    ]);
  });
});

const refreshUrl = `${API_BASE_URL}/workflow-runs/session-1/visualizations/visual-1/refresh`;

describe('InteractiveVisualPanel data refresh', () => {
  let fixture: ComponentFixture<InteractiveVisualPanel>;
  let panel: InteractiveVisualPanel;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InteractiveVisualPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(InteractiveVisualPanel);
    panel = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('runId', session.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('the refresh button posts to the refresh endpoint and emits the refreshed payload', () => {
    const refreshed: SessionActionResult[] = [];
    panel.visualRefreshed.subscribe((result) => refreshed.push(result));

    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Refresh data"]',
    );
    expect(button).not.toBeNull();
    button.click();
    fixture.detectChanges();

    expect(panel.refreshingData()).toBeTrue();
    const req = http.expectOne(refreshUrl);
    expect(req.request.method).toBe('POST');

    const result: SessionActionResult = {
      ok: true,
      message: 'Refreshed data for version 2',
      session,
      visualization: visual({ version: 2, currentVersion: 2 }),
    };
    req.flush(result);

    expect(panel.refreshingData()).toBeFalse();
    expect(refreshed).toEqual([result]);
  });

  it('does not clear the spinner state or emit on a failed refresh', () => {
    panel.refreshData();
    const refreshed: SessionActionResult[] = [];
    panel.visualRefreshed.subscribe((result) => refreshed.push(result));

    http
      .expectOne(refreshUrl)
      .flush({ ok: false, message: 'No datasource bound' });

    expect(panel.refreshingData()).toBeFalse();
    expect(refreshed).toEqual([]);
  });
});

function visualSelect(
  value: string,
  extra: { label?: string; column?: string } = {},
): MessageEvent {
  return { data: { type: 'visual-select', value, ...extra } } as MessageEvent;
}

describe('InteractiveVisualPanel data point selection', () => {
  let fixture: ComponentFixture<InteractiveVisualPanel>;
  let panel: InteractiveVisualPanel;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InteractiveVisualPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(InteractiveVisualPanel);
    panel = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('runId', session.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('emits dataPointSelected for single-view clicks, column included', () => {
    const selections: { value: string; label?: string; column?: string }[] = [];
    panel.dataPointSelected.subscribe((s) => selections.push(s));

    panel.onFrameMessage(visualSelect('Aetna', { column: 'payer' }));

    expect(selections).toEqual([
      { value: 'Aetna', label: undefined, column: 'payer' },
    ]);
  });

  it('emits dataPointSelected for clicks without a column', () => {
    const selections: { value: string; label?: string; column?: string }[] = [];
    panel.dataPointSelected.subscribe((s) => selections.push(s));

    panel.onFrameMessage(visualSelect('Aetna'));

    expect(selections).toEqual([{ value: 'Aetna', label: undefined }]);
  });
});

describe('withVisualTheme', () => {
  it('writes the theme on the document root', () => {
    expect(
      withVisualTheme(
        '<!doctype html>\n<html lang="en"><body></body></html>',
        'dark',
      ),
    ).toBe(
      '<!doctype html>\n<html data-theme="dark" data-brand="halo" lang="en"><body></body></html>',
    );
  });

  it('leaves an empty document alone', () => {
    expect(withVisualTheme('', 'light')).toBe('');
  });

  it('writes the brand an Agentic Hub build passes (ADR-0045)', () => {
    expect(
      withVisualTheme('<html><body></body></html>', 'light', 'mercer'),
    ).toBe('<html data-theme="light" data-brand="mercer"><body></body></html>');
  });
});

describe('InteractiveVisualPanel theme', () => {
  let fixture: ComponentFixture<InteractiveVisualPanel>;
  let theme: ThemeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InteractiveVisualPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    theme = TestBed.inject(ThemeService);
    theme.setPreference('light');
    fixture = TestBed.createComponent(InteractiveVisualPanel);
    fixture.componentRef.setInput('runId', session.id);
    fixture.componentRef.setInput(
      'visualization',
      visual({ document: '<html lang="en"><body></body></html>' }),
    );
    fixture.detectChanges();
  });

  afterEach(() => theme.setPreference('light'));

  function frame(): HTMLIFrameElement {
    return fixture.nativeElement.querySelector(
      'iframe[title="Interactive visualization"]',
    ) as HTMLIFrameElement;
  }

  it('opens the visual in the app theme', () => {
    expect(frame().getAttribute('srcdoc')).toContain(
      '<html data-theme="light" data-brand="halo" lang="en">',
    );
  });

  it('sends a theme change to the open frame without reloading it', () => {
    const before = frame().getAttribute('srcdoc');
    // The sandboxed frame's window is cross-origin, so stand in for it.
    const post = jasmine.createSpy('postMessage');
    Object.defineProperty(frame(), 'contentWindow', {
      value: { postMessage: post },
    });

    theme.setPreference('dark');
    fixture.detectChanges();

    expect(post.calls.mostRecent().args as unknown[]).toEqual([
      { type: 'qti-theme', theme: 'dark' },
      '*',
    ]);
    expect(frame().getAttribute('srcdoc')).toBe(before);
  });
});

describe('InteractiveVisualPanel on a run (visuals R12-R24; api.md 132, 133)', () => {
  let fixture: ComponentFixture<InteractiveVisualPanel>;
  let panel: InteractiveVisualPanel;
  let http: HttpTestingController;
  const base = `${API_BASE_URL}/workflow-runs/r1/visualizations/visual-1`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InteractiveVisualPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(InteractiveVisualPanel);
    panel = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('runId', 'r1');
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('refreshes through the run route', () => {
    panel.refreshData();
    const req = http.expectOne(`${base}/refresh`);
    expect(req.request.method).toBe('POST');
    req.flush({
      ok: true,
      message: 'Refreshed data for version 2',
      run: { id: 'r1' },
      visualization: visual(),
    });
    expect(panel.refreshingData()).toBeFalse();
  });
});

describe('InteractiveVisualPanel as a background task (ADR-0047)', () => {
  const base = `${API_BASE_URL}/workflow-runs/r1/visualizations/visual-1`;
  let http: HttpTestingController;

  function open(
    onRefreshed?: (result: unknown) => void,
  ): ComponentFixture<InteractiveVisualPanel> {
    const fixture = TestBed.createComponent(InteractiveVisualPanel);
    // Subscribed before the first change detection, which applies a result
    // the panel missed.
    if (onRefreshed)
      fixture.componentInstance.visualRefreshed.subscribe(onRefreshed);
    fixture.componentRef.setInput('runId', 'r1');
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InteractiveVisualPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('applies the result in a panel created after the task ended', () => {
    const first = open();
    const gone: unknown[] = [];
    first.componentInstance.visualRefreshed.subscribe((r) => gone.push(r));
    first.componentInstance.refreshData();
    const req = http.expectOne(`${base}/refresh`);
    first.destroy();

    const result = {
      ok: true,
      message: 'Refreshed',
      run: { id: 'r1' },
      visualization: visual({ version: 3, currentVersion: 3 }),
    };
    req.flush(result);
    expect(gone).toEqual([]);

    const applied: unknown[] = [];
    const second = open((r) => applied.push(r));
    expect(applied).toEqual([result]);
    expect(second.componentInstance.refreshingData()).toBeFalse();

    // A third panel does not apply the same result again.
    const again: unknown[] = [];
    open((r) => again.push(r));
    expect(again).toEqual([]);
  });

});
