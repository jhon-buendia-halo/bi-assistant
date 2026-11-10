import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ReadinessReport } from '../../models/readiness.model';
import {
  sampleReadinessFindings,
  sampleReadinessPanelItem,
  sampleReadinessReport,
} from '../../models/readiness.testing';
import {
  PanelReadinessView,
  filterReadinessFindings,
  readinessBars,
  readinessFindingTable,
  readinessMaturityClass,
} from './panel-readiness-view';

const url = (id: string) => `${API_BASE_URL}/data-readiness/assessments/${id}`;

describe('PanelReadinessView', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PanelReadinessView>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function create(report: ReadinessReport = sampleReadinessReport()) {
    fixture = TestBed.createComponent(PanelReadinessView);
    fixture.componentRef.setInput('item', sampleReadinessPanelItem(report.id));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Loading report…');
    http.expectOne(url(report.id)).flush(report);
    fixture.detectChanges();
    return el;
  }

  function rows(el: HTMLElement): HTMLElement[] {
    return Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="readiness-finding"]'),
    );
  }

  function choose(el: HTMLElement, label: string, value: string): void {
    const select = el.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    )!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('shows the datasource, the overall score and the band', () => {
    const el = create();
    expect(el.querySelector('[data-testid="readiness-scorecard"]')).toBeTruthy();
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('World Cup');
    expect(
      el.querySelector('[data-testid="readiness-overall"]')?.textContent,
    ).toBe('82');
    expect(el.textContent).toContain('/100');
    const band = el.querySelector('[data-testid="readiness-maturity"]')!;
    expect(band.textContent?.trim()).toBe('Managed');
    expect(band.classList).toContain('chip');
    expect(band.classList).toContain('chip-success');
  });

  it('draws ten bars in scorecard order, accuracy and currency not assessed', () => {
    const el = create();
    const bars = Array.from(
      el.querySelectorAll<HTMLElement>(
        '[data-testid="readiness-dimensions"] > li',
      ),
    );
    expect(bars.map((b) => b.dataset['testid'])).toEqual([
      'readiness-dimension-completeness',
      'readiness-dimension-validity',
      'readiness-dimension-consistency',
      'readiness-dimension-uniqueness',
      'readiness-dimension-integrity',
      'readiness-dimension-accessibility',
      'readiness-dimension-timeliness',
      'readiness-dimension-reasonability',
      'readiness-dimension-accuracy',
      'readiness-dimension-currency',
    ]);

    const completeness = bars[0];
    expect(completeness.textContent).toContain('Completeness');
    expect(completeness.textContent).toContain('90');
    expect(completeness.textContent).toContain('0 findings · 10 checks');
    const fill = completeness.querySelector<HTMLElement>('.bg-primary')!;
    expect(fill.style.width).toBe('90%');

    for (const bar of bars.slice(8)) {
      expect(bar.textContent).toContain('Not assessed');
      expect(bar.querySelector('.bg-primary')).toBeNull();
      expect(bar.querySelector('.text-fg-muted')).toBeTruthy();
    }
  });

  it('lists findings most severe first, then in report order', () => {
    const el = create();
    const found = rows(el);
    expect(found.map((r) => r.dataset['severity'])).toEqual([
      'high',
      'high',
      'medium',
      'low',
      'info',
    ]);
    expect(found[0].textContent).toContain('public.players');
    expect(found[0].textContent).toContain('birth_date');
    expect(found[0].textContent).toContain('Backfill birth dates.');
    expect(found[1].textContent).toContain('public.matches');
    // A source-level finding names the namespace only.
    expect(found[4].querySelectorAll('td')[2].textContent?.trim()).toBe(
      'public',
    );
    expect(
      Array.from(el.querySelectorAll('th')).map((th) => th.textContent?.trim()),
    ).toEqual([
      'Severity',
      'Dimension',
      'Table',
      'Column',
      'Measured',
      'Description',
    ]);
  });

  it('narrows the findings by dimension and severity together', () => {
    const el = create();
    const dimensions = Array.from(
      el.querySelectorAll<HTMLOptionElement>(
        'select[aria-label="Dimension"] option',
      ),
    ).map((o) => o.textContent?.trim());
    expect(dimensions).toEqual([
      'All',
      'Completeness',
      'Validity',
      'Consistency',
      'Uniqueness',
      'Integrity',
      'Accessibility',
      'Timeliness',
      'Reasonability',
    ]);

    choose(el, 'Dimension', 'completeness');
    expect(rows(el).map((r) => r.dataset['severity'])).toEqual([
      'high',
      'medium',
    ]);

    choose(el, 'Severity', 'high');
    expect(rows(el).length).toBe(1);
    expect(rows(el)[0].dataset['dimension']).toBe('completeness');

    choose(el, 'Severity', 'low');
    expect(rows(el).length).toBe(0);
    expect(el.textContent).toContain('No findings match these filters.');
  });

  it('says every check passed when the report has no findings', () => {
    const el = create(sampleReadinessReport({ findings: [] }));
    expect(el.textContent).toContain('No findings: every check passed.');
    expect(el.querySelector('table')).toBeNull();
  });

  it('shows the server error', () => {
    fixture = TestBed.createComponent(PanelReadinessView);
    fixture.componentRef.setInput('item', sampleReadinessPanelItem('gone'));
    fixture.detectChanges();
    http
      .expectOne(url('gone'))
      .flush(
        { message: 'Readiness report "gone" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('Readiness report "gone" not found');
  });

  it('shows another report through showReport, and follows a new item', () => {
    create();
    fixture.componentInstance.showReport('r0');
    fixture.detectChanges();
    http
      .expectOne(url('r0'))
      .flush(sampleReadinessReport({ id: 'r0', overallScore: 40, maturity: 'Repeatable' }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.shownReportId()).toBe('r0');
    expect(
      el.querySelector('[data-testid="readiness-overall"]')?.textContent,
    ).toBe('40');
    expect(
      el.querySelector('[data-testid="readiness-maturity"]')?.classList,
    ).toContain('chip-warning');

    // Showing the item's report again (a new item object) brings it back.
    fixture.componentRef.setInput('item', sampleReadinessPanelItem('r1'));
    fixture.detectChanges();
    http.expectOne(url('r1')).flush(sampleReadinessReport());
    expect(fixture.componentInstance.shownReportId()).toBe('r1');

    fixture.componentRef.setInput('item', sampleReadinessPanelItem('r2'));
    fixture.detectChanges();
    http.expectOne(url('r2')).flush(sampleReadinessReport({ id: 'r2' }));
    expect(fixture.componentInstance.shownReportId()).toBe('r2');
  });

  it('opens another report with both filters back on All', () => {
    const el = create();
    choose(el, 'Severity', 'low');
    expect(rows(el).length).toBe(1);

    fixture.componentInstance.showReport('r0');
    fixture.detectChanges();
    http.expectOne(url('r0')).flush(sampleReadinessReport({ id: 'r0' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.severityFilter()).toBe('all');
    expect(rows(el).length).toBe(5);
    expect(
      el.querySelector<HTMLSelectElement>('select[aria-label="Severity"]')!
        .value,
    ).toBe('all');
  });

  it('projects the Past assessments control into the summary row', () => {
    @Component({
      imports: [PanelReadinessView],
      template: `
        <app-panel-readiness-view #scorecard [item]="item">
          <button readinessHistory type="button" data-testid="history-slot">
            {{ scorecard.report()?.datasourceId }}
          </button>
        </app-panel-readiness-view>
      `,
    })
    class Host {
      readonly scorecard = viewChild.required(PanelReadinessView);
      readonly item = sampleReadinessPanelItem('r1');
    }
    const host = TestBed.createComponent(Host);
    host.detectChanges();
    http.expectOne(url('r1')).flush(sampleReadinessReport());
    host.detectChanges();
    const slot = (host.nativeElement as HTMLElement).querySelector(
      'header [data-testid="history-slot"]',
    );
    expect(slot?.textContent?.trim()).toBe('ds1');
  });
});

describe('readiness scorecard helpers', () => {
  it('reads a dimension missing from the report as not assessed', () => {
    const report = sampleReadinessReport();
    report.dimensionScores = report.dimensionScores.filter(
      (s) => s.dimension !== 'validity',
    );
    const bars = readinessBars(report);
    expect(bars.length).toBe(10);
    expect(bars[1]).toEqual(
      jasmine.objectContaining({ dimension: 'validity', assessed: false }),
    );
  });

  it('maps every band to its status colour', () => {
    expect(readinessMaturityClass('Optimised')).toBe('chip-success');
    expect(readinessMaturityClass('Managed')).toBe('chip-success');
    expect(readinessMaturityClass('Defined')).toBe('chip-info');
    expect(readinessMaturityClass('Repeatable')).toBe('chip-warning');
    expect(readinessMaturityClass('Initial')).toBe('chip-danger');
  });

  it('filters without reordering findings of the same severity', () => {
    const findings = sampleReadinessFindings();
    expect(
      filterReadinessFindings(findings, 'all', 'high').map((f) => f.entity),
    ).toEqual(['players', 'matches']);
    expect(readinessFindingTable({ ...findings[0], namespace: undefined })).toBe(
      'matches',
    );
  });
});

describe('PanelReadinessView not profiled', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PanelReadinessView>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function create(report: ReadinessReport): HTMLElement {
    fixture = TestBed.createComponent(PanelReadinessView);
    fixture.componentRef.setInput('item', sampleReadinessPanelItem(report.id));
    fixture.detectChanges();
    http.expectOne(url(report.id)).flush(report);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const q = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`);

  it('lists each entity with its reason and a thousands-separated count', () => {
    const el = create(
      sampleReadinessReport({
        notProfiled: [
          { entity: 'public.events', reason: 'too-large', rowCount: 12345678 },
          { entity: 'public.logs', reason: 'timed-out' },
        ],
      }),
    );
    expect(q(el, 'readiness-not-profiled')!.textContent).toContain(
      'Not profiled (2)',
    );
    expect(q(el, 'readiness-not-profiled-0')!.textContent).toContain(
      'Too large — 12,345,678 rows, column checks skipped',
    );
    expect(q(el, 'readiness-not-profiled-1')!.textContent).toContain(
      'Timed out — column checks skipped',
    );
  });

  it('is hidden when absent or empty', () => {
    expect(q(create(sampleReadinessReport()), 'readiness-not-profiled')).toBeNull();
    fixture.destroy();
    expect(
      q(
        create(sampleReadinessReport({ id: 'r2', notProfiled: [] })),
        'readiness-not-profiled',
      ),
    ).toBeNull();
  });
});
