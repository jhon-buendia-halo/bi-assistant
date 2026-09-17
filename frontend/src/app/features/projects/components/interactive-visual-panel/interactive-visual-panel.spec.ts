import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import {
  InteractiveVisualization,
  Project,
  ProjectActionResult,
} from '../../models/project.model';
import {
  InteractiveVisualPanel,
  buildTailorInstruction,
} from './interactive-visual-panel';

describe('buildTailorInstruction', () => {
  it('is empty when every control is Auto/None/empty', () => {
    expect(
      buildTailorInstruction({ chartType: 'auto', sort: 'none', topN: null }),
    ).toBe('');
  });

  it('combines chart type, sort and top-N into one instruction', () => {
    expect(
      buildTailorInstruction({ chartType: 'line', sort: 'desc', topN: 10 }),
    ).toBe(
      'Change the visual to a line chart. Sort descending by the main measure. ' +
        'Show only the top 10 items and group the rest as "Other".',
    );
  });

  it('skips the parts left at their default', () => {
    expect(
      buildTailorInstruction({ chartType: 'auto', sort: 'asc', topN: null }),
    ).toBe('Sort ascending by the main measure.');
    expect(
      buildTailorInstruction({
        chartType: 'metric-cards',
        sort: 'none',
        topN: null,
      }),
    ).toBe('Change the visual to metric cards.');
  });

  it('ignores a top-N outside the offered range', () => {
    expect(
      buildTailorInstruction({ chartType: 'auto', sort: 'none', topN: 2 }),
    ).toBe('');
    expect(
      buildTailorInstruction({ chartType: 'auto', sort: 'none', topN: 51 }),
    ).toBe('');
    expect(
      buildTailorInstruction({ chartType: 'auto', sort: 'none', topN: 3 }),
    ).toBe('Show only the top 3 items and group the rest as "Other".');
  });
});

