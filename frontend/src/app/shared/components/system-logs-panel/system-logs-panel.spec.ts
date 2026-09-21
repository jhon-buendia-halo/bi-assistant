import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiagnosticsService } from '../../../core/diagnostics/diagnostics.service';
import {
  DiagnosticEntry,
  DiagnosticLevel,
} from '../../../core/diagnostics/diagnostics.types';
import { SystemLogsPanel } from './system-logs-panel';

let sequence = 0;

function entry(
  message: string,
  options: { source?: string; level?: DiagnosticLevel } = {},
): DiagnosticEntry {
  sequence++;
  return {
    id: `e${sequence}`,
    timestamp: `2026-09-21T17:00:${`${sequence}`.padStart(2, '0')}.000Z`,
    level: options.level ?? 'info',
    source: options.source ?? 'backend',
    message,
  };
}

function nest(pid: number, rest: string, level: DiagnosticLevel = 'info') {
  return entry(`[Nest] ${pid}  - 09/21/2026, 12:08:43 PM   LOG ${rest}`, {
    level,
  });
}

/** Two backend runs; the second carries the error a reader is looking for. */
const STREAM = () => [
  entry('Application diagnostics initialized', { source: 'electron' }),
  nest(14324, '[NestFactory] Starting Nest application...'),
  entry('Created DBSQLClient', { source: 'backend:mastra' }),
  nest(17828, '[NestFactory] Starting Nest application...'),
  entry('Created DBSQLClient', { source: 'backend:mastra' }),
  entry('Structured output validation failed', {
    source: 'user-visible',
    level: 'error',
  }),
];

describe('SystemLogsPanel grouping', () => {
  let fixture: ComponentFixture<SystemLogsPanel>;
  let panel: SystemLogsPanel;

  beforeEach(() => {
    sequence = 0;
    TestBed.configureTestingModule({
      imports: [SystemLogsPanel],
      providers: [
        {
          provide: DiagnosticsService,
          useValue: {
            entries: () => STREAM(),
            loading: () => false,
            refresh: () => Promise.resolve(),
            exportForLlm: () => Promise.resolve({ ok: true, canceled: false }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SystemLogsPanel);
    panel = fixture.componentInstance;
  });

  it('groups by run and leaves pre-backend entries ungrouped', () => {
    const groups = panel.visibleGroups();

    expect(groups.ungrouped.map((e) => e.source)).toEqual(['electron']);
    expect(groups.runs.map((r) => [r.pid, r.entries.length])).toEqual([
      ['14324', 2],
      ['17828', 3],
    ]);
  });

  it('is on by default and can be switched back to a flat list', () => {
    expect(panel.grouped()).toBeTrue();
    panel.grouped.set(false);
    expect(panel.visibleEntries().length).toBe(6);
  });

  it('keeps run boundaries when a search hides the [Nest] lines', () => {
    // Grouping the filtered list instead would drop every PID and collapse
    // the whole stream into `ungrouped`.
    panel.query.set('DBSQLClient');
    const groups = panel.visibleGroups();

    expect(groups.ungrouped).toEqual([]);
    expect(groups.runs.map((r) => r.pid)).toEqual(['14324', '17828']);
    expect(groups.runs.every((r) => r.entries.length === 1)).toBeTrue();
  });

  it('drops runs with no matching entries under the issues filter', () => {
    panel.filter.set('issues');
    const groups = panel.visibleGroups();

    expect(groups.runs.map((r) => r.pid)).toEqual(['17828']);
    expect(groups.runs[0].entries.map((e) => e.message)).toEqual([
      'Structured output validation failed',
    ]);
    // Counts describe the run as recorded, not the filtered subset.
    expect(groups.runs[0].errorCount).toBe(1);
  });

  it('expands only the newest run when nothing is filtered', () => {
    const groups = panel.visibleGroups();

    expect(panel.isRunOpen(groups.runs[0])).toBeFalse();
    expect(panel.isRunOpen(groups.runs[1])).toBeTrue();
  });

  it('expands every surviving run while filtering, so no match stays hidden', () => {
    // A hit inside a collapsed <details> is invisible — searching has to
    // open the runs it matched in.
    panel.query.set('DBSQLClient');
    expect(
      panel.visibleGroups().runs.every((r) => panel.isRunOpen(r)),
    ).toBeTrue();

    panel.query.set('');
    panel.filter.set('issues');
    expect(
      panel.visibleGroups().runs.every((r) => panel.isRunOpen(r)),
    ).toBeTrue();
  });

  it('renders a search hit from an older run as visible', () => {
    panel.query.set('DBSQLClient');
    fixture.detectChanges();
    const older = fixture.nativeElement.querySelectorAll('details[open]');

    // Both runs matched, so both are open.
    expect(
      Array.from(older).filter((el) =>
        ((el as HTMLElement).textContent ?? '').includes('PID 14324'),
      ).length,
    ).toBe(1);
  });

  it('renders a run header per run, with its PID', () => {
    fixture.detectChanges();
    const headers = Array.from(
      fixture.nativeElement.querySelectorAll('summary'),
    )
      .map((el) => (el as HTMLElement).textContent ?? '')
      .filter((text) => text.includes('PID'));

    expect(headers.length).toBe(2);
    expect(headers[0]).toContain('PID 14324');
    expect(headers[1]).toContain('PID 17828');
    expect(headers[1]).toContain('1 errors');
  });

  it('collapses a run span to one time when it holds a single instant', () => {
    const [run] = panel.visibleGroups().runs;
    expect(panel.runSpan({ ...run, endedAt: run.startedAt })).not.toContain(
      '–',
    );
    expect(panel.runSpan(run)).toContain('–');
  });
});
