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