const project: Project = {
  id: 'project-1',
  name: 'Analysis',
  sandboxes: [],
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
      { version: 1, createdAt: '2026-01-01T00:00:00.000Z', sourceMessageAt: '2026-01-01T00:00:00.000Z' },
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

const repairUrl = `${API_BASE_URL}/projects/project-1/visualizations/visual-1/repair`;

describe('InteractiveVisualPanel auto-repair', () => {
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
    fixture.componentRef.setInput('projectId', project.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('repairs the current version once and emits the refreshed payload', () => {
    const refreshed: ProjectActionResult[] = [];
    panel.visualRefreshed.subscribe((result) => refreshed.push(result));

    panel.onFrameMessage(errorMessage('x is not defined'));
    expect(panel.repairing()).toBeTrue();
    expect(panel.runtimeError()).toBeNull();

    const req = http.expectOne(repairUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      error: 'x is not defined',
      version: 2,
    });
    const result: ProjectActionResult = {
      ok: true,
      message: 'Visual repaired',
      project,
      visualization: visual({ version: 3, currentVersion: 3 }),
    };
    req.flush(result);

    expect(panel.repairing()).toBeFalse();
    expect(refreshed).toEqual([result]);

    // A second failure of the same generation only shows the banner.
    panel.onFrameMessage(errorMessage('still broken'));
    http.expectNone(repairUrl);
    expect(panel.runtimeError()).toBe('still broken');
    expect(panel.repairing()).toBeFalse();
  });

  it('falls back to the banner when the repair is rejected', () => {
    panel.onFrameMessage(errorMessage('visual rendered blank'));
    http
      .expectOne(repairUrl)
      .flush({ ok: false, message: 'Already repaired once' });

    expect(panel.repairing()).toBeFalse();
    expect(panel.runtimeError()).toBe('visual rendered blank');
  });

  it('never auto-repairs while an older version is on screen', () => {
    fixture.componentRef.setInput(
      'visualization',
      visual({ version: 1, currentVersion: 2 }),
    );
    fixture.detectChanges();

    panel.onFrameMessage(errorMessage('boom'));

    http.expectNone(repairUrl);
    expect(panel.runtimeError()).toBe('boom');
  });

  it('never repairs a version that is itself an auto-repair', () => {
    fixture.componentRef.setInput(
      'visualization',
      visual({
        versions: [
          {
            version: 2,
            createdAt: '2026-01-02T00:00:00.000Z',
            sourceMessageAt: '2026-01-01T00:00:00.000Z',
            instruction: 'auto-repair: x is not defined',
          },
        ],
      }),
    );
    fixture.detectChanges();

    panel.onFrameMessage(errorMessage('x is still not defined'));

    http.expectNone(repairUrl);
    expect(panel.runtimeError()).toBe('x is still not defined');
  });

  it('emits clicked data marks as selections', () => {
    const selections: { value: string; label?: string }[] = [];
    panel.dataPointSelected.subscribe((selection) =>
      selections.push(selection),
    );

    panel.onFrameMessage({
      data: { type: 'visual-select', value: 'Cardiology', label: 'Cardiology (312)' },
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

describe('InteractiveVisualPanel tailoring', () => {
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
    fixture.componentRef.setInput('projectId', project.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('posts the built instruction and resets the form on success', () => {
    const refreshed: ProjectActionResult[] = [];
    panel.visualRefreshed.subscribe((result) => refreshed.push(result));
    panel.tailorChartType.set('bar');
    panel.tailorSort.set('desc');
    panel.setTopN('10');

    panel.applyTailoring();

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project-1/visualizations/visual-1/tailor`,
    );
    expect(req.request.body).toEqual({
      instruction:
        'Change the visual to a bar chart. Sort descending by the main measure. ' +
        'Show only the top 10 items and group the rest as "Other".',
    });
    const result: ProjectActionResult = {
      ok: true,
      message: 'Visual updated',
      project,
      visualization: visual({ version: 3, currentVersion: 3 }),
    };
    req.flush(result);

    expect(refreshed).toEqual([result]);
    expect(panel.tailorChartType()).toBe('auto');
    expect(panel.tailorTopN()).toBeNull();
    expect(panel.tailorMenuOpen()).toBeFalse();
  });

  it('does nothing when no control was changed', () => {
    expect(panel.tailorInstruction()).toBe('');
    panel.applyTailoring();
    http.expectNone(
      `${API_BASE_URL}/projects/project-1/visualizations/visual-1/tailor`,
    );
    expect(panel.tailoring()).toBeFalse();
  });

  it('surfaces a rejected tailoring as the panel error', () => {
    panel.tailorSort.set('asc');
    panel.applyTailoring();
    http
      .expectOne(
        `${API_BASE_URL}/projects/project-1/visualizations/visual-1/tailor`,
      )
      .flush({ ok: false, message: 'Instruction required' });

    expect(panel.tailoring()).toBeFalse();
    expect(panel.tailorError()).toBe('Instruction required');
  });
});

const refreshUrl = `${API_BASE_URL}/projects/project-1/visualizations/visual-1/refresh`;

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
    fixture.componentRef.setInput('projectId', project.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('the refresh button posts to the refresh endpoint and emits the refreshed payload', () => {
    const refreshed: ProjectActionResult[] = [];
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

    const result: ProjectActionResult = {
      ok: true,
      message: 'Refreshed data for version 2',
      project,
      visualization: visual({ version: 2, currentVersion: 2 }),
    };
    req.flush(result);

    expect(panel.refreshingData()).toBeFalse();
    expect(refreshed).toEqual([result]);
  });

  it('does not clear the spinner state or emit on a failed refresh', () => {
    panel.refreshData();
    const refreshed: ProjectActionResult[] = [];
    panel.visualRefreshed.subscribe((result) => refreshed.push(result));

    http
      .expectOne(refreshUrl)
      .flush({ ok: false, message: 'No datasource bound' });

    expect(panel.refreshingData()).toBeFalse();
    expect(refreshed).toEqual([]);
  });
});

const dashboardUrl = `${API_BASE_URL}/projects/project-1/dashboard`;

describe('InteractiveVisualPanel dashboard', () => {
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
    fixture.componentRef.setInput('projectId', project.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('fetches and renders tiles when toggled to the dashboard view', () => {
    panel.setViewMode('dashboard');
    fixture.detectChanges();

    const req = http.expectOne(dashboardUrl);
    expect(req.request.method).toBe('GET');
    req.flush({
      tiles: [visual({ id: 'visual-2', title: 'Denials by payer' })],
    });
    fixture.detectChanges();

    expect(panel.dashboardTiles().length).toBe(1);
    expect(
      fixture.nativeElement.querySelectorAll('iframe').length,
    ).toBeGreaterThan(0);
  });

  it('shows the empty-dashboard hint when nothing is pinned', () => {
    panel.setViewMode('dashboard');
    fixture.detectChanges();
    http.expectOne(dashboardUrl).flush({ tiles: [] });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Pin visuals to build a dashboard',
    );
  });

  it('unpin calls the API and refetches the dashboard', () => {
    panel.setViewMode('dashboard');
    fixture.detectChanges();
    http
      .expectOne(dashboardUrl)
      .flush({ tiles: [visual({ id: 'visual-2', title: 'Denials by payer' })] });
    fixture.detectChanges();

    const pinsChanged: void[] = [];
    panel.pinsChanged.subscribe(() => pinsChanged.push(undefined));

    panel.unpinTile('visual-2');

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project-1/dashboard/pins/visual-2`,
    );
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, message: 'Visual unpinned from dashboard', project });

    expect(pinsChanged.length).toBe(1);
    http.expectOne(dashboardUrl).flush({ tiles: [] });
    expect(panel.dashboardTiles()).toEqual([]);
  });

  it('reflects pinned state on the single-view pin button', () => {
    fixture.componentRef.setInput('pins', ['visual-1']);
    fixture.detectChanges();

    expect(panel.isPinned('visual-1')).toBeTrue();
    const pinButton = fixture.nativeElement.querySelector(
      'button[aria-label="Unpin from dashboard"]',
    );
    expect(pinButton).not.toBeNull();
  });

  it('shows the unpinned pin button and pins on click', () => {
    expect(panel.isPinned('visual-1')).toBeFalse();
    const pinButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Pin to dashboard"]',
    );
    expect(pinButton).not.toBeNull();

    pinButton.click();

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project-1/dashboard/pins`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ visualId: 'visual-1' });
    req.flush({ ok: true, message: 'Visual pinned to dashboard', project });
  });

  it('refreshing a tile calls the refresh endpoint and refetches the dashboard', () => {
    panel.setViewMode('dashboard');
    fixture.detectChanges();
    http
      .expectOne(dashboardUrl)
      .flush({ tiles: [visual({ id: 'visual-2', title: 'Denials by payer' })] });
    fixture.detectChanges();

    panel.refreshTile('visual-2');

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project-1/visualizations/visual-2/refresh`,
    );
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, message: 'Refreshed data for version 1', project });

    expect(panel.refreshingTileId()).toBeNull();
    http.expectOne(dashboardUrl).flush({ tiles: [] });
    expect(panel.dashboardTiles()).toEqual([]);
  });

  it('ignores visual-error postMessages from tiles while in dashboard view', () => {
    panel.setViewMode('dashboard');
    fixture.detectChanges();
    http.expectOne(dashboardUrl).flush({ tiles: [] });

    panel.onFrameMessage(errorMessage('boom from a tile'));

    expect(panel.runtimeError()).toBeNull();
    expect(panel.repairing()).toBeFalse();
    http.expectNone(repairUrl);
  });
});

function visualSelect(
  value: string,
  extra: { label?: string; column?: string } = {},
): MessageEvent {
  return { data: { type: 'visual-select', value, ...extra } } as MessageEvent;
}

describe('InteractiveVisualPanel dashboard filters', () => {
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
    fixture.componentRef.setInput('projectId', project.id);
    fixture.componentRef.setInput('visualization', visual());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function openDashboard(
    filters: { column: string; values: string[] }[],
    tiles = [visual({ id: 'visual-2', title: 'Denials by payer' })],
  ): void {
    panel.setViewMode('dashboard');
    fixture.detectChanges();
    http.expectOne(dashboardUrl).flush({ tiles, filters });
    fixture.detectChanges();
  }

  it('renders the filter bar from the API-provided filters', () => {
    openDashboard([{ column: 'payer', values: ['Aetna', 'Cigna'] }]);

    expect(panel.dashboardFilters()).toEqual([
      { column: 'payer', values: ['Aetna', 'Cigna'] },
    ]);
    const button = fixture.nativeElement.querySelector(
      'button[aria-label="Filter by payer"]',
    );
    expect(button).not.toBeNull();
  });

  it('hides the filter bar when there are no filterable columns', () => {
    openDashboard([]);

    expect(
      fixture.nativeElement.querySelector('button[aria-label^="Filter by"]'),
    ).toBeNull();
  });

  it('selecting a filter value posts qti-filter to every tile iframe', () => {
    openDashboard([{ column: 'payer', values: ['Aetna', 'Cigna'] }]);
    const postToTile = spyOn<any>(panel, 'postToTile');

    panel.toggleFilterValue('payer', 'Aetna');
    fixture.detectChanges();

    expect(panel.activeFilters()).toEqual({ payer: ['Aetna'] });
    expect(postToTile).toHaveBeenCalled();
    const [, message] = postToTile.calls.mostRecent().args;
    expect(message).toEqual({
      type: 'qti-filter',
      filters: [{ column: 'payer', values: ['Aetna'] }],
    });
  });

  it('clear filters empties active filters and broadcasts an empty array', () => {
    openDashboard([{ column: 'payer', values: ['Aetna', 'Cigna'] }]);
    panel.toggleFilterValue('payer', 'Aetna');
    fixture.detectChanges();
    const postToTile = spyOn<any>(panel, 'postToTile');

    panel.clearFilters();
    fixture.detectChanges();

    expect(panel.activeFilters()).toEqual({});
    const [, message] = postToTile.calls.mostRecent().args;
    expect(message).toEqual({ type: 'qti-filter', filters: [] });
  });

  it('a dashboard visual-select with a column toggles the filter instead of a follow-up', () => {
    openDashboard([{ column: 'payer', values: ['Aetna'] }]);
    const selections: unknown[] = [];
    panel.dataPointSelected.subscribe((s) => selections.push(s));

    panel.onFrameMessage(visualSelect('Aetna', { column: 'payer' }));

    expect(panel.activeFilters()).toEqual({ payer: ['Aetna'] });
    expect(selections).toEqual([]);
  });

  it('ignores a dashboard visual-select without a column', () => {
    openDashboard([{ column: 'payer', values: ['Aetna'] }]);

    panel.onFrameMessage(visualSelect('Aetna'));

    expect(panel.activeFilters()).toEqual({});
  });

  it('still emits dataPointSelected for single-view clicks, column included', () => {
    // Default view mode is 'single'.
    const selections: { value: string; label?: string; column?: string }[] = [];
    panel.dataPointSelected.subscribe((s) => selections.push(s));

    panel.onFrameMessage(visualSelect('Aetna', { column: 'payer' }));

    expect(selections).toEqual([
      { value: 'Aetna', label: undefined, column: 'payer' },
    ]);
  });

  it('resets active filters when the project changes', () => {
    openDashboard([{ column: 'payer', values: ['Aetna'] }]);
    panel.toggleFilterValue('payer', 'Aetna');
    expect(panel.activeFilters()).toEqual({ payer: ['Aetna'] });

    fixture.componentRef.setInput('projectId', 'project-2');
    fixture.detectChanges();

    expect(panel.activeFilters()).toEqual({});
    // Still in dashboard view, so the project switch also refetches — drain it.
    http
      .expectOne(`${API_BASE_URL}/projects/project-2/dashboard`)
      .flush({ tiles: [], filters: [] });
  });
});
