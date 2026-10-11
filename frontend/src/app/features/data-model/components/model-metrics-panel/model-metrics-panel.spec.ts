import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ModelMetricsPanel } from './model-metrics-panel';
import { DataModelApiService } from '../../services/data-model-api.service';
import { Metric } from '../../models/data-model.model';

describe('ModelMetricsPanel — advanced-shape detection (review finding 7)', () => {
  let fixture: ComponentFixture<ModelMetricsPanel>;
  let component: ModelMetricsPanel;

  beforeEach(async () => {
    const api = {
      listModelMetrics: () => of({ metrics: [] }),
      modelMetricCandidates: () => of({ candidates: [] }),
    };
    await TestBed.configureTestingModule({
      imports: [ModelMetricsPanel],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DataModelApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ModelMetricsPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('datasetName', 'World Cup Core');
    fixture.componentRef.setInput('entities', [
      { name: 'matches', bindings: [], attributes: [{ name: 'attendance', type: 'integer' }] },
    ]);
    fixture.detectChanges();
  });

  it('opens a simple metric editable (not read-only)', () => {
    const metric: Metric = {
      name: 'avg_attendance',
      label: 'Average attendance',
      entity: 'matches',
      agg: 'avg',
      of: 'attendance',
    };
    component.startEdit(metric);
    expect(component.readOnlyMetric()).toBe(false);
    expect(component.canSave()).toBe(true);
  });

  it('opens read-only for a metric with a compound where (and/or/not)', () => {
    const metric: Metric = {
      name: 'complex_metric',
      label: 'Complex metric',
      entity: 'matches',
      agg: 'count',
      where: {
        and: [
          { attr: 'attendance', op: 'gt', value: 1000 },
          { attr: 'attendance', op: 'lt', value: 90000 },
        ],
      },
    };
    component.startEdit(metric);
    expect(component.readOnlyMetric()).toBe(true);
    expect(component.canSave()).toBe(false);
  });

  it('opens read-only for a metric using both agg and expressions.sql', () => {
    const metric: Metric = {
      name: 'hybrid_metric',
      label: 'Hybrid metric',
      entity: 'matches',
      agg: 'count',
      expressions: { sql: 'count(*) filter (where attendance > 1000)' },
    };
    component.startEdit(metric);
    expect(component.readOnlyMetric()).toBe(true);
    expect(component.canSave()).toBe(false);
  });

  it('clears the read-only flag when starting a new metric after viewing an advanced one', () => {
    component.startEdit({
      name: 'complex_metric',
      label: 'Complex metric',
      entity: 'matches',
      agg: 'count',
      where: { and: [{ attr: 'attendance', op: 'gt', value: 1 }] },
    });
    expect(component.readOnlyMetric()).toBe(true);

    component.startNew();
    expect(component.readOnlyMetric()).toBe(false);
  });
});

describe('ModelMetricsPanel — rows, author and read-only (data-model R40)', () => {
  let fixture: ComponentFixture<ModelMetricsPanel>;
  let component: ModelMetricsPanel;

  const METRICS: Metric[] = [
    {
      name: 'avg_attendance',
      label: 'Average attendance',
      entity: 'matches',
      agg: 'avg',
      of: 'attendance',
      author: 'u-ada',
      authorName: 'Ada Lovelace',
    },
    { name: 'match_count', label: 'Match count', entity: 'matches', agg: 'count' },
    {
      name: 'max_attendance',
      label: 'Highest attendance',
      entity: 'matches',
      agg: 'max',
      of: 'attendance',
      author: 'u-grace',
    },
  ];

  beforeEach(async () => {
    const api = {
      listModelMetrics: () => of({ metrics: METRICS }),
      modelMetricCandidates: () =>
        of({
          candidates: [
            {
              verifiedQueryId: 'vq-1',
              name: 'max_attendance',
              label: 'Max attendance',
              entity: 'matches',
              sql: 'select max(attendance) from matches',
            },
          ],
        }),
    };
    await TestBed.configureTestingModule({
      imports: [ModelMetricsPanel],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DataModelApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ModelMetricsPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('datasetName', 'World Cup Core');
    fixture.componentRef.setInput('entities', [
      { name: 'matches', bindings: [], attributes: [{ name: 'attendance', type: 'integer' }] },
    ]);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (selector: string) => el().querySelector(selector);
  const row = (name: string) => q(`[data-testid="model-metric-${name}"]`) as HTMLElement;

  it('shows "by <author name>", else "by <author>", only for a metric that records an author', () => {
    expect(q('[data-testid="model-metric-author-avg_attendance"]')!.textContent!.trim()).toBe(
      'by Ada Lovelace',
    );
    expect(q('[data-testid="model-metric-author-max_attendance"]')!.textContent!.trim()).toBe(
      'by u-grace',
    );
    expect(q('[data-testid="model-metric-author-match_count"]')).toBeNull();
  });

  it('shows New metric, Edit, Delete and the promotion row by default', () => {
    expect(q('[data-testid="new-model-metric"]')).not.toBeNull();
    expect(row('avg_attendance').querySelector('button[title="Edit"]')).not.toBeNull();
    expect(row('avg_attendance').querySelector('button[title="Delete"]')).not.toBeNull();
    expect(q('[data-testid="promote-candidates"]')).not.toBeNull();
  });

  describe('read-only', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('readOnly', true);
      fixture.detectChanges();
    });

    it('keeps the rows and the author but hides New metric, Edit, Delete and the promotion row', () => {
      expect(row('avg_attendance')).not.toBeNull();
      expect(row('match_count')).not.toBeNull();
      expect(q('[data-testid="model-metric-author-avg_attendance"]')).not.toBeNull();
      expect(q('[data-testid="new-model-metric"]')).toBeNull();
      expect(q('button[title="Edit"]')).toBeNull();
      expect(q('button[title="Delete"]')).toBeNull();
      expect(q('[data-testid="promote-candidates"]')).toBeNull();
      expect(el().textContent).not.toContain('Promote a verified answer');
    });

    it('never opens the form', () => {
      component.startNew();
      component.startEdit(METRICS[0]);
      fixture.detectChanges();
      expect(component.formOpen()).toBe(false);
      expect(q('[data-testid="save-model-metric"]')).toBeNull();
    });
  });
});
