import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DatasetsApiService } from '../../../datasets/services/datasets-api.service';
import {
  KnowledgeApiService,
  KnowledgeBootstrapProgress,
} from '../../services/knowledge-api.service';
import { KnowledgeList } from './knowledge-list';

describe('KnowledgeList generate progress', () => {
  let fixture: ComponentFixture<KnowledgeList>;
  let component: KnowledgeList;
  /** Drives the fake stream: emit a stage, or finish the run. */
  let emit: (progress: KnowledgeBootstrapProgress) => void;
  let finish: () => void;

  beforeEach(async () => {
    const api = {
      list: () => of([]),
      bootstrapStream: (
        _datasetId: string,
        handlers: {
          onProgress?: (p: KnowledgeBootstrapProgress) => void;
          onDone?: (created: unknown[]) => void;
        },
      ) => {
        emit = (progress) => handlers.onProgress?.(progress);
        finish = () => handlers.onDone?.([]);
        return Promise.resolve();
      },
    };
    const datasets = {
      getDatasets: () => of({ datasets: [{ name: 'market insight' }] }),
    };
    await TestBed.configureTestingModule({
      imports: [KnowledgeList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KnowledgeApiService, useValue: api },
        { provide: DatasetsApiService, useValue: datasets },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KnowledgeList);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.openGenerate();
    component.generateSuggestions();
    fixture.detectChanges();
  });

  function progressText(): string {
    const el = fixture.nativeElement as HTMLElement;
    return (
      el.querySelector('[data-testid="generate-progress"]')?.textContent ?? ''
    );
  }

  it('shows a starting line before the backend reports anything', () => {
    expect(progressText()).toContain('Starting');
  });

  it('renders the stage in flight and keeps the finished ones above it', () => {
    emit({ key: 'dataset', message: 'Opening dataset “market insight”' });
    emit({ key: 'schema', message: 'Reading schema — 3 tables' });
    fixture.detectChanges();

    expect(component.finishedSteps().map((s) => s.key)).toEqual(['dataset']);
    expect(component.currentStep()?.key).toBe('schema');
    expect(progressText()).toContain('Opening dataset');
    expect(progressText()).toContain('Reading schema — 3 tables');
  });

  it('rewrites a counting stage in place instead of stacking lines', () => {
    emit({ key: 'sample', message: 'Sampling rows — 1 of 3 tables' });
    emit({ key: 'sample', message: 'Sampling rows — 2 of 3 tables' });
    fixture.detectChanges();

    expect(component.generateSteps().length).toBe(1);
    expect(progressText()).toContain('Sampling rows — 2 of 3 tables');
    expect(progressText()).not.toContain('1 of 3');
  });

  it('clears the panel when the run finishes', () => {
    emit({ key: 'draft', message: 'Drafting' });
    finish();
    fixture.detectChanges();

    expect(component.generating()).toBe(false);
    expect(component.generateSteps()).toEqual([]);
    expect(progressText()).toBe('');
  });
});
