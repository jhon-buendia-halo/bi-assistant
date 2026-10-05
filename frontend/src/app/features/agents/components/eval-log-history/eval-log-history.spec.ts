import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AgentsApiService } from '../../services/agents-api.service';
import { EvalHistoryService } from '../../services/eval-history.service';
import { RunLogSummary } from '../../models/eval.model';
import { EvalLogHistory } from './eval-log-history';

function log(overrides: Partial<RunLogSummary> = {}): RunLogSummary {
  return {
    runId: 'run-1',
    startedAt: '2026-09-20T00:00:00.000Z',
    suite: 'health-insurance',
    harness: 'in-app',
    cases: 20,
    passed: 15,
    inputTokens: 10_000,
    outputTokens: 2_000,
    totalTokens: 12_000,
    file: '2026-09-20-health-insurance-run-1.json',
    dir: '/repo/logs',
    schemaVersion: 2,
    exists: true,
    passK: 15,
    passKRate: 0.75,
    meanPassRate: 0.8,
    gaps: 0,
    flaky: 1,
    ...overrides,
  };
}

describe('EvalHistoryService', () => {
  let service: EvalHistoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EvalHistoryService);
  });

  describe('filtering', () => {
    beforeEach(() => {
      service.logs.set([
        log({ runId: 'a', suite: 'world-cup', arm: 'baseline', harness: 'in-app', model: 'gpt-5' }),
        log({ runId: 'b', suite: 'world-cup', arm: 'fixer-off', harness: 'golden-set', model: 'gpt-5' }),
        log({ runId: 'c', suite: 'health-insurance', arm: 'baseline', harness: 'validate', model: 'gpt-4.1-mini' }),
      ]);
    });

    it('shows every log when no filter is set', () => {
      expect(service.filteredLogs().map((l) => l.runId)).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('narrows by suite', () => {
      service.suiteFilter.set('world-cup');
      expect(service.filteredLogs().map((l) => l.runId)).toEqual(['a', 'b']);
    });

    it('narrows by arm — an unset arm reads as "baseline", not blank', () => {
      service.armFilter.set('baseline');
      expect(service.filteredLogs().map((l) => l.runId)).toEqual(['a', 'c']);
    });

    it('narrows by harness (in-app / CLI / validate)', () => {
      service.harnessFilter.set('validate');
      expect(service.filteredLogs().map((l) => l.runId)).toEqual(['c']);
    });

    it('narrows by model', () => {
      service.modelFilter.set('gpt-4.1-mini');
      expect(service.filteredLogs().map((l) => l.runId)).toEqual(['c']);
    });

    it('combines filters', () => {
      service.suiteFilter.set('world-cup');
      service.harnessFilter.set('golden-set');
      expect(service.filteredLogs().map((l) => l.runId)).toEqual(['b']);
    });

    it('lists only the distinct values actually present, for the pickers', () => {
      expect(service.suites()).toEqual(['health-insurance', 'world-cup']);
      expect(service.arms()).toEqual(['baseline', 'fixer-off']);
      expect(service.harnesses().sort()).toEqual([
        'golden-set',
        'in-app',
        'validate',
      ]);
      expect(service.models()).toEqual(['gpt-4.1-mini', 'gpt-5']);
    });
  });

  describe('A/B compare selection', () => {
    it('fills A, then B', () => {
      service.toggleCompareSelection('file-a.json');
      expect(service.selectedA()).toBe('file-a.json');
      expect(service.selectedB()).toBeNull();

      service.toggleCompareSelection('file-b.json');
      expect(service.selectedA()).toBe('file-a.json');
      expect(service.selectedB()).toBe('file-b.json');
      expect(service.canCompare()).toBe(true);
    });

    it('re-clicking a picked row clears it', () => {
      service.toggleCompareSelection('file-a.json');
      service.toggleCompareSelection('file-b.json');
      service.toggleCompareSelection('file-a.json');
      expect(service.selectedA()).toBeNull();
      expect(service.selectedB()).toBe('file-b.json');
      expect(service.canCompare()).toBe(false);
    });

    it('a third pick replaces A with B and takes the B slot itself', () => {
      service.toggleCompareSelection('file-a.json');
      service.toggleCompareSelection('file-b.json');
      service.toggleCompareSelection('file-c.json');
      expect(service.selectedA()).toBe('file-b.json');
      expect(service.selectedB()).toBe('file-c.json');
    });

    it('cannot compare a run against itself', () => {
      service.selectedA.set('same.json');
      service.selectedB.set('same.json');
      expect(service.canCompare()).toBe(false);
    });

    it('clearCompareSelection empties both slots', () => {
      service.toggleCompareSelection('file-a.json');
      service.toggleCompareSelection('file-b.json');
      service.clearCompareSelection();
      expect(service.selectedA()).toBeNull();
      expect(service.selectedB()).toBeNull();
    });
  });

  describe('reset', () => {
    it('clears logs, filters and selection — one agent must not leak into another', () => {
      service.logs.set([log()]);
      service.suiteFilter.set('world-cup');
      service.toggleCompareSelection('file-a.json');
      service.openedFile.set('file-a.json');

      service.reset();

      expect(service.logs()).toEqual([]);
      expect(service.suiteFilter()).toBe('');
      expect(service.selectedA()).toBeNull();
      expect(service.openedFile()).toBeNull();
    });
  });
});

describe('EvalLogHistory component', () => {
  let fixture: ComponentFixture<EvalLogHistory>;
  let component: EvalLogHistory;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvalLogHistory],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(EvalLogHistory);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    // Required input — set before any test drives the component, without
    // triggering change detection (which would flush the constructor's
    // HTTP-firing effects before the test is ready for them).
    fixture.componentRef.setInput('agentKey', 'assistant');
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders one row per filtered log and a missing-file marker for a dropped file', () => {
    // The first CD cycle flushes the constructor effects (history.load +
    // trend); flush whatever they fired before asserting on rendered state.
    fixture.detectChanges();
    httpMock
      .match(() => true)
      .forEach((req) => req.flush({ logs: [], dirs: [], points: [] }));

    component.history.logs.set([
      log({ runId: 'present', exists: true }),
      log({ runId: 'missing', exists: false, file: 'gone.json' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid^="eval-history-row-"]',
    );
    expect(rows.length).toBe(2);
    const missingMarker = fixture.nativeElement.querySelector(
      '[data-testid="eval-history-missing-missing"]',
    );
    expect(missingMarker).toBeTruthy();
    const presentMarker = fixture.nativeElement.querySelector(
      '[data-testid="eval-history-missing-present"]',
    );
    expect(presentMarker).toBeFalsy();
  });

  it('does not open a run whose file no longer exists', () => {
    component.history.logs.set([log({ runId: 'gone', exists: false })]);
    component.open(log({ runId: 'gone', exists: false }));
    expect(component.history.openedFile()).toBeNull();
  });

  it('opens and toggles closed a present run', () => {
    const entry = log({ runId: 'present', file: 'present.json' });
    const api = TestBed.inject(AgentsApiService);
    spyOn(api, 'getRunLog').and.returnValue(
      of({ ok: true, record: undefined }),
    );
    component.open(entry);
    expect(component.history.openedFile()).toBe('present.json');
    component.open(entry);
    expect(component.history.openedFile()).toBeNull();
  });
});
