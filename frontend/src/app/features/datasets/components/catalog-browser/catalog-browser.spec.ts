import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dataset } from '../../services/datasets-api.service';
import { CatalogBrowser } from './catalog-browser';

const DATASET: Dataset = {
  name: 'market insight',
  datasourceId: 'ds1',
  tables: ['main.sales.orders'],
  entities: [{ key: 'main.sales.orders', columns: [] }],
};

describe('CatalogBrowser tabs (BA-320)', () => {
  let fixture: ComponentFixture<CatalogBrowser>;

  beforeEach(async () => {
    // HTTP stays unanswered: these tests only look at the tab strip.
    await TestBed.configureTestingModule({
      imports: [CatalogBrowser],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(CatalogBrowser);
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  it('shows no tab strip for a new dataset', () => {
    fixture.detectChanges();
    expect(el().querySelector('[role="tablist"]')).toBeNull();
    expect(q('dataset-tab-schema')).toBeNull();
    expect(q('dataset-tab-ontology')).toBeNull();
    expect(el().querySelector('app-ontology-panel')).toBeNull();
    expect(el().textContent).toContain('New dataset');
  });

  it('shows Schema | Ontology when editing a saved dataset, Schema first', () => {
    fixture.componentRef.setInput('initial', DATASET);
    fixture.detectChanges();

    const schema = q('dataset-tab-schema')!;
    const ontology = q('dataset-tab-ontology')!;
    expect(schema.getAttribute('role')).toBe('tab');
    expect(schema.getAttribute('aria-selected')).toBe('true');
    expect(ontology.getAttribute('aria-selected')).toBe('false');
    expect(el().textContent).toContain('Edit dataset');
    expect(el().querySelector('app-ontology-panel')).toBeNull();
  });

  it('has a third Profile & synthesize tab and arrow keys cycle all three', async () => {
    fixture.componentRef.setInput('initial', DATASET);
    fixture.detectChanges();

    const synth = q('dataset-tab-synthesize')!;
    expect(synth.getAttribute('role')).toBe('tab');
    expect(synth.textContent).toContain('Profile & synthesize');
    const press = (id: string, key: string) => {
      q(id)!.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    };
    const selected = () =>
      ['schema', 'ontology', 'synthesize'].find(
        (t) => q('dataset-tab-' + t)!.getAttribute('aria-selected') === 'true',
      );

    press('dataset-tab-schema', 'ArrowRight');
    expect(selected()).toBe('ontology');
    press('dataset-tab-ontology', 'ArrowRight');
    expect(selected()).toBe('synthesize');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('#dataset-panel-synthesize app-synthetic-data-panel')).toBeTruthy();
    press('dataset-tab-synthesize', 'ArrowRight');
    expect(selected()).toBe('schema');
    press('dataset-tab-schema', 'ArrowLeft');
    expect(selected()).toBe('synthesize');
  });

  it('switches to the Ontology panel and back', () => {
    fixture.componentRef.setInput('initial', DATASET);
    fixture.detectChanges();

    q('dataset-tab-ontology')!.click();
    fixture.detectChanges();
    expect(q('dataset-tab-ontology')!.getAttribute('aria-selected')).toBe('true');
    const panel = el().querySelector('#dataset-panel-ontology')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.querySelector('app-ontology-panel')).toBeTruthy();
    expect(el().textContent).not.toContain('Edit dataset');

    q('dataset-tab-schema')!.click();
    fixture.detectChanges();
    expect(el().querySelector('app-ontology-panel')).toBeNull();
    expect(el().textContent).toContain('Edit dataset');
  });
});
