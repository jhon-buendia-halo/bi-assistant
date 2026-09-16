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
