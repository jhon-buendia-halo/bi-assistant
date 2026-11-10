import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { VisualsApiService } from '../../services/visuals-api.service';
import { VisualChart } from '../../models/visual-chart.model';
import { VisualChartForm } from './visual-chart-form';

const SAVED: VisualChart = {
  id: 'v1',
  name: 'Bar chart',
  category: 'Comparison',
  previewKey: 'bar',
  rendererForm: 'bar',
  description: 'Compares values.',
  whenToUse: 'Few categories.',
  whenToAvoid: 'Many categories.',
  dataShape: '1 category + 1 measure',
  enabled: true,
  builtIn: true,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};

describe('VisualChartForm', () => {
  let fixture: ComponentFixture<VisualChartForm>;
  let component: VisualChartForm;
  let el: HTMLElement;
  let api: jasmine.SpyObj<VisualsApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<VisualsApiService>('VisualsApiService', [
      'list',
      'create',
      'update',
      'remove',
    ]);
    api.create.and.returnValue(of(SAVED));
    api.update.and.returnValue(of(SAVED));
    api.remove.and.returnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [VisualChartForm],
      providers: [{ provide: VisualsApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(VisualChartForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('categories', ['Comparison', 'Flow']);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  function q<T extends HTMLElement>(testId: string): T {
    return el.querySelector(`[data-testid="${testId}"]`) as T;
  }

  function type(testId: string, value: string): void {
    const field = q<HTMLInputElement>(testId);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function choose(testId: string, value: string): void {
    const select = q<HTMLSelectElement>(testId);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('labels every control and offers the existing categories', () => {
    const controls = Array.from(
      el.querySelectorAll('input, select, textarea'),
    ) as HTMLElement[];
    expect(controls.length).toBe(9);
    for (const control of controls) {
      const label = control.closest('label');
      expect(label?.textContent?.trim())
        .withContext(control.getAttribute('data-testid') ?? '')
        .toBeTruthy();
    }
    const labels = Array.from(el.querySelectorAll('label')).map((l) =>
      l.querySelector('span')?.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Name',
      'Category',
      'Preview',
      'Drawn by the app as',
      'Description',
      'When to use',
      'When to avoid',
      'Data needed',
      'Enabled',
    ]);
    const options = Array.from(el.querySelectorAll('datalist option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(['Comparison', 'Flow']);
    expect(q('visual-form-delete')).toBeNull();
  });

  it('starts blank, with no preview, not drawn, enabled and Save disabled', () => {
    expect(q<HTMLSelectElement>('visual-form-preview').value).toBe('none');
    expect(q<HTMLSelectElement>('visual-form-renderer').value).toBe('');
    expect(q<HTMLInputElement>('visual-form-enabled').checked).toBeTrue();
    expect(q<HTMLButtonElement>('visual-form-save').disabled).toBeTrue();
    type('visual-form-name', 'Dot plot');
    expect(q<HTMLButtonElement>('visual-form-save').disabled).toBeTrue();
    type('visual-form-category', 'Distribution');
    expect(q<HTMLButtonElement>('visual-form-save').disabled).toBeFalse();
  });

  it('updates the live preview when the preview key changes', () => {
    expect(
      el.querySelector('[data-testid="visual-preview-none"]'),
    ).toBeTruthy();
    choose('visual-form-preview', 'sankey');
    expect(
      el.querySelector('[data-testid="visual-preview-sankey"]'),
    ).toBeTruthy();
  });

  it('creates a chart with the trimmed payload', () => {
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);
    type('visual-form-name', '  Dot plot ');
    type('visual-form-category', ' Distribution ');
    choose('visual-form-preview', 'strip');
    choose('visual-form-renderer', 'scatter');
    type('visual-form-description', ' Dots. ');
    type('visual-form-when-to-use', 'Small samples');
    type('visual-form-when-to-avoid', 'Huge samples');
    type('visual-form-data-shape', '1 measure');
    const enabled = q<HTMLInputElement>('visual-form-enabled');
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    q<HTMLButtonElement>('visual-form-save').click();

    expect(api.create).toHaveBeenCalledWith({
      name: 'Dot plot',
      category: 'Distribution',
      previewKey: 'strip',
      rendererForm: 'scatter',
      description: 'Dots.',
      whenToUse: 'Small samples',
      whenToAvoid: 'Huge samples',
      dataShape: '1 measure',
      enabled: false,
    });
    expect(saved).toHaveBeenCalledWith(SAVED);
  });

  it('prefills an existing chart and saves it by id, with null renderer when not drawn', () => {
    fixture.componentRef.setInput('chart', SAVED);
    fixture.detectChanges();
    expect(q<HTMLInputElement>('visual-form-name').value).toBe('Bar chart');
    expect(q<HTMLSelectElement>('visual-form-preview').value).toBe('bar');
    expect(q<HTMLSelectElement>('visual-form-renderer').value).toBe('bar');
    choose('visual-form-renderer', '');
    q<HTMLButtonElement>('visual-form-save').click();
    expect(api.update).toHaveBeenCalledWith(
      'v1',
      jasmine.objectContaining({ name: 'Bar chart', rendererForm: null }),
    );
  });

  it('shows the backend message inline when the save fails', () => {
    api.create.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { message: 'A chart named "Bar chart" already exists' },
      })),
    );
    type('visual-form-name', 'Bar chart');
    type('visual-form-category', 'Comparison');
    q<HTMLButtonElement>('visual-form-save').click();
    fixture.detectChanges();
    const alert = q('visual-form-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain(
      'A chart named "Bar chart" already exists',
    );
    expect(q<HTMLButtonElement>('visual-form-save').disabled).toBeFalse();
  });

  it('deletes an existing chart only after confirmation', () => {
    const deleted = jasmine.createSpy('deleted');
    component.deleted.subscribe(deleted);
    fixture.componentRef.setInput('chart', SAVED);
    fixture.detectChanges();
    const confirm = spyOn(window, 'confirm').and.returnValue(false);

    q<HTMLButtonElement>('visual-form-delete').click();
    expect(confirm).toHaveBeenCalledWith('Delete chart "Bar chart"?');
    expect(api.remove).not.toHaveBeenCalled();

    confirm.and.returnValue(true);
    q<HTMLButtonElement>('visual-form-delete').click();
    expect(api.remove).toHaveBeenCalledWith('v1');
    expect(deleted).toHaveBeenCalledWith('v1');
  });

  it('shows the backend message when the delete fails', () => {
    api.remove.and.returnValue(
      throwError(() => ({
        status: 404,
        error: { message: 'Chart not found' },
      })),
    );
    spyOn(window, 'confirm').and.returnValue(true);
    fixture.componentRef.setInput('chart', SAVED);
    fixture.detectChanges();
    q<HTMLButtonElement>('visual-form-delete').click();
    fixture.detectChanges();
    expect(q('visual-form-error').textContent).toContain('Chart not found');
  });

  it('emits cancelled from Cancel', () => {
    const cancelled = jasmine.createSpy('cancelled');
    component.cancelled.subscribe(cancelled);
    q<HTMLButtonElement>('visual-form-cancel').click();
    expect(cancelled).toHaveBeenCalled();
  });
});
